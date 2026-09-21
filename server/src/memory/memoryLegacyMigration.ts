/**
 * Idempotent, non-destructive adoption of legacy `<date>-<threadId>.md`
 * notes into canonical owned paths, plus alias-free enumeration shared by
 * the MiniLM index and Voice scanning.
 *
 * Only a note whose frontmatter verifiably names one owner and one thread is
 * copied. Unowned or conflicting notes stay where they are and are reported
 * in aggregate; a lone installed user or a matching thread id is not proof.
 * Previously written reply-suffixed owned notes are not bulk-converted here;
 * they are read-compatible fallback input that enumeration collapses onto
 * the canonical alias when one exists. Originals are never deleted or
 * rewritten.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isCanonicalOwnedNoteName,
  listNoteNames,
  ownedNoteDir,
  ownedNoteFilename,
  parseOwnedNoteMetadata,
  parseOwnedNoteName,
  writeOwnedNoteAtomically,
  type OwnedNoteCache,
  type OwnedNoteKind,
  type OwnedNoteMetadata,
} from "./ownedMemoryNotes.js";

export type LegacyMigrationReport = {
  kind: OwnedNoteKind;
  /** Legacy-named notes inspected. */
  scanned: number;
  copied: number;
  /** Canonical copy already existed (earlier run or newer owned write). */
  alreadyCanonical: number;
  unowned: number;
  conflict: number;
  /** Owned but missing a thread id — cannot be placed. */
  invalid: number;
  unreadable: number;
  failed: number;
};

export type EnumeratedNote = {
  path: string;
  name: string;
  kind: OwnedNoteKind;
  canonical: boolean;
  /** Null when the note has no frontmatter. */
  meta: OwnedNoteMetadata | null;
  markdown: string;
};

/** Canonical alias name a verifiably owned legacy note maps to; null otherwise. */
export function canonicalAliasFor(
  name: string,
  meta: OwnedNoteMetadata | null,
): string | null {
  if (!meta || meta.ownerState !== "owned" || !meta.userId || !meta.threadId) {
    return null;
  }
  const filenameDate = /^(\d{4}-\d{2}-\d{2})-/.exec(name)?.[1];
  const at =
    meta.actionAt && /^\d{4}-\d{2}-\d{2}/.test(meta.actionAt)
      ? meta.actionAt
      : filenameDate;
  if (!at) return null;
  try {
    return ownedNoteFilename({ userId: meta.userId, threadId: meta.threadId, at });
  } catch {
    return null;
  }
}

const reportedExclusions = new Set<string>();

/** Reset the once-per-process exclusion diagnostics (tests). */
export function resetLegacyMigrationDiagnosticsForTests(): void {
  reportedExclusions.clear();
}

function emptyReport(kind: OwnedNoteKind): LegacyMigrationReport {
  return {
    kind,
    scanned: 0,
    copied: 0,
    alreadyCanonical: 0,
    unowned: 0,
    conflict: 0,
    invalid: 0,
    unreadable: 0,
    failed: 0,
  };
}

/**
 * Copy every verifiably owned legacy note to its canonical owned path.
 * Safe to repeat: an existing canonical file is never overwritten.
 */
export async function migrateLegacyNotes(opts: {
  knowledgeRoot: string;
  kinds?: OwnedNoteKind[];
  cache?: OwnedNoteCache;
  log?: (message: string) => void;
}): Promise<LegacyMigrationReport[]> {
  const reports: LegacyMigrationReport[] = [];
  const log = opts.log ?? ((message: string) => console.warn(message));
  for (const kind of opts.kinds ?? (["interaction", "dismissal"] as const)) {
    const report = emptyReport(kind);
    reports.push(report);
    const dir = ownedNoteDir(kind, opts.knowledgeRoot);
    const names = await listNoteNames(dir, opts.cache);
    if (!names) continue;
    const nameSet = new Set(names);
    for (const name of names) {
      // Owned names (canonical or reply-suffixed) are not legacy input.
      if (parseOwnedNoteName(name)) continue;
      report.scanned += 1;
      const path = join(dir, name);
      let markdown: string;
      try {
        markdown = opts.cache
          ? await opts.cache.read(path)
          : await readFile(path, "utf8");
      } catch {
        report.unreadable += 1;
        continue;
      }
      const meta = parseOwnedNoteMetadata(markdown);
      if (!meta || meta.ownerState === "unowned") {
        report.unowned += 1;
        continue;
      }
      if (meta.ownerState === "conflict") {
        report.conflict += 1;
        continue;
      }
      const alias = canonicalAliasFor(name, meta);
      if (!alias) {
        report.invalid += 1;
        continue;
      }
      if (nameSet.has(alias)) {
        report.alreadyCanonical += 1;
        continue;
      }
      try {
        const result = await writeOwnedNoteAtomically({
          path: join(dir, alias),
          merge: (existing) => (existing === undefined ? markdown : null),
        });
        if (result.changed) {
          report.copied += 1;
          nameSet.add(alias);
        } else {
          report.alreadyCanonical += 1;
        }
      } catch {
        report.failed += 1;
      }
    }
    const excluded = report.unowned + report.conflict + report.invalid + report.unreadable;
    const diagnosticKey = `${dir}:${excluded}:${report.failed}`;
    if (report.copied > 0) {
      log(
        `[memory-migration] ${kind}: copied ${report.copied} owned legacy note(s) to canonical paths (originals kept)`,
      );
    }
    if ((excluded > 0 || report.failed > 0) && !reportedExclusions.has(diagnosticKey)) {
      reportedExclusions.add(diagnosticKey);
      log(
        `[memory-migration] ${kind}: left ${excluded} legacy note(s) unmigrated (unowned ${report.unowned}, conflicting ${report.conflict}, unplaceable ${report.invalid}, unreadable ${report.unreadable}); ${report.failed} copy failure(s)`,
      );
    }
  }
  return reports;
}

/**
 * Every note in a knowledge directory with legacy/canonical aliases collapsed
 * to the canonical record. Unowned and conflicting legacy notes are still
 * returned (with their metadata) so callers apply their own policy.
 */
export async function enumerateMemoryNotes(opts: {
  knowledgeRoot: string;
  kind: OwnedNoteKind;
  /** Run the idempotent legacy copy first. Default false. */
  migrate?: boolean;
  cache?: OwnedNoteCache;
}): Promise<EnumeratedNote[]> {
  if (opts.migrate) {
    try {
      await migrateLegacyNotes({
        knowledgeRoot: opts.knowledgeRoot,
        kinds: [opts.kind],
        cache: opts.cache,
      });
    } catch (err) {
      console.warn("[memory-migration] soft-fail:", err);
    }
  }
  const dir = ownedNoteDir(opts.kind, opts.knowledgeRoot);
  const names = await listNoteNames(dir, opts.cache);
  if (!names) return [];
  const nameSet = new Set(names);
  const out: EnumeratedNote[] = [];
  for (const name of names) {
    const path = join(dir, name);
    let markdown: string;
    try {
      markdown = opts.cache ? await opts.cache.read(path) : await readFile(path, "utf8");
    } catch {
      continue;
    }
    const meta = parseOwnedNoteMetadata(markdown);
    const canonical = isCanonicalOwnedNoteName(name);
    if (!canonical) {
      // Legacy and reply-suffixed aliases collapse onto the canonical note.
      const alias = canonicalAliasFor(name, meta);
      if (alias && nameSet.has(alias)) continue;
    }
    out.push({ path, name, kind: opts.kind, canonical, meta, markdown });
  }
  return out;
}
