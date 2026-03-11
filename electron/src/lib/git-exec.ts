import { execFile } from "child_process";

export const ALWAYS_SKIP = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".nuxt",
  ".output", ".cache", ".turbo", ".parcel-cache", ".vercel", ".netlify",
  "__pycache__", ".pytest_cache", ".mypy_cache", "venv", ".venv", "env",
  ".tox", "coverage", ".nyc_output", ".angular", ".expo", "Pods",
  ".gradle", ".idea", ".vs", ".vscode", "target", "out", "bin", "obj",
]);

export function gitExec(args: string[], cwd: string, options?: { timeout?: number; maxBuffer?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = options?.timeout ?? 30000; // 30s default timeout
    const maxBuffer = options?.maxBuffer ?? 50 * 1024 * 1024; // 50MB default buffer (up from 5MB)

    execFile("git", args, { cwd, maxBuffer, timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout);
    });
  });
}
