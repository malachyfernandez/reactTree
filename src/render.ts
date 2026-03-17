import pc from "picocolors";
import type { JsxTreeNode } from "./types.js";
import { CHILDREN_SLOT } from "./jsxExtract.ts";

export type RenderOptions = {
  showFragmentWrapper?: boolean;
  showExpandedFrom?: boolean;
};

function isWrapperFragment(n: JsxTreeNode): boolean {
  return n.name === "Fragment";
}

function renderNode(n: JsxTreeNode, indent: number, out: string[], opts: RenderOptions) {
  const pad = "  ".repeat(indent);

  if (n.name === CHILDREN_SLOT) {
    for (const c of n.children) renderNode(c, indent, out, opts);
    return;
  }

  if (isWrapperFragment(n) && !opts.showFragmentWrapper) {
    for (const c of n.children) renderNode(c, indent, out, opts);
    return;
  }

  const meta =
    opts.showExpandedFrom && n.expandedFromFile ? pc.dim(`  // ${n.expandedFromFile}`) : "";

  if (!n.children.length) {
    out.push(`${pad}<${n.name} />${meta}`);
    return;
  }

  out.push(`${pad}<${n.name}>${meta}`);
  for (const c of n.children) renderNode(c, indent + 1, out, opts);
  out.push(`${pad}</${n.name}>`);
}

export function renderTree(root: JsxTreeNode, opts: RenderOptions = {}): string {
  const lines: string[] = [];
  renderNode(root, 0, lines, opts);
  return lines.join("\n");
}

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

