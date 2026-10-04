export type NextConfirmSubject = "reply" | "post";

export type NextAsk = { cardKey: string };

export type NextClick =
  | { action: "advance"; ask: null }
  | { action: "ask"; ask: NextAsk };

export const NEXT_LABEL = "Next";
export const NEXT_CONFIRM_SKIP_LABEL = "Skip card";
export const NEXT_CONFIRM_KEEP_LABEL = "Keep waiting";

export function nextConfirmCopy(subject: NextConfirmSubject): string {
  return `No ${subject} detected yet. Skip this card?`;
}

export function nextClick(input: { detected: boolean; cardKey: string }): NextClick {
  return input.detected
    ? { action: "advance", ask: null }
    : { action: "ask", ask: { cardKey: input.cardKey } };
}

export function nextAskActive(
  ask: NextAsk | null,
  input: { detected: boolean; cardKey: string },
): boolean {
  return ask !== null && !input.detected && ask.cardKey === input.cardKey;
}
