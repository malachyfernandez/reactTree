import blessed from "blessed";
// blessed-contrib is CJS; keep it generic for ESM builds
import contribImport from "blessed-contrib";
import pc from "picocolors";
import type { JsxTreeNode } from "./types.js";

type Contrib = typeof import("blessed-contrib");
const contrib: Contrib =
  (contribImport as unknown as { default?: Contrib }).default ?? (contribImport as unknown as Contrib);

type TreeNodeData = {
  name: string;
  id: string;
  extended?: boolean;
  children?: Record<string, TreeNodeData>;
};

function nodeIdPath(pathIds: string[]): string {
  return pathIds.join("/");
}

function buildTreeData(
  root: JsxTreeNode,
  collapsedIds: Set<string>,
  pathIds: string[] = []
): TreeNodeData {
  const myPath = [...pathIds, root.name];
  const id = nodeIdPath(myPath);

  const kids: Record<string, TreeNodeData> = {};
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    // disambiguate identical sibling names
    const key = `${c.name}#${i + 1}`;
    kids[key] = buildTreeData(c, collapsedIds, [...myPath, key]);
  }

  const hasChildren = Object.keys(kids).length > 0;
  const isCollapsed = collapsedIds.has(id);

  const indicator = hasChildren ? (isCollapsed ? pc.dim("+ ") : pc.dim("- ")) : pc.dim("  ");
  const label = hasChildren ? `${indicator}<${root.name}>` : `${indicator}<${root.name} />`;

  return {
    name: label,
    id,
    extended: hasChildren ? !isCollapsed : undefined,
    children: hasChildren ? kids : undefined
  };
}

export type InteractiveController = {
  updateTree: (root: JsxTreeNode, metaLine: string) => void;
  destroy: () => void;
};

export function startInteractiveUI(opts: {
  title: string;
  metaLine: string;
  root: JsxTreeNode;
  collapsedIds?: Set<string>;
  enableMouse?: boolean;
}): InteractiveController {
  const collapsedIds = opts.collapsedIds ?? new Set<string>();
  let lastRoot = opts.root;

  const screen = blessed.screen({
    smartCSR: true,
    title: "react-jsx-tree",
    dockBorders: true,
    fullUnicode: true,
    mouse: !!opts.enableMouse
  });

  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const header = grid.set(0, 0, 2, 12, blessed.box, {
    tags: false,
    content: `${pc.bold(pc.cyan(opts.title))}\n${pc.dim(opts.metaLine)}\n${pc.dim("Keys: ↑↓ navigate  Enter/Space toggle  q quit")}`,
    style: { fg: "white" }
  }) as blessed.Widgets.BoxElement;

  const tree = grid.set(2, 0, 10, 12, contrib.tree, {
    label: "JSX Tree",
    fg: "white",
    border: { type: "line", fg: "cyan" }
  }) as unknown as import("blessed-contrib").Widgets.TreeElement;

  const setData = (root: JsxTreeNode) => {
    lastRoot = root;
    const data = buildTreeData(root, collapsedIds);
    tree.setData(data as unknown as any);
    screen.render();
  };

  setData(opts.root);

  function toggleSelected() {
    const sel: any = (tree as any).selected;
    if (!sel) return;
    const id: string | undefined = sel.id;
    const children = sel.children;
    const hasChildren = children && Object.keys(children).length > 0;
    if (!id || !hasChildren) return;

    if (collapsedIds.has(id)) collapsedIds.delete(id);
    else collapsedIds.add(id);
  }

  // Key bindings
  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });
  screen.key(["enter", "space"], () => {
    toggleSelected();
    setData(lastRoot);
  });

  // Mouse click to toggle
  (tree as any).on("select", () => {
    // no-op; selection highlight is enough
  });
  (tree as any).on("click", () => {
    if (!opts.enableMouse) return;
    toggleSelected();
    setData(lastRoot);
  });

  return {
    updateTree: (root, metaLine) => {
      header.setContent(
        `${pc.bold(pc.cyan(opts.title))}\n${pc.dim(metaLine)}\n${pc.dim("Keys: ↑↓ navigate  Enter/Space toggle  q quit")}`
      );
      setData(root);
    },
    destroy: () => screen.destroy()
  };
}

