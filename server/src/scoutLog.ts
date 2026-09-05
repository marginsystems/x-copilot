/**
 * Scout stage log — process-local in-memory ring. Not persisted and not
 * shipped on /api/boot; the shared data/scout-log.json is no longer read or
 * written.
 */

export const MAX_SCOUT_LOG_ENTRIES = 1000;

export type ScoutLogEntry = {
  at: string;
  message: string;
  stage?: string;
};

const entriesByUser = new Map<string, ScoutLogEntry[]>();

export function parseScoutLogEntry(raw: unknown): ScoutLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const at = typeof obj.at === "string" ? obj.at : "";
  const message = typeof obj.message === "string" ? obj.message.trim() : "";
  if (!message || !at || !Number.isFinite(Date.parse(at))) return null;
  const entry: ScoutLogEntry = { at, message };
  if (typeof obj.stage === "string" && obj.stage.trim()) {
    entry.stage = obj.stage.trim();
  }
  return entry;
}

export function parseScoutLogFile(raw: unknown): ScoutLogEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.entries) ? obj.entries : [];
  const out: ScoutLogEntry[] = [];
  for (const row of list) {
    const parsed = parseScoutLogEntry(row);
    if (parsed) out.push(parsed);
  }
  return out.slice(-MAX_SCOUT_LOG_ENTRIES);
}

/** Oldest → newest, max 1000. */
export async function getScoutLog(userId: string): Promise<ScoutLogEntry[]> {
  return [...(entriesByUser.get(userId) ?? [])];
}

export async function appendScoutLog(input: {
  userId: string;
  message: string;
  stage?: string;
  at?: string;
}): Promise<ScoutLogEntry> {
  const message = input.message.trim();
  if (!message) {
    throw new Error("message is required");
  }
  const at =
    typeof input.at === "string" && Number.isFinite(Date.parse(input.at))
      ? input.at
      : new Date().toISOString();
  const entry: ScoutLogEntry = { at, message };
  if (typeof input.stage === "string" && input.stage.trim()) {
    entry.stage = input.stage.trim();
  }

  const entries = entriesByUser.get(input.userId) ?? [];
  const last = entries[entries.length - 1];
  if (last && last.message === entry.message) {
    // Coalesce: refresh timestamp on the existing row.
    last.at = entry.at;
    if (entry.stage) last.stage = entry.stage;
    return last;
  }
  entries.push(entry);
  entriesByUser.set(input.userId, entries.slice(-MAX_SCOUT_LOG_ENTRIES));
  return entry;
}

/** Test helper. */
export function clearScoutLogMemory(): void {
  entriesByUser.clear();
}
