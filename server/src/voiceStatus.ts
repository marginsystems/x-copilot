/**
 * Voice UI status, handle resolution, and the GET /api/voice payload.
 */
import type { AuthUser } from "./authStore.js";
import {
  effectivePlanKey,
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { getXOauthUsername } from "./xIdentityStore.js";
import type { VoiceCard } from "./voiceLlm.js";
import {
  VOICE_UNLOCK_MIN_POSTS,
  getSuggestUsage,
  voiceUnlocked,
  type VoiceProfileRow,
} from "./voiceStore.js";

export type VoiceUiStatus =
  | "unlinked"
  | "empty"
  | "learning"
  | "insufficient"
  | "ready";

export function resolveVoiceHandle(user: AuthUser): string | null {
  return getXOauthUsername(user.id);
}

/**
 * API fill-in only: skip the timeline when memories already unlock, or
 * when there is no handle to pull as.
 */
export function shouldPullXApi(opts: {
  postCount: number;
  handle: string | null;
}): boolean {
  return Boolean(opts.handle) && !voiceUnlocked(opts.postCount);
}

export function deriveVoiceUiStatus(
  profile: VoiceProfileRow | null,
  linkedHandle: string | null,
): VoiceUiStatus {
  if (profile?.status === "learning") return "learning";
  if (profile?.status === "ready" && profile.cardJson) return "ready";
  const posts = profile?.replyCount ?? 0;
  const hasCorpus = posts > 0 || Boolean(profile?.lastPullAt);
  if (hasCorpus && !voiceUnlocked(posts)) return "insufficient";
  if (hasCorpus) return "empty";
  if (!linkedHandle) return "unlinked";
  return "empty";
}

export function deriveNeedsLearn(_opts: {
  status: VoiceUiStatus;
  handle: string | null;
  profile: VoiceProfileRow | null;
  needsDailyUpdate: boolean;
}): boolean {
  // Ingest is onboarding + hourly only. The client must not POST learn.
  return false;
}

function parseCard(cardJson: string | null): VoiceCard | null {
  if (!cardJson) return null;
  try {
    return JSON.parse(cardJson) as VoiceCard;
  } catch {
    return null;
  }
}

export function voicePayload(user: AuthUser, profile: VoiceProfileRow | null) {
  const handle = resolveVoiceHandle(user);
  const tenantId = ensureUserTenant(user.id);
  const billing = ensureUserBillingRow(user.id, tenantId);
  const planKey = effectivePlanKey(billing, user.email);
  const status = deriveVoiceUiStatus(profile, handle);
  const unlocked = voiceUnlocked(profile?.replyCount ?? 0);
  const needsDailyUpdate = false;
  const needsLearn = false;
  return {
    ok: true as const,
    voice: {
      status,
      handle,
      replyCount: profile?.replyCount ?? 0,
      conversationCount: profile?.conversationCount ?? 0,
      unlockAt: VOICE_UNLOCK_MIN_POSTS,
      unlocked,
      card: parseCard(profile?.cardJson ?? null),
      cardUpdatedAt: profile?.cardUpdatedAt ?? null,
      lastPullAt: profile?.lastPullAt ?? null,
      needsDailyUpdate,
      needsLearn,
      lastError: profile?.lastError ?? null,
      suggests: getSuggestUsage(user.id, planKey),
    },
  };
}
