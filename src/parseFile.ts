import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";
import * as t from "@babel/types";
import { isIgnored, isWithinOrEqual } from "./pathing.ts";

export type FileParseResult = {
  imports: Map<string, string>; // localName -> abs file path
  jsxReturn: t.JSXElement | t.JSXFragment | null;
};

const EXT_CANDIDATES = [".tsx", ".ts", ".jsx", ".js"];

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function resolveImport(fromFileAbs: string, spec: string): Promise<string | null> {
  const fromDir = path.dirname(fromFileAbs);
  const base = path.resolve(fromDir, spec);

  // Exact file with extension.
  if (await fileExists(base)) return base;
  for (const ext of EXT_CANDIDATES) {
    if (await fileExists(base + ext)) return base + ext;
  }

  // Directory import -> index.ext
  try {
    const st = await fs.stat(base);
    if (st.isDirectory()) {
      for (const ext of EXT_CANDIDATES) {
        const idx = path.join(base, "index" + ext);
        if (await fileExists(idx)) return idx;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function getReturnedJsxFromFunctionBody(body: t.BlockStatement): t.JSXElement | t.JSXFragment | null {
  // Heuristic: first `return <JSX/>` in top-level of component body.
  for (const st of body.body) {
    if (t.isReturnStatement(st)) {
      const arg = st.argument;
      if (arg && (t.isJSXElement(arg) || t.isJSXFragment(arg))) return arg;
    }
  }
  return null;
}

function getJsxFromExpression(expr: t.Expression | t.BlockStatement): t.JSXElement | t.JSXFragment | null {
  if (t.isJSXElement(expr) || t.isJSXFragment(expr)) return expr;
  if (t.isBlockStatement(expr)) return getReturnedJsxFromFunctionBody(expr);
  if (t.isParenthesizedExpression(expr)) return getJsxFromExpression(expr.expression);
  return null;
}

function findDefaultExportComponentJsx(ast: t.File): t.JSXElement | t.JSXFragment | null {
  let defaultExportId: string | null = null;
  let jsx: t.JSXElement | t.JSXFragment | null = null;

  // Pass 1: find `export default function` / `export default () =>` / `export default Identifier`
  for (const st of ast.program.body) {
    if (!t.isExportDefaultDeclaration(st)) continue;
    const decl = st.declaration;
    if (t.isFunctionDeclaration(decl) && decl.body) {
      return getReturnedJsxFromFunctionBody(decl.body);
    }
    if (t.isArrowFunctionExpression(decl)) {
      return getJsxFromExpression(decl.body);
    }
    if (t.isIdentifier(decl)) {
      defaultExportId = decl.name;
    }
    if (t.isCallExpression(decl)) {
      // export default memo(() => <JSX/>)
      for (const arg of decl.arguments) {
        if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
          if (t.isBlockStatement(arg.body)) {
            const found = getReturnedJsxFromFunctionBody(arg.body);
            if (found) return found;
          } else if (t.isJSXElement(arg.body) || t.isJSXFragment(arg.body)) {
            return arg.body;
          }
        }
      }
    }
  }

  if (!defaultExportId) return null;

  // Pass 2: find declaration of that identifier (function or const arrow)
  const traverse: typeof traverseImport =
    // @babel/traverse is CJS; in ESM builds it often comes through as { default: fn }
    ((traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport);

  traverse(ast, {
    FunctionDeclaration(p) {
      const n = p.node;
      if (!n.id || n.id.name !== defaultExportId) return;
      const found = getReturnedJsxFromFunctionBody(n.body);
      if (found) jsx = found;
      p.stop();
    },
    VariableDeclarator(p) {
      const n = p.node;
      if (!t.isIdentifier(n.id) || n.id.name !== defaultExportId) return;
      const init = n.init;
      if (t.isArrowFunctionExpression(init)) {
        const found = getJsxFromExpression(init.body);
        if (found) jsx = found;
        p.stop();
      }
      if (t.isFunctionExpression(init)) {
        const found = getReturnedJsxFromFunctionBody(init.body);
        if (found) jsx = found;
        p.stop();
      }
    }
  });

  return jsx;
}

export async function parseReactFile(opts: {
  fileAbs: string;
  rootDirAbs: string;
  ignoreDirsRel: string[];
}): Promise<FileParseResult> {
  const code = await fs.readFile(opts.fileAbs, "utf8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"]
  });

  const imports = new Map<string, string>();

  for (const st of ast.program.body) {
    if (!t.isImportDeclaration(st)) continue;
    const spec = st.source.value;
    if (typeof spec !== "string") continue;
    if (!spec.startsWith(".")) continue; // only relative

    const resolved = await resolveImport(opts.fileAbs, spec);
    if (!resolved) continue;
    if (!isWithinOrEqual(opts.rootDirAbs, resolved)) continue; // never jump out of root
    if (isIgnored(resolved, opts.rootDirAbs, opts.ignoreDirsRel)) continue;

    for (const s of st.specifiers) {
      if (t.isImportDefaultSpecifier(s)) {
        imports.set(s.local.name, resolved);
      } else if (t.isImportSpecifier(s)) {
        imports.set(s.local.name, resolved);
      } else if (t.isImportNamespaceSpecifier(s)) {
        imports.set(s.local.name, resolved);
      }
    }
  }

  const jsxReturn = findDefaultExportComponentJsx(ast);
  return { imports, jsxReturn };
}

