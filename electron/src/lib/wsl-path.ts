export interface WslPathInfo {
  distro: string;
  unixPath: string;
}

const WSL_PATH_REGEX = /^\/\/wsl(?:\.localhost|\$)\/([^/]+)(\/.*)/i;

/**
 * Detect a Windows WSL UNC path (\\wsl$\\Distro\\... or \\wsl.localhost\\Distro\\...)
 * and return the distro name plus the corresponding WSL unix path.
 */
export function parseWslPath(rawPath?: string): WslPathInfo | null {
  if (!rawPath) return null;
  const normalized = rawPath.replace(/\\/g, "/");
  const match = normalized.match(WSL_PATH_REGEX);
  if (!match) return null;

  const distro = match[1];
  const unixPath = match[2] || "/";
  return { distro, unixPath };
}

/** Best-effort guess of the WSL user's home directory from a project path. */
export function getLikelyWslHome(unixPath: string): string {
  const homeMatch = unixPath.match(/^\/home\/[^/]+/);
  if (homeMatch) return homeMatch[0];
  return "/root";
}

/** UNC prefix for a given WSL distro (wsl.localhost used for consistency). */
export function getWslWindowsPrefix(distro: string): string {
  return `\\\\wsl.localhost\\${distro}`;
}

/** Translate a WSL UNC path to its unix equivalent; leave other paths untouched. */
export function maybeToWslPath(rawPath?: string): string | undefined {
  const info = parseWslPath(rawPath);
  return info ? info.unixPath : rawPath;
}
