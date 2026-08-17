/**
 * Assisted-reply client helpers: voice state types, loading-phase copy, and
 * the cheap local edit hint. The server + DeepSeek verify is the real gate —
 * this only saves a round trip on obviously trivial edits.
 * Keep the normalization in sync with server/src/voiceEdit.ts.
 */

export type VoiceCardData = {
  tone: string;
  typicalLength: string;
  habits: string[];
  neverDo: string[];
  examples: string[];
};

export type SuggestUsage = {
  used: number;
  limit: number;
  remaining: number;
  canSuggest: boolean;
  planKey: string;
};

export type VoiceStatus =
  | "unlinked"
  | "empty"
  | "learning"
  | "insufficient"
  | "ready";

export type VoiceState = {
  status: VoiceStatus;
  handle: string | null;
  replyCount: number;
  conversationCount: number;
  unlockAt: number;
  unlocked: boolean;
  card: VoiceCardData | null;
  cardUpdatedAt: string | null;
  lastPullAt: string | null;
  needsDailyUpdate: boolean;
  needsLearn: boolean;
  lastError: string | null;
  suggests: SuggestUsage;
};

export function parseVoiceState(raw: unknown): VoiceState | null {
  const voice = (raw as { voice?: unknown })?.voice as
    | Record<string, unknown>
    | undefined;
  if (!voice || typeof voice.status !== "string") return null;
  const suggests = (voice.suggests ?? {}) as Record<string, unknown>;
  const card = voice.card as VoiceCardData | null | undefined;
  return {
    status: voice.status as VoiceStatus,
    handle: typeof voice.handle === "string" ? voice.handle : null,
    replyCount: Number(voice.replyCount) || 0,
    conversationCount: Number(voice.conversationCount) || 0,
    unlockAt: Number(voice.unlockAt) || 100,
    unlocked: voice.unlocked === true,
    card:
      card && typeof card.tone === "string" && Array.isArray(card.examples)
        ? {
            tone: card.tone,
            typicalLength:
              typeof card.typicalLength === "string" ? card.typicalLength : "",
            habits: Array.isArray(card.habits) ? card.habits : [],
            neverDo: Array.isArray(card.neverDo) ? card.neverDo : [],
            examples: card.examples,
          }
        : null,
    cardUpdatedAt:
      typeof voice.cardUpdatedAt === "string" ? voice.cardUpdatedAt : null,
    lastPullAt: typeof voice.lastPullAt === "string" ? voice.lastPullAt : null,
    needsDailyUpdate: voice.needsDailyUpdate === true,
    needsLearn: voice.needsLearn === true,
    lastError: typeof voice.lastError === "string" ? voice.lastError : null,
    suggests: {
      used: Number(suggests.used) || 0,
      limit: Number(suggests.limit) || 0,
      remaining: Number(suggests.remaining) || 0,
      canSuggest: suggests.canSuggest === true,
      planKey: typeof suggests.planKey === "string" ? suggests.planKey : "free",
    },
  };
}

// --- Local edit hint (mirror of the server's trivial-edit gate) ---

export function normalizeForEditHint(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function editDistanceCapped(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, sub);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]!;
  }
  return Math.min(prev[b.length]!, cap + 1);
}

/** null = looks substantive enough to send to the server verify. */
export function localEditHint(draft: string, edited: string): string | null {
  const editedTrim = edited.trim();
  if (!editedTrim) return "Write your reply — the draft is a starting point.";
  if (editedTrim.length > 280) return "Over 280 characters — trim it a little.";
  if (draft.trim() === editedTrim) {
    return "Make it yours — swap a phrase, add a thought.";
  }
  const a = normalizeForEditHint(draft);
  const b = normalizeForEditHint(editedTrim);
  if (!b) {
    return "Punctuation, spacing, or capitalization alone doesn't count. Change something real.";
  }
  if (a === b) {
    return "Punctuation or casing alone won't pass — change something real.";
  }
  if (editDistanceCapped(a, b, 2) <= 2) {
    return "That's a very small touch — rework a clause or add your own take.";
  }
  return null;
}

