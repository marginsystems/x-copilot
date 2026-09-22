/**
 * One owned ScoutProfile snapshot per collector run (C11).
 *
 * Wraps the store's owner-safe `readScoutProfile` (the only supported read
 * boundary) in a soft-failing helper: a blank identity performs no read, and
 * a thrown error, absent result, foreign owner or unusable shape all mean
 * "no profile for this run" — never a retry, fallback owner or fabricated
 * profile. The store's own fail-closed behavior is unchanged.
 */
import type { ScoutProfile } from "./scoutProfile.js";
import { readScoutProfile } from "./scoutProfileStore.js";

/** Narrow injectable loader (tests). Production uses `readScoutProfile`. */
export type ScoutRunProfileLoader = (
  userId: string,
) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when `value` is a frozen-shape profile owned by exactly `userId`.
 * Field-level validation of what may reach a prompt stays in the formatter.
 */
export function isUsableScoutRunProfile(
  value: unknown,
  userId: string,
): value is ScoutProfile {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.userId !== "string" || value.userId !== userId) return false;
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    return false;
  }
  return (
    isRecord(value.kinds) &&
    isRecord(value.overall) &&
    isRecord(value.familiarity) &&
    Array.isArray(value.topics) &&
    Array.isArray(value.authors)
  );
}

/**
 * Load the run's snapshot for the trimmed authenticated user, or null.
 * Callers hold the returned object unmodified for the whole run.
 */
export async function loadScoutRunProfile(
  userId: string | undefined,
  load: ScoutRunProfileLoader = readScoutProfile,
): Promise<ScoutProfile | null> {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) return null;
  let loaded: unknown;
  try {
    loaded = await load(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scout] profile unavailable for this run: ${message}`);
    return null;
  }
  return isUsableScoutRunProfile(loaded, id) ? loaded : null;
}
