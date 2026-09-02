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
  recordForYouRun,
  replaceDailySuggestions,
} from "./forYouStore.js";
import { sendApproachDigestEmail } from "./mail.js";

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
  if (digest.leftoverScout.length === 0 && !digest.agenda) {
    recordForYouRun(opts.userId, nowMs);
    return { wrote: 0, reason: "empty" };
  }
  const result = await draftForYouActions({
    digest,
    chat: opts.chat,
  });
  if (!result.ok) {
    if (result.exhausted) {
      recordForYouRun(opts.userId, nowMs);
      return { wrote: 0, reason: "empty" };
    }
    return { wrote: 0, reason: "llm_error" };
  }
  if (result.drafts.length < 2) {
    recordForYouRun(opts.userId, nowMs);
    return { wrote: 0, reason: "empty" };
  }
  const tenantId = opts.tenantId?.trim() || ensureUserTenant(opts.userId);
  const rows = replaceDailySuggestions({
    userId: opts.userId,
    tenantId,
    drafts: result.drafts,
    nowMs,
  });
  try {
    const mail = await sendApproachDigestEmail({
      userId: opts.userId,
      suggestions: rows,
      nowMs,
    });
    if (mail.sent) {
      console.log(`[mail] Approach digest sent user=${opts.userId}`);
    }
  } catch (err) {
    console.warn(
      "[mail] Approach digest soft-fail:",
      err instanceof Error ? err.message : String(err),
    );
  }
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
