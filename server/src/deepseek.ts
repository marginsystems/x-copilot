/**
 * DeepSeek OpenAI-compatible chat client.
 * Query planning always uses V4 Flash (never Pro).
 */

export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult =
  | { ok: true; content: string; model: string }
  | { ok: false; status: number; error: string; message: string };

export function resolveFlashModel(env: NodeJS.ProcessEnv = process.env): string {
  const requested = (env.DEEPSEEK_MODEL || DEEPSEEK_FLASH_MODEL).trim();
  if (requested === "deepseek-v4-pro") {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (!requested) return DEEPSEEK_FLASH_MODEL;
  // Prefer explicit flash; allow deepseek-chat alias only if someone still has it
  if (requested === DEEPSEEK_FLASH_MODEL || requested === "deepseek-chat") {
    return DEEPSEEK_FLASH_MODEL;
  }
  // Any other model → force Flash for planner path
  return DEEPSEEK_FLASH_MODEL;
}

export async function chatCompletions(opts: {
  messages: ChatMessage[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}): Promise<ChatCompletionResult> {
  const apiKey = (opts.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: "missing_api_key",
      message: "Set DEEPSEEK_API_KEY in .env.",
    };
  }

  const base = (opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com")
    .trim()
    .replace(/\/$/, "");
  const model = opts.model ?? resolveFlashModel();

  try {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), 60000);
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        thinking: { type: "disabled" },
      }),
      signal: ac.signal,
    }).finally(() => clearTimeout(tm));

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: "deepseek_http",
        message: `DeepSeek HTTP ${res.status}: ${text.slice(0, 240)}`,
      };
    }

    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: res.status,
        error: "invalid_json",
        message: "DeepSeek returned non-JSON.",
      };
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      return {
        ok: false,
        status: res.status,
        error: "empty_content",
        message: "DeepSeek returned empty content.",
      };
    }

    return { ok: true, content, model: data.model || model };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "deepseek_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
