export type JsxTreeNode = {
  name: string;
  children: JsxTreeNode[];
  expandedFromFile?: string;
  dynamicExpression?: {
    type: 'map' | 'filter' | 'ternary' | 'logical' | 'call' | 'other';
    variable?: string;
    operation?: string;
  };
};

export type BuildOptions = {
  rootDir: string; // absolute
  startFile: string; // absolute
  ignoreDirs: string[]; // relative to rootDir, normalized with forward slashes, no leading ./, no trailing /
  maxDepth: number;
};

