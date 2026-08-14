/**
 * OpenAI-compatible chat client for DeepSeek + Gemini Flash.
 * Query planning / triage use the cheap flash-class model for the selected provider.
 */

export const LLM_PROVIDERS = ["deepseek", "gemini"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
/** Default Scout LLM — Gemini Flash (free-tier friendly). */
export const DEFAULT_LLM_PROVIDER: LlmProvider = "gemini";

export const DEEPSEEK_FLASH_MODEL = "deepseek-chat";
/** Cheapest current Flash alias on Google AI Studio free tier. */
export const GEMINI_FLASH_MODEL = "gemini-flash-lite-latest";
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

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

export function normalizeLlmProvider(value: unknown): LlmProvider {
  if (value === "deepseek" || value === "gemini") return value;
  return DEFAULT_LLM_PROVIDER;
}

/** Operator flag — not a user setting. Unset / unknown → gemini. */
export function resolveLlmProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmProvider {
  return normalizeLlmProvider(env.LLM_PROVIDER?.trim().toLowerCase());
}

export function resolveFlashModel(provider: LlmProvider = DEFAULT_LLM_PROVIDER): string {
  if (provider === "gemini") {
    const fromEnv = (process.env.GEMINI_MODEL ?? "").trim();
    return fromEnv || GEMINI_FLASH_MODEL;
  }
  const fromEnv = (process.env.DEEPSEEK_MODEL ?? "").trim();
  return fromEnv || DEEPSEEK_FLASH_MODEL;
}

export function resolveProviderApiKey(
  provider: LlmProvider,
  override?: string,
): string {
  if (override?.trim()) return override.trim();
  if (provider === "gemini") {
    return (process.env.GEMINI_API_KEY ?? "").trim();
  }
  return (process.env.DEEPSEEK_API_KEY ?? "").trim();
}

export function providerConfigured(provider: LlmProvider): boolean {
  return Boolean(resolveProviderApiKey(provider));
}

export function providerApiKeyEnvName(provider: LlmProvider): string {
  return provider === "gemini" ? "GEMINI_API_KEY" : "DEEPSEEK_API_KEY";
}

export function resolveProviderBaseUrl(provider: LlmProvider): string {
  if (provider === "gemini") {
    return (
      (process.env.GEMINI_BASE_URL ?? "").trim().replace(/\/$/, "") ||
      GEMINI_OPENAI_BASE_URL
    );
  }
  return (
    (process.env.DEEPSEEK_BASE_URL ?? "").trim().replace(/\/$/, "") ||
    "https://api.deepseek.com"
  );
}

/** Parse OpenAI-compatible usage objects (also tolerates Gemini camelCase). */
export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const prompt = numberOrZero(
    u.prompt_tokens ?? u.promptTokenCount ?? u.input_tokens,
  );
  const completion = numberOrZero(
    u.completion_tokens ??
      u.candidatesTokenCount ??
      u.output_tokens ??
      u.completionTokenCount,
  );
  const total = numberOrZero(
    u.total_tokens ?? u.totalTokenCount ?? prompt + completion,
  );
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
  provider: LlmProvider;
  model: string;
  purpose: string;
  usage?: TokenUsage;
}): void {
  const u = opts.usage;
  if (u) {
    console.info(
      `[llm] purpose=${opts.purpose} provider=${opts.provider} model=${opts.model} prompt_tokens=${u.prompt_tokens} completion_tokens=${u.completion_tokens} total_tokens=${u.total_tokens}`,
    );
    return;
  }
  console.info(
    `[llm] purpose=${opts.purpose} provider=${opts.provider} model=${opts.model} usage=unknown`,
  );
}

export async function chatCompletions(opts: {
  messages: ChatMessage[];
  provider?: LlmProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** Logged with token usage (e.g. plan, triage, plan_repair). */
  purpose?: string;
}): Promise<ChatCompletionResult> {
  const provider = normalizeLlmProvider(opts.provider);
  const apiKey = resolveProviderApiKey(provider, opts.apiKey);
  if (!apiKey) {
    const envName = providerApiKeyEnvName(provider);
    return {
      ok: false,
      status: 0,
      error: "missing_api_key",
      message: `Set ${envName} in .env.`,
    };
  }

  const base = (opts.baseUrl ?? resolveProviderBaseUrl(provider)).replace(
    /\/$/,
    "",
  );
  const model = opts.model ?? resolveFlashModel(provider);
  const purpose = opts.purpose ?? "chat";

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  // DeepSeek-specific: disable thinking mode for flash chat.
  if (provider === "deepseek") {
    body.thinking = { type: "disabled" };
  }

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
          error: `${provider}_http`,
          message: `${provider} HTTP ${res.status}: ${text.slice(0, 240)}`,
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
          message: `${provider} returned non-JSON.`,
        };
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content?.trim()) {
        return {
          ok: false,
          status: res.status,
          error: "empty_content",
          message: `${provider} returned empty content.`,
        };
      }

      const usage = parseTokenUsage(data.usage);
      logLlmUsage({ provider, model: data.model || model, purpose, usage });
      return {
        ok: true,
        content,
        model: data.model || model,
        provider,
        ...(usage ? { usage } : {}),
      };
    } finally {
      clearTimeout(tm);
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `${provider}_failed`,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
