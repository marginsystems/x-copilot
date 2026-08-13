/** First-run onboarding: validate answers and persist a chosen agenda. */

export const MIN_AGENDA_CHARS = 40;
export const MAX_AGENDA_CHARS = 5000;

export function validateAgendaText(
  value: unknown,
): { ok: true; agenda: string } | { ok: false; error: string; message: string } {
  if (typeof value !== "string") {
    return {
      ok: false,
      error: "bad_request",
      message: "Pass { agenda: string }.",
    };
  }
  const agenda = value.trim();
  if (agenda.length < MIN_AGENDA_CHARS) {
    return {
      ok: false,
      error: "agenda_too_short",
      message: `Agenda must be at least ${MIN_AGENDA_CHARS} characters.`,
    };
  }
  if (agenda.length > MAX_AGENDA_CHARS) {
    return {
      ok: false,
      error: "agenda_too_long",
      message: `Agenda exceeds ${MAX_AGENDA_CHARS} characters.`,
    };
  }
  return { ok: true, agenda };
}
