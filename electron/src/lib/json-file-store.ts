/**
 * Generic JSON file store for electron main process.
 *
 * Provides typed CRUD over a per-key JSON file directory under the app data dir.
 * Supports optional safeStorage encryption with automatic plaintext-to-encrypted
 * migration for backward compatibility.
 *
 * Used by: mcp-oauth-store, mcp-store, jira-oauth-store, jira-store.
 */

import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { getDataDir } from "./data-dir";
import { log } from "./logger";
import { reportError } from "./error-utils";

interface JsonFileStoreOptions {
  /** Subdirectory under the app data dir (e.g. "mcp-oauth", "jira"). */
  subDir: string;
  /**
   * Transform the caller-supplied key into a filesystem-safe filename stem.
   * When omitted the key is used as-is (suitable for UUIDs / project IDs).
   */
  sanitizeKey?: (key: string) => string;
  /**
   * Encrypt file contents with Electron safeStorage.
   * When true, load() transparently migrates plaintext files written before
   * encryption was enabled.
   */
  encrypt?: boolean;
  /** Label prefix for reportError / log messages (e.g. "MCP_OAUTH"). */
  label: string;
}

export class JsonFileStore<T> {
  private readonly subDir: string;
  private readonly sanitizeKey: (key: string) => string;
  private readonly encrypt: boolean;
  private readonly label: string;

  constructor(options: JsonFileStoreOptions) {
    this.subDir = options.subDir;
    this.sanitizeKey = options.sanitizeKey ?? ((k) => k);
    this.encrypt = options.encrypt ?? false;
    this.label = options.label;
  }

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  private getDir(): string {
    const dir = path.join(getDataDir(), this.subDir);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getPath(key: string): string {
    const safe = this.sanitizeKey(key);
    return path.join(this.getDir(), `${safe}.json`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Read and parse a stored value. Returns null when the file is missing. */
  load(key: string): T | null {
    const filePath = this.getPath(key);

    try {
      if (this.encrypt && safeStorage.isEncryptionAvailable()) {
        return this.loadEncrypted(filePath, key);
      }
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch (error: unknown) {
      if (!isEnoent(error)) {
        reportError(`${this.label}_LOAD`, error, { key });
      }
      return null;
    }
  }

  /**
   * Serialize and persist a value. Uses atomic write (temp file + rename) to
   * avoid partial-write corruption. Encrypted files are written with 0o600
   * permissions.
   */
  save(key: string, data: T): void {
    const filePath = this.getPath(key);
    const json = JSON.stringify(data, null, 2);

    try {
      if (this.encrypt) {
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(json);
          fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
        } else {
          // Encryption unavailable -- fall back to restrictive plaintext.
          fs.writeFileSync(filePath, json, { mode: 0o600 });
        }
      } else {
        // Non-sensitive data: atomic write via temp + rename.
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, json);
        fs.renameSync(tempPath, filePath);
      }
    } catch (error: unknown) {
      reportError(`${this.label}_SAVE`, error, { key });
      throw error;
    }
  }

  /** Remove a stored file. Returns false if the file did not exist. */
  delete(key: string): boolean {
    const filePath = this.getPath(key);

    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error: unknown) {
      if (isEnoent(error)) return false;
      reportError(`${this.label}_DELETE`, error, { key });
      throw error;
    }
  }

  /** Check whether a file exists for the given key. */
  has(key: string): boolean {
    return fs.existsSync(this.getPath(key));
  }

  // ---------------------------------------------------------------------------
  // Encrypted load with plaintext migration
  // ---------------------------------------------------------------------------

  /**
   * Attempt to decrypt the file. If decryption fails (file was written in
   * plaintext before encryption was enabled), fall back to a plaintext read
   * and re-save as encrypted to complete the migration.
   */
  private loadEncrypted(filePath: string, key: string): T {
    try {
      const encrypted = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as T;
    } catch {
      // Decryption failed -- likely a plaintext file from before encryption.
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as T;
      log(`${this.label}_MIGRATE`, `Migrating plaintext data to encrypted for "${key}"`);
      this.save(key, data);
      return data;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
