import type { ChatCompletionResult, ChatMessage } from "./deepseek.js";

export type ChatFn = (opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  purpose?: string;
}) => Promise<ChatCompletionResult>;

export function extractJsonObject(raw: string): unknown | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
