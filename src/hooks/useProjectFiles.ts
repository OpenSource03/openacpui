import { useCallback, useEffect, useRef, useState } from "react";
import { buildFileTree, type FileTreeNode } from "@/lib/file-tree";

interface UseProjectFilesReturn {
  tree: FileTreeNode[] | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch the file list from disk. */
  refresh: () => void;
}

/**
 * Fetches the project file list via IPC and builds a nested tree.
 * Re-fetches when `cwd` changes. Returns loading/error states.
 */
export function useProjectFiles(cwd: string | undefined): UseProjectFilesReturn {
  const [tree, setTree] = useState<FileTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the latest fetch to avoid stale responses
  const fetchIdRef = useRef(0);

  const fetchFiles = useCallback(async (dir: string) => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await window.claude.files.listAll(dir);
      // Guard against stale response (cwd changed while fetching)
      if (id !== fetchIdRef.current) return;
      setTree(buildFileTree(result.files));
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to list files");
      setTree(null);
    } finally {
      if (id === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!cwd) {
      setTree(null);
      setLoading(false);
      setError(null);
      return;
    }

    fetchFiles(cwd);
  }, [cwd, fetchFiles]);

  const refresh = useCallback(() => {
    if (cwd) fetchFiles(cwd);
  }, [cwd, fetchFiles]);

  return { tree, loading, error, refresh };
}
