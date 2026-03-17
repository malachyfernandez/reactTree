import path from "node:path";
import type { BuildOptions, JsxTreeNode } from "./types.js";
import { CHILDREN_SLOT, coerceSingleRoot, jsxAstToTree } from "./jsxExtract.ts";
import { parseReactFile } from "./parseFile.ts";

export type BuildResult = {
  root: JsxTreeNode;
  filesTouched: Set<string>;
  warnings: string[];
};

function cloneNode(n: JsxTreeNode): JsxTreeNode {
  return { 
    name: n.name, 
    children: n.children.map(cloneNode), 
    expandedFromFile: n.expandedFromFile,
    dynamicExpression: n.dynamicExpression 
  };
}

function spliceChildrenSlot(tree: JsxTreeNode, slotChildren: JsxTreeNode[]): JsxTreeNode {
  if (tree.name === CHILDREN_SLOT) {
    return { name: CHILDREN_SLOT, children: slotChildren.map(cloneNode), dynamicExpression: tree.dynamicExpression };
  }
  return { ...tree, children: tree.children.map((c) => spliceChildrenSlot(c, slotChildren)) };
}

function pruneEmptySlots(node: JsxTreeNode): JsxTreeNode | null {
  if (node.name === CHILDREN_SLOT) {
    const kids = node.children.map(pruneEmptySlots).filter(Boolean) as JsxTreeNode[];
    if (!kids.length) return null;
    return { ...node, children: kids, dynamicExpression: node.dynamicExpression };
  }

  const prunedKids = node.children.map(pruneEmptySlots).filter(Boolean) as JsxTreeNode[];
  return { ...node, children: prunedKids, dynamicExpression: node.dynamicExpression };
}

async function expandNode(opts: BuildOptions, node: JsxTreeNode, importMap: Map<string, string>, ctx: {
  depth: number;
  stack: string[];
  filesTouched: Set<string>;
  warnings: string[];
}): Promise<JsxTreeNode> {
  const maybeFile = importMap.get(node.name);
  if (!maybeFile) {
    return { ...node, children: await Promise.all(node.children.map((c) => expandNode(opts, c, importMap, ctx))) };
  }
  if (ctx.depth >= opts.maxDepth) {
    return { ...node, children: await Promise.all(node.children.map((c) => expandNode(opts, c, importMap, ctx))) };
  }
  if (ctx.stack.includes(maybeFile)) {
    // Prevent infinite expansion on recursive/self-referential components
    return { ...node, children: await Promise.all(node.children.map((c) => expandNode(opts, c, importMap, ctx))) };
  }

  // Parse component file and replace children with its returned JSX (props ignored).
  try {
    ctx.filesTouched.add(maybeFile);
    const parsed = await parseReactFile({
      fileAbs: maybeFile,
      rootDirAbs: opts.rootDir,
      ignoreDirsRel: opts.ignoreDirs
    });

    const mergedImportMap = new Map(importMap);
    for (const [k, v] of parsed.imports.entries()) mergedImportMap.set(k, v);

    if (!parsed.jsxReturn) {
      return { ...node, children: await Promise.all(node.children.map((c) => expandNode(opts, c, mergedImportMap, ctx))) };
    }

    const childTrees = jsxAstToTree(parsed.jsxReturn);
    const stitched = childTrees.map((c) => spliceChildrenSlot(c, node.children));
    const expandedChildren = await Promise.all(
      stitched.map((c) =>
        expandNode(opts, c, mergedImportMap, {
          ...ctx,
          depth: ctx.depth + 1,
          stack: [...ctx.stack, maybeFile]
        })
      )
    );

    return { name: node.name, children: expandedChildren, expandedFromFile: path.relative(opts.rootDir, maybeFile) };
  } catch (e) {
    ctx.warnings.push(`Failed to parse ${maybeFile}: ${(e as Error).message}`);
    return node;
  }
}

export async function buildJsxTree(opts: BuildOptions): Promise<BuildResult> {
  const warnings: string[] = [];
  const filesTouched = new Set<string>();
  filesTouched.add(opts.startFile);

  const parsed = await parseReactFile({
    fileAbs: opts.startFile,
    rootDirAbs: opts.rootDir,
    ignoreDirsRel: opts.ignoreDirs
  });

  if (!parsed.jsxReturn) {
    return {
      root: { name: "NoJSXReturnFound", children: [] },
      filesTouched,
      warnings: [`No JSX return found in ${opts.startFile}`]
    };
  }

  const initialTrees = jsxAstToTree(parsed.jsxReturn);
  const root = coerceSingleRoot(initialTrees);
  const importMap = parsed.imports;

  const expanded = await expandNode(opts, cloneNode(root), importMap, {
    depth: 0,
    stack: [opts.startFile],
    filesTouched,
    warnings
  });

  const pruned = pruneEmptySlots(expanded) ?? { name: "Empty", children: [] };
  return { root: pruned, filesTouched, warnings };
}

