/** First-run questionnaire options and local completion flag. */

export const ONBOARDING_STORAGE_KEY = "xc-onboarding-complete";
export const ONBOARDING_AGENDA_KEY = "xc-onboarding-agenda";

/** real = signed-in complete POST + localStorage; local = localStorage only; preview = neither. */
export type OnboardingMode = "real" | "local" | "preview";

export function resolveOnboardingMode(
  mode?: OnboardingMode,
  persist?: boolean,
): OnboardingMode {
  if (mode) return mode;
  return persist ? "real" : "local";
}

export function onboardingPostsComplete(mode: OnboardingMode): boolean {
  return mode === "real";
}

export function onboardingWritesLocalStorage(mode: OnboardingMode): boolean {
  return mode !== "preview";
}

/**
 * First-run wizard. Server completion wins when a session exists.
 * localStorage is only the signed-out local flow.
 */
export function needsOnboardingWizard(opts: {
  needsLogin: boolean;
  onboardingDoneLocal: boolean;
  authUser: { onboardingCompleted: boolean } | null;
  localComplete: boolean;
}): boolean {
  if (opts.needsLogin || opts.onboardingDoneLocal) return false;
  if (opts.authUser) return opts.authUser.onboardingCompleted === false;
  return !opts.localComplete;
}

/** Deep-link `?onboarding=preview` — admin only. Caller strips the param so reload exits. */
export function consumeOnboardingPreviewQuery(
  search: string,
  isAdmin: boolean,
): { open: boolean; nextSearch: string } {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (!isAdmin || params.get("onboarding") !== "preview") {
    return { open: false, nextSearch: search };
  }
  params.delete("onboarding");
  const qs = params.toString();
  return { open: true, nextSearch: qs ? `?${qs}` : "" };
}

function scopedKey(base: string, userId?: string): string {
  return userId ? `${base}:${userId}` : base;
}

export type OnboardingOption = { id: string; label: string };

export const TOPIC_OPTIONS: OnboardingOption[] = [
  { id: "ai", label: "AI & machine learning" },
  { id: "software", label: "Software engineering" },
  { id: "startups", label: "Startups & shipping" },
  { id: "design", label: "Design & product" },
  { id: "science", label: "Science & research" },
  { id: "crypto", label: "Markets & crypto" },
  { id: "culture", label: "Culture & media" },
  { id: "career", label: "Career & work" },
  { id: "policy", label: "Policy & society" },
  { id: "creators", label: "Creators & audience" },
];

export const GOAL_OPTIONS: OnboardingOption[] = [
  { id: "reply", label: "Find threads worth a human reply" },
  { id: "grow", label: "Grow by joining real conversations" },
  { id: "research", label: "Research a niche" },
  { id: "meet", label: "Meet people in my field" },
  { id: "signal", label: "Stay current without the noise" },
];

export const AUDIENCE_OPTIONS: OnboardingOption[] = [
  { id: "founders", label: "Founders & operators" },
  { id: "engineers", label: "Engineers & builders" },
  { id: "researchers", label: "Researchers & writers" },
  { id: "designers", label: "Designers & product people" },
  { id: "investors", label: "Investors" },
  { id: "journalists", label: "Journalists & commentators" },
];

export type GeneratedAgenda = {
  title: string;
  body: string;
  recommended: boolean;
};

export function agendaSeedFromStored(
  value?: string | null,
): GeneratedAgenda | null {
  const body = value?.trim() ?? "";
  if (body.length < 40) return null;
  return {
    title: "Your agenda",
    body,
    recommended: true,
  };
}

export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id];
}

export function labelsFor(ids: string[], options: OnboardingOption[]): string[] {
  const map = new Map(options.map((opt) => [opt.id, opt.label]));
  return ids
    .map((id) => map.get(id))
    .filter((label): label is string => Boolean(label));
}

export function readOnboardingComplete(userId?: string): boolean {
  try {
    if (
      localStorage.getItem(scopedKey(ONBOARDING_STORAGE_KEY, userId)) === "1"
    ) {
      return true;
    }
    if (userId && localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1") {
      localStorage.setItem(scopedKey(ONBOARDING_STORAGE_KEY, userId), "1");
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function writeOnboardingComplete(agenda?: string, userId?: string): void {
  try {
    localStorage.setItem(scopedKey(ONBOARDING_STORAGE_KEY, userId), "1");
    writeOnboardingAgenda(agenda, userId);
  } catch {
    /* private mode */
  }
}

/** Store an agenda without marking first-run complete (for landing → sign-in). */
export function writeOnboardingAgenda(
  agenda?: string,
  userId?: string,
): void {
  try {
    const key = scopedKey(ONBOARDING_AGENDA_KEY, userId);
    if (agenda?.trim()) localStorage.setItem(key, agenda.trim());
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function readOnboardingAgenda(userId?: string): string | null {
  try {
    const value = localStorage.getItem(
      scopedKey(ONBOARDING_AGENDA_KEY, userId),
    );
    if (value && value.trim()) {
      if (userId) localStorage.removeItem(ONBOARDING_AGENDA_KEY);
      return value;
    }
    if (!userId) return null;
    const unscoped = localStorage.getItem(ONBOARDING_AGENDA_KEY);
    if (unscoped && unscoped.trim()) {
      localStorage.setItem(scopedKey(ONBOARDING_AGENDA_KEY, userId), unscoped);
      localStorage.removeItem(ONBOARDING_AGENDA_KEY);
      return unscoped;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseGeneratedAgendas(value: unknown): GeneratedAgenda[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const agendas: GeneratedAgenda[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!title || body.length < 40) continue;
    agendas.push({
      title,
      body,
      recommended: row.recommended === true,
    });
  }
  if (agendas.length < 2) return null;
  const rec = agendas.findIndex((a) => a.recommended);
  if (rec === -1) agendas[0].recommended = true;
  else {
    agendas.forEach((a, i) => {
      a.recommended = i === rec;
    });
  }
  return agendas;
}
