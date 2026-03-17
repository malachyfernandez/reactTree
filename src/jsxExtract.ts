import type { Node } from "@babel/types";
import * as t from "@babel/types";
import type { JsxTreeNode } from "./types.js";

export const CHILDREN_SLOT = "__CHILDREN__";

function jsxNameToString(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) return `${jsxNameToString(name.object)}.${jsxNameToString(name.property)}`;
  return `${name.namespace.name}:${name.name.name}`;
}

function isChildrenExpression(n: Node | null | undefined): boolean {
  if (!n) return false;
  if (t.isIdentifier(n) && n.name === "children") return true;
  if (t.isMemberExpression(n)) {
    if (t.isIdentifier(n.property) && n.property.name === "children") return true;
  }
  return false;
}

function collectJsxFromExpression(expr: Node | null | undefined, out: Array<t.JSXElement | t.JSXFragment>) {
  if (!expr) return;

  if (t.isJSXElement(expr) || t.isJSXFragment(expr)) {
    out.push(expr);
    return;
  }

  if (t.isParenthesizedExpression(expr)) return collectJsxFromExpression(expr.expression, out);
  if (t.isSequenceExpression(expr)) {
    for (const e of expr.expressions) collectJsxFromExpression(e as unknown as Node, out);
    return;
  }
  if (t.isLogicalExpression(expr)) {
    collectJsxFromExpression(expr.left as unknown as Node, out);
    collectJsxFromExpression(expr.right as unknown as Node, out);
    return;
  }
  if (t.isConditionalExpression(expr)) {
    collectJsxFromExpression(expr.consequent as unknown as Node, out);
    collectJsxFromExpression(expr.alternate as unknown as Node, out);
    return;
  }
  if (t.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) collectJsxFromExpression(arg as unknown as Node, out);
    }
    return;
  }
  if (t.isArrayExpression(expr)) {
    for (const el of expr.elements) {
      if (t.isExpression(el)) collectJsxFromExpression(el as unknown as Node, out);
    }
    return;
  }
  if (t.isObjectExpression(expr)) {
    for (const prop of expr.properties) {
      if (t.isObjectProperty(prop) && t.isExpression(prop.value)) {
        collectJsxFromExpression(prop.value as unknown as Node, out);
      }
    }
    return;
  }
  // Anything else: ignore (identifiers, literals, etc).
}

type ChildItem = t.JSXElement | t.JSXFragment | { slot: "children" };

function childrenFromJsx(node: t.JSXElement | t.JSXFragment): ChildItem[] {
  const rawChildren = t.isJSXElement(node) ? node.children : node.children;
  const out: ChildItem[] = [];
  for (const ch of rawChildren) {
    if (t.isJSXElement(ch) || t.isJSXFragment(ch)) {
      out.push(ch);
      continue;
    }
    if (t.isJSXExpressionContainer(ch)) {
      const expr = ch.expression as unknown as Node;
      if (isChildrenExpression(expr)) {
        out.push({ slot: "children" });
        continue;
      }
      collectJsxFromExpression(expr, out as Array<t.JSXElement | t.JSXFragment>);
      continue;
    }
    // Ignore JSXText / JSXSpreadChild etc.
  }
  return out;
}

export function jsxAstToTree(ast: t.JSXElement | t.JSXFragment): JsxTreeNode[] {
  if (t.isJSXFragment(ast)) {
    const out: JsxTreeNode[] = [];
    for (const child of childrenFromJsx(ast)) {
      if ("slot" in child) {
        out.push({ name: CHILDREN_SLOT, children: [] });
      } else {
        out.push(...jsxAstToTree(child));
      }
    }
    return out;
  }

  const name = jsxNameToString(ast.openingElement.name);
  const childrenAst = childrenFromJsx(ast);
  const children = childrenAst.flatMap((c) =>
    "slot" in c ? [{ name: CHILDREN_SLOT, children: [] }] : jsxAstToTree(c)
  );
  return [{ name, children }];
}

export function coerceSingleRoot(nodes: JsxTreeNode[]): JsxTreeNode {
  if (nodes.length === 1) return nodes[0];
  return { name: "Fragment", children: nodes };
}

