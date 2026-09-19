/**
 * Bounded owner-verified saved-memory receipts for desk history and boot.
 * Saved means this user's matching note exists — not that MiniLM indexed it.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfirmedReplyMemoryState } from "./interactionMemoryProjection.js";
import {
  defaultKnowledgeRoot,
  normalizeReply,
  safeThreadIdForFilename,
  utcDatePrefix,
} from "./knowledgeMemory.js";

export type InteractionMemoryReceipt = {
  state: ConfirmedReplyMemoryState;
};

export type InteractionMemoryLookupKey = {
  threadId: string;
  at: string;
};

let testKnowledgeRoot: string | undefined;

export function resetInteractionMemoryReceiptForTests(opts?: {
  knowledgeRoot?: string;
}): void {
  testKnowledgeRoot = opts?.knowledgeRoot;
}

function resolveKnowledgeRoot(explicit?: string): string {
  return explicit ?? testKnowledgeRoot ?? defaultKnowledgeRoot();
}

function expectedNoteName(threadId: string, interactedAt: string): string {
  return `${utcDatePrefix(interactedAt)}-${safeThreadIdForFilename(threadId)}.md`;
}

function noteSuffix(threadId: string): string {
  return `-${safeThreadIdForFilename(threadId)}.md`;
}

function parseNoteOwnerAndReply(markdown: string): {
  userId: string;
  hasReply: boolean;
} | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!fm) return null;
  const userId =
    /(?:^|\n)userId:\s*"?([^"\n]+)"?/.exec(fm[1]!)?.[1]?.trim() ?? "";
  const replyMatch = /^##\s+Reply\s*\r?\n+([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(
    markdown,
  );
  return {
    userId,
    hasReply: Boolean(normalizeReply(replyMatch?.[1] ?? "")),
  };
}

async function listInteractionNoteNames(dir: string): Promise<string[] | null> {
  try {
    if (!existsSync(dir)) return null;
    return (await readdir(dir)).filter((name) => name.endsWith(".md"));
  } catch {
    return null;
  }
}

async function resolveNoteName(
  exactNames: ReadonlySet<string>,
  namesBySuffix: ReadonlyMap<string, readonly string[]>,
  threadId: string,
  interactedAt: string,
  dir: string,
  userId: string,
): Promise<string | null> {
  const expected = expectedNoteName(threadId, interactedAt);
  if (exactNames.has(expected)) return expected;
  const suffix = noteSuffix(threadId);
  const matches = namesBySuffix.get(suffix) ?? [];
  if (!matches.length) return null;
  for (const name of matches) {
    try {
      const parsed = parseNoteOwnerAndReply(
        await readFile(join(dir, name), "utf8"),
      );
      if (parsed?.userId === userId) return name;
    } catch {
      // Let receiptForNote report an unavailable result for unreadable notes.
    }
  }
  return matches[0]!;
}

async function receiptForNote(opts: {
  userId: string;
  path: string;
}): Promise<ConfirmedReplyMemoryState> {
  let raw: string;
  try {
    raw = await readFile(opts.path, "utf8");
  } catch {
    return "unavailable";
  }
  const parsed = parseNoteOwnerAndReply(raw);
  if (!parsed) return "unavailable";
  if (parsed.userId && parsed.userId === opts.userId && parsed.hasReply) {
    return "saved";
  }
  // Wrong owner, unowned, or a note without usable reply text is not saved
  // for this user. Do not treat a foreign note as "no reply".
  return "unavailable";
}

/**
 * One directory listing plus bounded note reads per returned interaction. Never throws.
 */
export async function lookupInteractionMemoryReceipts(opts: {
  userId: string;
  interactions: readonly InteractionMemoryLookupKey[];
  knowledgeRoot?: string;
}): Promise<ConfirmedReplyMemoryState[]> {
  const userId = opts.userId.trim();
  if (!userId) {
    return opts.interactions.map(() => "unavailable");
  }
  const root = resolveKnowledgeRoot(opts.knowledgeRoot);
  const dir = join(root, "interactions");
  const names = await listInteractionNoteNames(dir);
  if (!names) {
    return opts.interactions.map(() => "unavailable");
  }

  const exactNames = new Set(names);
  const namesBySuffix = new Map<string, string[]>();
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}-/.test(name)) continue;
    const suffix = name.slice(10);
    const matches = namesBySuffix.get(suffix);
    if (matches) matches.push(name);
    else namesBySuffix.set(suffix, [name]);
  }
  for (const matches of namesBySuffix.values()) matches.sort().reverse();

  const states = new Array<ConfirmedReplyMemoryState>(opts.interactions.length);
  const batchSize = 20;
  for (let start = 0; start < opts.interactions.length; start += batchSize) {
    const batch = await Promise.all(
      opts.interactions.slice(start, start + batchSize).map(async (interaction) => {
        try {
          const name = await resolveNoteName(
            exactNames,
            namesBySuffix,
            interaction.threadId,
            interaction.at,
            dir,
            userId,
          );
          if (!name) return "no_reply_text" as const;
          return await receiptForNote({ userId, path: join(dir, name) });
        } catch {
          return "unavailable" as const;
        }
      }),
    );
    states.splice(start, batch.length, ...batch);
  }
  return states;
}

export async function attachInteractionMemoryReceipts<
  T extends InteractionMemoryLookupKey,
>(
  interactions: readonly T[],
  opts: { userId: string; knowledgeRoot?: string },
): Promise<Array<T & { memory: InteractionMemoryReceipt }>> {
  try {
    const states = await lookupInteractionMemoryReceipts({
      userId: opts.userId,
      interactions,
      knowledgeRoot: opts.knowledgeRoot,
    });
    return interactions.map((row, i) => ({
      ...row,
      memory: { state: states[i] ?? "unavailable" },
    }));
  } catch {
    return interactions.map((row) => ({
      ...row,
      memory: { state: "unavailable" as const },
    }));
  }
}
