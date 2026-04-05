import { app, ipcMain, BrowserWindow } from "electron";
import { log } from "./logger";
import { reportError } from "./error-utils";

/**
 * Pre-release detection via GitHub Releases API.
 *
 * On startup (packaged builds only), fetches the release matching the running
 * version and checks the `prerelease` flag. The result is cached in memory for
 * the lifetime of the process — one fetch per app launch.
 */

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  html_url: string;
}

interface PreReleaseInfo {
  isPreRelease: boolean;
  version: string;
  releaseUrl: string | null;
}

const GITHUB_OWNER = "OpenSource03";
const GITHUB_REPO = "harnss";
const FETCH_TIMEOUT_MS = 10_000;

let cachedResult: PreReleaseInfo | null = null;

/**
 * Query the GitHub Releases API for the release matching the current app version.
 * Returns `{ isPreRelease: true, ... }` if the release is marked as a pre-release,
 * or `{ isPreRelease: false }` if it's stable or the check fails (fail-safe).
 */
async function checkIsPreRelease(): Promise<PreReleaseInfo> {
  const version = app.getVersion();
  const tag = `v${version}`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`;

  const stableResult: PreReleaseInfo = { isPreRelease: false, version, releaseUrl: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": `Harnss/${version}`,
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      // 404 = no release for this tag (e.g. local dev build) → assume stable
      if (response.status === 404) {
        log("PRERELEASE", `No GitHub release found for ${tag} — assuming stable`);
        return stableResult;
      }
      log("PRERELEASE", `GitHub API returned ${response.status} for ${tag}`);
      return stableResult;
    }

    const release = (await response.json()) as GitHubRelease;
    const info: PreReleaseInfo = {
      isPreRelease: release.prerelease,
      version,
      releaseUrl: release.html_url,
    };

    log("PRERELEASE", `${tag} isPreRelease=${release.prerelease}`);
    return info;
  } catch (err) {
    // Network failure, timeout, etc. — fail safe to "not pre-release"
    reportError("PRERELEASE", err, { tag });
    return stableResult;
  }
}

/**
 * Initialize the pre-release detection system.
 * - Registers the `updater:is-prerelease` IPC handler
 * - Fetches the pre-release status in the background (packaged builds only)
 * - Pushes the result to the renderer once available
 */
export function initPreReleaseCheck(
  getMainWindow: () => BrowserWindow | null,
): void {
  // IPC handler — returns cached result or fetches on demand
  ipcMain.handle("updater:is-prerelease", async () => {
    if (cachedResult) return cachedResult;

    // In dev mode, always return stable
    if (!app.isPackaged) {
      return { isPreRelease: false, version: app.getVersion(), releaseUrl: null };
    }

    cachedResult = await checkIsPreRelease();
    return cachedResult;
  });

  // Skip background fetch in dev — version won't match any GitHub release
  if (!app.isPackaged) return;

  // Background fetch after startup (don't block launch)
  setTimeout(async () => {
    cachedResult = await checkIsPreRelease();

    // Push result to renderer proactively so the banner can appear without polling
    if (cachedResult.isPreRelease) {
      const win = getMainWindow();
      win?.webContents.send("updater:prerelease-status", cachedResult);
    }
  }, 3_000);
}
