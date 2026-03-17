import blessed from "blessed";
import pc from "picocolors";
import type { JsxTreeNode } from "./types.js";

type Line = {
  text: string;
  nodeId?: string;
  canToggle?: boolean;
};

function nodeIdPath(pathIds: string[]): string {
  return pathIds.join("/");
}

function isToggleable(node: JsxTreeNode): boolean {
  // Toggle ONLY components expanded from separate files (shown with =>)
  return !!node.expandedFromFile;
}

function collectToggleables(root: JsxTreeNode, pathIds: string[] = [], out: Set<string>) {
  const myPath = [...pathIds, root.name];
  const id = nodeIdPath(myPath);
  if (isToggleable(root)) out.add(id);
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    const key = `${c.name}#${i + 1}`;
    collectToggleables(c, [...myPath, key], out);
  }
}

function renderDomLines(
  root: JsxTreeNode,
  collapsedIds: Set<string>,
  pathIds: string[] = [],
  indentLevel = 0,
  lines: Line[] = []
): Line[] {
  const myPath = [...pathIds, root.name];
  const id = nodeIdPath(myPath);
  const toggleable = isToggleable(root);
  const isCollapsed = toggleable ? collapsedIds.has(id) : false;

  const indent = " ".repeat(indentLevel * 4);
  const arrow = toggleable ? " =>" : "";

  // If collapsed (and toggleable), render a self-closing line exactly like DOM
  if (!root.children.length || (toggleable && isCollapsed)) {
    lines.push({
      text: `${indent}<${root.name} />${arrow}`,
      nodeId: id,
      canToggle: toggleable
    });
    return lines;
  }

  // Expanded
  lines.push({
    text: `${indent}<${root.name}>${arrow}`,
    nodeId: id,
    canToggle: toggleable
  });

  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    const key = `${c.name}#${i + 1}`;
    renderDomLines(c, collapsedIds, [...myPath, key], indentLevel + 1, lines);
  }

  lines.push({ text: `${indent}</${root.name}>` });
  return lines;
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
  let lastLines: Line[] = [];

  const screen = blessed.screen({
    smartCSR: true,
    title: "react-jsx-tree",
    dockBorders: true,
    fullUnicode: true,
    mouse: !!opts.enableMouse
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: false,
    content: `${pc.bold(pc.cyan(opts.title))}\n${pc.dim(opts.metaLine)}\n${pc.dim(
      "Keys: ↑↓ navigate  Enter/Space/+ toggle  q quit"
    )}`,
    style: { fg: "white" }
  });

  const list = blessed.list({
    top: 3,
    left: 0,
    width: "100%",
    height: "100%-3",
    keys: true,
    mouse: !!opts.enableMouse,
    tags: false,
    border: { type: "line" },
    style: {
      border: { fg: "cyan" },
      selected: { bg: "blue", fg: "white" },
      item: { fg: "white" }
    },
    scrollbar: { ch: " ", track: { bg: "gray" }, style: { bg: "white" } }
  });

  screen.append(header);
  screen.append(list);

  const initCollapseDefaults = (root: JsxTreeNode) => {
    // Every toggleable node is collapsed by default
    const allToggleables = new Set<string>();
    collectToggleables(root, [], allToggleables);
    for (const id of allToggleables) {
      if (!collapsedIds.has(id)) collapsedIds.add(id);
    }
  };

  const setData = (root: JsxTreeNode) => {
    lastRoot = root;
    initCollapseDefaults(root);
    lastLines = renderDomLines(root, collapsedIds);
    list.setItems(lastLines.map((l) => l.text));
    if (list.selected == null) list.select(0);
    screen.render();
  };

  setData(opts.root);

  function toggleSelected() {
    const idx = list.selected ?? 0;
    const line = lastLines[idx];
    if (!line?.canToggle || !line.nodeId) return;
    if (collapsedIds.has(line.nodeId)) collapsedIds.delete(line.nodeId);
    else collapsedIds.add(line.nodeId);
    setData(lastRoot);
  }

  // Key bindings
  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });
  // Bind on list to avoid blessed-contrib tree default behavior (jumping to top)
  list.key(["enter", "space", "+"], () => toggleSelected());
  if (opts.enableMouse) list.on("select", () => toggleSelected());

  return {
    updateTree: (root, metaLine) => {
      header.setContent(
        `${pc.bold(pc.cyan(opts.title))}\n${pc.dim(metaLine)}\n${pc.dim(
          "Keys: ↑↓ navigate  Enter/Space/+ toggle  q quit"
        )}`
      );
      setData(root);
    },
    destroy: () => screen.destroy()
  };
}

