/**
 * OpenAI-compatible DeepSeek chat client.
 * Query planning / triage / onboarding use DeepSeek v4-flash.
 */

export type LlmProvider = "deepseek";

/** Default Scout LLM. Override with DEEPSEEK_MODEL. */
export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatCompletionResult =
  | {
      ok: true;
      content: string;
      model: string;
      provider: LlmProvider;
      usage?: TokenUsage;
    }
  | { ok: false; status: number; error: string; message: string };

export function resolveFlashModel(): string {
  return (process.env.DEEPSEEK_MODEL ?? "").trim() || DEEPSEEK_FLASH_MODEL;
}

export function resolveDeepseekApiKey(override?: string): string {
  if (override?.trim()) return override.trim();
  return (process.env.DEEPSEEK_API_KEY ?? "").trim();
}

export function deepseekConfigured(): boolean {
  return Boolean(resolveDeepseekApiKey());
}

export function resolveDeepseekBaseUrl(): string {
  return (
    (process.env.DEEPSEEK_BASE_URL ?? "").trim().replace(/\/$/, "") ||
    "https://api.deepseek.com"
  );
}

/** Parse OpenAI-compatible usage objects. */
export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const prompt = numberOrZero(u.prompt_tokens ?? u.input_tokens);
  const completion = numberOrZero(u.completion_tokens ?? u.output_tokens);
  const total = numberOrZero(u.total_tokens ?? prompt + completion);
  if (prompt === 0 && completion === 0 && total === 0) return undefined;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function addTokenUsage(
  a?: TokenUsage,
  b?: TokenUsage,
): TokenUsage | undefined {
  if (!a && !b) return undefined;
  const prompt_tokens = (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0);
  const completion_tokens =
    (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0);
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

export function logLlmUsage(opts: {
  model: string;
  purpose: string;
  usage?: TokenUsage;
}): void {
  const u = opts.usage;
  if (u) {
    console.info(
      `[llm] purpose=${opts.purpose} provider=deepseek model=${opts.model} prompt_tokens=${u.prompt_tokens} completion_tokens=${u.completion_tokens} total_tokens=${u.total_tokens}`,
    );
    return;
  }
  console.info(
    `[llm] purpose=${opts.purpose} provider=deepseek model=${opts.model} usage=unknown`,
  );
}

export async function chatCompletions(opts: {
  messages: ChatMessage[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** Logged with token usage (e.g. plan, triage, plan_repair). */
  purpose?: string;
}): Promise<ChatCompletionResult> {
  const apiKey = resolveDeepseekApiKey(opts.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: "missing_api_key",
      message: "Set DEEPSEEK_API_KEY in .env.",
    };
  }

  const base = (opts.baseUrl ?? resolveDeepseekBaseUrl()).replace(/\/$/, "");
  const model = opts.model ?? resolveFlashModel();
  const purpose = opts.purpose ?? "chat";

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    thinking: { type: "disabled" },
  };

  try {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), 60000);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: "deepseek_http",
          message: `deepseek HTTP ${res.status}: ${text.slice(0, 240)}`,
        };
      }

      let data: {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: unknown;
      };
      try {
        data = JSON.parse(text);
      } catch {
        return {
          ok: false,
          status: res.status,
          error: "invalid_json",
          message: "deepseek returned non-JSON.",
        };
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content?.trim()) {
        return {
          ok: false,
          status: res.status,
          error: "empty_content",
          message: "deepseek returned empty content.",
        };
      }

      const usage = parseTokenUsage(data.usage);
      logLlmUsage({ model: data.model || model, purpose, usage });
      return {
        ok: true,
        content,
        model: data.model || model,
        provider: "deepseek",
        ...(usage ? { usage } : {}),
      };
    } finally {
      clearTimeout(tm);
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "deepseek_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
