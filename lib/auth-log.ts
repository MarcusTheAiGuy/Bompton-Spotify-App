type AuthLogEntry = {
  level: "error" | "warn" | "debug";
  at: string;
  name?: string;
  message?: string;
  cause?: unknown;
  metadata?: unknown;
};

const MAX_ENTRIES = 50;

const globalForAuthLog = globalThis as unknown as { __authLog?: AuthLogEntry[] };
if (!globalForAuthLog.__authLog) globalForAuthLog.__authLog = [];

const buffer = globalForAuthLog.__authLog;

export function recordAuthLog(entry: AuthLogEntry) {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function getAuthLog(): AuthLogEntry[] {
  return [...buffer];
}

export function clearAuthLog() {
  buffer.length = 0;
}
