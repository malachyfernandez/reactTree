export type JsxTreeNode = {
  name: string;
  children: JsxTreeNode[];
  expandedFromFile?: string;
};

export type BuildOptions = {
  rootDir: string; // absolute
  startFile: string; // absolute
  ignoreDirs: string[]; // relative to rootDir
  maxDepth: number;
};

export type JsxTreeNode = {
  name: string;
  children: JsxTreeNode[];
  /** For display: keep node even if expanded from another file. */
  expandedFromFile?: string;
};

export type BuildOptions = {
  rootDir: string; // absolute
  startFile: string; // absolute
  ignoreDirs: string[]; // relative to rootDir, normalized with forward slashes, no leading ./, no trailing /
  maxDepth: number;
};

