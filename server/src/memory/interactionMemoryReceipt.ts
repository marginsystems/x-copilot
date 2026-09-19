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

function resolveNoteName(
  names: string[],
  threadId: string,
  interactedAt: string,
): string | null {
  const expected = expectedNoteName(threadId, interactedAt);
  if (names.includes(expected)) return expected;
  const suffix = noteSuffix(threadId);
  const wantDate = utcDatePrefix(interactedAt);
  const matches = names.filter((name) => name.endsWith(suffix)).sort().reverse();
  if (!matches.length) return null;
  return matches.find((name) => name.startsWith(`${wantDate}-`)) ?? matches[0]!;
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
 * One directory listing plus one read per returned interaction. Never throws.
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

  const states: ConfirmedReplyMemoryState[] = [];
  for (const interaction of opts.interactions) {
    try {
      const name = resolveNoteName(names, interaction.threadId, interaction.at);
      if (!name) {
        states.push("no_reply_text");
        continue;
      }
      states.push(
        await receiptForNote({ userId, path: join(dir, name) }),
      );
    } catch {
      states.push("unavailable");
    }
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
