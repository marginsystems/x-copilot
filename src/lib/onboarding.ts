/** First-run questionnaire options and local completion flag. */

export const ONBOARDING_STORAGE_KEY = "xc-onboarding-complete";
export const ONBOARDING_AGENDA_KEY = "xc-onboarding-agenda";

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

export function readOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingComplete(agenda?: string): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    if (agenda) localStorage.setItem(ONBOARDING_AGENDA_KEY, agenda);
    else localStorage.removeItem(ONBOARDING_AGENDA_KEY);
  } catch {
    /* private mode */
  }
}

export function readOnboardingAgenda(): string | null {
  try {
    const value = localStorage.getItem(ONBOARDING_AGENDA_KEY);
    return value && value.trim() ? value : null;
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
