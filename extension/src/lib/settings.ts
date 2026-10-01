export const ATTENTION_GATE_KEY = "attentionGate";

export function parseAttentionGate(raw: unknown): boolean {
  return raw !== false;
}
