/** Client rules for PUT /api/agenda. Matches server MIN/MAX_AGENDA_CHARS. */

export const AGENDA_MIN_CHARS = 40;
export const AGENDA_MAX_CHARS = 5000;
export const AGENDA_DEBOUNCE_MS = 600;

/** Trimmed agenda to persist, or null if it is too short or already saved. */
export function agendaNeedsPersist(
  draft: string,
  saved: string | null,
): string | null {
  const trimmed = draft.trim();
  if (
    trimmed.length < AGENDA_MIN_CHARS ||
    trimmed.length > AGENDA_MAX_CHARS
  ) {
    return null;
  }
  if (saved !== null && trimmed === saved.trim()) return null;
  return trimmed;
}
