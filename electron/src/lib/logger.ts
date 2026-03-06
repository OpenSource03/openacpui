import path from "path";
import fs from "fs";
import { app } from "electron";

const logsDir = app.isPackaged
  ? path.join(app.getPath("userData"), "logs")
  : path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, `main-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_RE =
  /^(authorization|proxy-authorization|api[-_]?key|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|cookie|set-cookie|code[-_]?verifier)$/i;

function sanitizeString(value: string): string {
  return value
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"]+/gi, `$1${REDACTED}`)
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|api[_-]?key|apikey|password|code(?:[_-]?verifier)?)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(:\/\/)([^/\s:@]+):([^/\s@]+)@/g, `$1${REDACTED}@`);
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));
  if (!(value instanceof Object)) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : sanitizeValue(nested, seen);
  }
  return sanitized;
}

export function formatLogData(data: unknown): string {
  const sanitized = sanitizeValue(data);
  return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2);
}

export function log(label: string, data: unknown): void {
  const ts = new Date().toISOString();
  const line = formatLogData(data);
  logStream.write(`[${ts}] [${label}] ${line}\n`);
}
