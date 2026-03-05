// ── File tree data structures & transformations ──
// Pure utility module — no React dependencies.
// Transforms flat file/dir lists from `files:list` IPC into nested trees.

export interface FileTreeNode {
  name: string;
  /** Relative path from project root (e.g. "src/lib/utils.ts") */
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  /** Lowercase extension without dot. Undefined for directories. */
  extension?: string;
}

export interface FlatTreeItem {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
}

// ── Build tree from flat lists ──

interface TreeBuildNode {
  name: string;
  path: string;
  children: Map<string, TreeBuildNode>;
  isFile: boolean;
  extension?: string;
}

function getOrCreateDir(root: Map<string, TreeBuildNode>, segments: string[]): TreeBuildNode {
  let current = root;
  let pathSoFar = "";
  let lastNode: TreeBuildNode | undefined;

  for (const seg of segments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
    let node = current.get(seg);
    if (!node) {
      node = { name: seg, path: pathSoFar, children: new Map(), isFile: false };
      current.set(seg, node);
    }
    lastNode = node;
    current = node.children;
  }

  return lastNode!;
}

function toBuildTree(root: Map<string, TreeBuildNode>): FileTreeNode[] {
  const dirs: FileTreeNode[] = [];
  const files: FileTreeNode[] = [];

  for (const node of root.values()) {
    if (node.isFile) {
      files.push({ name: node.name, path: node.path, type: "file", extension: node.extension });
    } else {
      dirs.push({
        name: node.name,
        path: node.path,
        type: "directory",
        children: toBuildTree(node.children),
      });
    }
  }

  // Sort: directories first (alphabetical), then files (alphabetical)
  const cmp = (a: FileTreeNode, b: FileTreeNode) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  dirs.sort(cmp);
  files.sort(cmp);

  return [...dirs, ...files];
}

/**
 * Build a nested file tree from flat file/dir lists (as returned by `files:list` IPC).
 * Directories are sorted before files at each level, alphabetical within each group.
 */
export function buildFileTree(files: string[]): FileTreeNode[] {
  const root = new Map<string, TreeBuildNode>();

  for (const filePath of files) {
    const segments = filePath.split("/");
    const fileName = segments.pop()!;

    // Ensure parent directories exist
    let parent = root;
    if (segments.length > 0) {
      const dirNode = getOrCreateDir(root, segments);
      parent = dirNode.children;
    }

    // Add file node
    const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
    parent.set(fileName, {
      name: fileName,
      path: filePath,
      children: new Map(),
      isFile: true,
      extension: ext,
    });
  }

  return toBuildTree(root);
}

// ── Filter tree by search query ──

/**
 * Filter the tree to only include nodes whose paths match the query (case-insensitive substring).
 * Ancestor directories of matching files are preserved to maintain tree structure.
 * Returns a new tree (immutable).
 */
export function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query.trim()) return nodes;

  const q = query.toLowerCase();

  function filterNode(node: FileTreeNode): FileTreeNode | null {
    if (node.type === "file") {
      return node.name.toLowerCase().includes(q) ? node : null;
    }

    // Directory: recurse into children, keep if any child matches
    const filteredChildren = (node.children ?? []).map(filterNode).filter(Boolean) as FileTreeNode[];
    if (filteredChildren.length === 0) {
      // Also keep if the directory name itself matches
      return node.name.toLowerCase().includes(q) ? { ...node, children: [] } : null;
    }

    return { ...node, children: filteredChildren };
  }

  return nodes.map(filterNode).filter(Boolean) as FileTreeNode[];
}

// ── Flatten tree for rendering ──

/** Collect all directory paths from filtered tree (for auto-expand during search). */
export function collectDirPaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  function walk(items: FileTreeNode[]) {
    for (const node of items) {
      if (node.type === "directory") {
        paths.add(node.path);
        if (node.children) walk(node.children);
      }
    }
  }

  walk(nodes);
  return paths;
}

/**
 * Flatten a nested tree into a flat list for rendering, respecting expanded state.
 * Only visible items are included — collapsed subtrees are omitted.
 */
export function flattenTree(nodes: FileTreeNode[], expandedPaths: Set<string>, depth = 0): FlatTreeItem[] {
  const result: FlatTreeItem[] = [];

  for (const node of nodes) {
    const isExpanded = node.type === "directory" && expandedPaths.has(node.path);
    result.push({ node, depth, isExpanded });

    if (isExpanded && node.children) {
      result.push(...flattenTree(node.children, expandedPaths, depth + 1));
    }
  }

  return result;
}

/** Count total files in a tree (not directories). */
export function countFiles(nodes: FileTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "file") {
      count++;
    } else if (node.children) {
      count += countFiles(node.children);
    }
  }
  return count;
}
