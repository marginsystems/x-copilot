/**
 * Once-per-UTC-day For You pass. Rank in SQL, one LLM call, write SQL rows.
 */
import { deepseekConfigured } from "./deepseek.js";
import { ensureUserTenant } from "./billingStore.js";
import {
  buildForYouDigest,
  countT24hSnapshots,
  listEligibleForYouUsers,
  MIN_T24H_SNAPSHOTS,
} from "./forYouDigest.js";
import { draftForYouActions } from "./forYouLlm.js";
import type { ChatFn } from "./voiceLlm.js";
import {
  hasForYouRunToday,
  replaceDailySuggestions,
} from "./forYouStore.js";

export type ForYouRunResult = {
  ran: number;
  wrote: number;
  skipped: number;
};

export async function runForYouDigestForUser(opts: {
  userId: string;
  tenantId?: string;
  nowMs?: number;
  chat?: ChatFn;
  getScout?: Parameters<typeof buildForYouDigest>[0]["getScout"];
}): Promise<{ wrote: number; reason: string }> {
  const nowMs = opts.nowMs ?? Date.now();
  if (hasForYouRunToday(opts.userId, nowMs)) {
    return { wrote: 0, reason: "already_ran" };
  }
  if (countT24hSnapshots(opts.userId) < MIN_T24H_SNAPSHOTS) {
    return { wrote: 0, reason: "thin" };
  }
  if (!opts.chat && !deepseekConfigured()) {
    return { wrote: 0, reason: "no_llm" };
  }
  const digest = await buildForYouDigest({
    userId: opts.userId,
    getScout: opts.getScout,
  });
  const drafts = await draftForYouActions({
    digest,
    chat: opts.chat,
  });
  if (drafts.length < 1) {
    return { wrote: 0, reason: "empty" };
  }
  const tenantId = opts.tenantId?.trim() || ensureUserTenant(opts.userId);
  const rows = replaceDailySuggestions({
    userId: opts.userId,
    tenantId,
    drafts,
    nowMs,
  });
  return { wrote: rows.length, reason: "ok" };
}

export async function runForYouDigests(opts?: {
  nowMs?: number;
  chat?: ChatFn;
  users?: Array<{ userId: string; tenantId: string }>;
}): Promise<ForYouRunResult> {
  const users = opts?.users ?? listEligibleForYouUsers();
  let ran = 0;
  let wrote = 0;
  let skipped = 0;
  for (const user of users) {
    const result = await runForYouDigestForUser({
      userId: user.userId,
      tenantId: user.tenantId,
      nowMs: opts?.nowMs,
      chat: opts?.chat,
    });
    if (result.reason === "ok") {
      ran += 1;
      wrote += result.wrote;
    } else if (result.reason === "already_ran" || result.reason === "thin") {
      skipped += 1;
    } else {
      skipped += 1;
    }
  }
  return { ran, wrote, skipped };
}
