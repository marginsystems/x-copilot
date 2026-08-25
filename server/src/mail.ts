/**
 * Resend delivery for the explicit-opt-in Approach digest.
 * Secrets remain server-side; missing configuration is a safe no-op.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  digestEmailSentToday,
  getDigestEmailSettings,
  markDigestEmailSent,
} from "./digestEmailStore.js";
import type { ForYouSuggestion } from "./forYouStore.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "x-copilot <hello@info.xcopilot.dev>";
const DEFAULT_REPLY_TO = "contact@mergestorm.ai";
const DESK_URL = "https://xcopilot.dev/dashboard";

type FetchLike = typeof fetch;

export type DigestMailResult = {
  sent: boolean;
  reason:
    | "sent"
    | "not_configured"
    | "not_opted_in"
    | "no_email"
    | "already_sent"
    | "no_suggestions"
    | "provider_error";
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenSecret(env: NodeJS.ProcessEnv): string {
  return env.RESEND_API_KEY?.trim() ?? "";
}

function tokenSignature(encodedUserId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`approach-unsubscribe:${encodedUserId}`)
    .digest("base64url");
}

export function makeUnsubscribeToken(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = tokenSecret(env);
  if (!secret) return null;
  const encodedUserId = Buffer.from(userId, "utf8").toString("base64url");
  return `${encodedUserId}.${tokenSignature(encodedUserId, secret)}`;
}

export function verifyUnsubscribeToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = tokenSecret(env);
  if (!secret) return null;
  const [encodedUserId, supplied, extra] = token.split(".");
  if (!encodedUserId || !supplied || extra) return null;
  const expected = tokenSignature(encodedUserId, secret);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const userId = Buffer.from(encodedUserId, "base64url").toString("utf8");
    return userId.trim() || null;
  } catch {
    return null;
  }
}

function digestBody(
  suggestions: ForYouSuggestion[],
  unsubscribeUrl: string,
): { html: string; text: string } {
  const whys = suggestions
    .slice(0, 4)
    .map((row) => row.why.trim())
    .filter(Boolean);
  const textItems = whys.map((why) => `- ${why}`).join("\n");
  const htmlItems = whys
    .map((why) => `<li>${escapeHtml(why)}</li>`)
    .join("");
  return {
    text: [
      "Your Approach is ready",
      "",
      "x-copilot found your next moves from your recent post performance:",
      textItems,
      "",
      `Open your desk: ${DESK_URL}`,
      "",
      "Built by Mergestorm, Inc. Not affiliated with X Corp.",
      `Questions? ${DEFAULT_REPLY_TO}`,
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join("\n"),
    html: [
      "<h1>Your Approach is ready</h1>",
      "<p>x-copilot found your next moves from your recent post performance:</p>",
      `<ul>${htmlItems}</ul>`,
      `<p><a href="${DESK_URL}">Open your desk</a></p>`,
      "<hr>",
      "<p>Built by Mergestorm, Inc. Not affiliated with X Corp.</p>",
      `<p>Questions? <a href="mailto:${DEFAULT_REPLY_TO}">${DEFAULT_REPLY_TO}</a></p>`,
      `<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from Approach email</a></p>`,
    ].join(""),
  };
}

export async function sendApproachDigestEmail(opts: {
  userId: string;
  suggestions: ForYouSuggestion[];
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): Promise<DigestMailResult> {
  const env = opts.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  if (!opts.suggestions.length) {
    return { sent: false, reason: "no_suggestions" };
  }
  const settings = getDigestEmailSettings(opts.userId);
  if (!settings?.optedIn) return { sent: false, reason: "not_opted_in" };
  if (!settings.email) return { sent: false, reason: "no_email" };
  const nowMs = opts.nowMs ?? Date.now();
  if (digestEmailSentToday(settings, nowMs)) {
    return { sent: false, reason: "already_sent" };
  }
  const token = makeUnsubscribeToken(opts.userId, env);
  if (!token) return { sent: false, reason: "not_configured" };
  const unsubscribeUrl = `https://api.xcopilot.dev/api/mail/unsubscribe?t=${encodeURIComponent(token)}`;
  const body = digestBody(opts.suggestions, unsubscribeUrl);
  const day = new Date(nowMs).toISOString().slice(0, 10);

  try {
    const response = await (opts.fetchImpl ?? fetch)(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `approach/${opts.userId}/${day}`,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: env.MAIL_FROM?.trim() || DEFAULT_FROM,
        to: [settings.email],
        reply_to: env.MAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
        subject: "Your Approach is ready",
        html: body.html,
        text: body.text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!response.ok) {
      console.warn(`[mail] Resend failed status=${response.status}`);
      return { sent: false, reason: "provider_error" };
    }
    markDigestEmailSent(opts.userId, nowMs);
    return { sent: true, reason: "sent" };
  } catch (err) {
    console.warn(
      "[mail] Resend soft-fail:",
      err instanceof Error ? err.message : String(err),
    );
    return { sent: false, reason: "provider_error" };
  }
}