// --- Loading-phase copy (cycled while a call is in flight) ---

export type VoicePhase = { id: string; label: string };

export const LEARN_PHASES: readonly VoicePhase[] = [
  { id: "pull", label: "Reading your public posts…" },
  { id: "listen", label: "Listening for tone and habits…" },
  { id: "write", label: "Writing your voice card…" },
];

export const SUGGEST_PHASES: readonly VoicePhase[] = [
  { id: "read", label: "Reading the thread…" },
  { id: "voice", label: "Finding your voice…" },
  { id: "draft", label: "Drafting one reply…" },
];

export const VERIFY_PHASES: readonly VoicePhase[] = [
  { id: "compare", label: "Comparing against the draft…" },
  { id: "check", label: "Checking it reads like you…" },
];

/** Advance through phases on a timer, holding on the last one. */
export function phaseIndexAt(
  phases: readonly VoicePhase[],
  elapsedMs: number,
  stepMs = 1800,
): number {
  if (phases.length === 0) return 0;
  return Math.min(Math.floor(Math.max(0, elapsedMs) / stepMs), phases.length - 1);
}

export function suggestsLeftLabel(usage: SuggestUsage): string {
  if (usage.remaining <= 0) return "0 suggests left today — refills 00:00 UTC";
  return `${usage.remaining} of ${usage.limit} suggests left today`;
}

/** Progress toward the 100-post unlock, clamped for the meter. */
export function unlockProgress(state: {
  replyCount: number;
  unlockAt: number;
}): number {
  if (state.unlockAt <= 0) return 0;
  return Math.max(
    0,
    Math.min(1, state.replyCount / state.unlockAt),
  );
}

export const VOICE_LINK_X_COPY =
  "Voice and Suggest need your X account. Link X so we can read your latest public posts at setup and hourly. Scout is the only action that spends credits.";

export const VOICE_LINK_X_TIP =
  "Without an X account we cannot learn your voice or suggest replies.";

/** True when Voice/Suggest cannot run because official X OAuth is missing. */
export function voiceNeedsXLink(
  voice: VoiceState | null,
  xLinked?: boolean | null,
): boolean {
  if (xLinked) return false;
  if (voice?.handle) return false;
  return true;
}

export const VOICE_UNLOCK_TOAST_KEY = "xc.voiceUnlockToast.dismissed";

/**
 * Desk toast only after Voice has loaded, and only while Suggest is still
 * locked. Never flash the default copy and then hide it.
 */
export function shouldShowVoiceUnlockToast(opts: {
  voice: VoiceState | null;
  hasSession: boolean;
}): boolean {
  if (!opts.hasSession) return false;
  if (!opts.voice) return false;
  if (opts.voice.status === "ready" && opts.voice.unlocked) return false;
  return true;
}

/** Plain-language next step so Suggest is never a mystery. */
export function voiceUnlockCopy(state: VoiceState | null): string {
  const need = state?.unlockAt ?? 100;
  const n = state?.replyCount ?? 0;
  if (state?.status === "unlinked") return VOICE_LINK_X_COPY;
  if (!state) {
    return `Suggest unlocks at ${need} public posts. We read your latest posts once at setup, then hourly. Mark posts on the desk to add more. Scout is the only action that spends credits.`;
  }
  if (state.lastError) return state.lastError;
  if (state.status === "learning") {
    return "Reading your public posts and writing a voice card…";
  }
  if (state.status === "empty" && n === 0) {
    return `Nothing in the corpus yet. The hourly ingest will retry. Need ${need} posts — mark on the desk to add more.`;
  }
  if (state.status === "empty") {
    return n >= need
      ? `Found ${n} posts — you've hit ${need}. The hourly ingest writes the voice card on its next pass.`
      : `Found ${n} posts. The hourly ingest writes the voice card when you hit ${need}.`;
  }
  if (state.status === "insufficient") {
    return `Suggest unlocks at ${need} public posts — you're at ${n}. The hourly ingest adds new posts; marking on the desk counts too.`;
  }
  return state.lastError ?? "";
}
