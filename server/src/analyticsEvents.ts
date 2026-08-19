/**
 * Allowlisted analytics events the sidecar accepts and formats for Slack.
 * Keep this catalog small — product signals, not APM.
 */

export const ANALYTICS_EVENT_NAMES = [
  "user.signup",
  "user.signin",
  "scout.takeoff",
  "scout.failed",
  "mark.interacted",
  "voice.suggest",
  "desk.post",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  at: string;
  userId?: string;
  email?: string;
  handle?: string;
  provider?: string;
  detail?: string;
  ok?: boolean;
};

const NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);

const SLACK_LABEL: Record<AnalyticsEventName, string> = {
  "user.signup": "signup",
  "user.signin": "sign-in",
  "scout.takeoff": "takeoff",
  "scout.failed": "scout failed",
  "mark.interacted": "mark",
  "voice.suggest": "suggest",
  "desk.post": "desk post",
};

const MAX_FIELD = 200;
const MAX_DETAIL = 280;

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return NAME_SET.has(value);
}

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function clipHandle(value: unknown): string | undefined {
  const raw = clip(value, MAX_FIELD);
  if (!raw) return undefined;
  return raw.replace(/^@+/, "");
}

/**
 * Normalize a POST /event body. Unknown names and empty payloads fail.
 */
export function parseAnalyticsEvent(
  raw: unknown,
  now: () => Date = () => new Date(),
): { ok: true; event: AnalyticsEvent } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "expected_object" };
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!isAnalyticsEventName(name)) {
    return { ok: false, error: "unknown_event" };
  }
  const atRaw = clip(body.at, 40);
  const at = atRaw && !Number.isNaN(Date.parse(atRaw)) ? new Date(atRaw).toISOString() : now().toISOString();
  const event: AnalyticsEvent = { name, at };
  const userId = clip(body.userId, 80);
  if (userId) event.userId = userId;
  const email = clip(body.email, MAX_FIELD);
  if (email) event.email = email;
  const handle = clipHandle(body.handle);
  if (handle) event.handle = handle;
  const provider = clip(body.provider, 40);
  if (provider) event.provider = provider;
  const detail = clip(body.detail, MAX_DETAIL);
  if (detail) event.detail = detail;
  if (typeof body.ok === "boolean") event.ok = body.ok;
  return { ok: true, event };
}

/** Slack mrkdwn: escape & < > so untrusted user-supplied fields can't inject mentions/links. */
function slackEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One Slack text blob — no tokens, no request bodies. */
export function formatSlackText(event: AnalyticsEvent): string {
  const bits = [`*${SLACK_LABEL[event.name]}*`];
  if (event.email) bits.push(slackEscape(event.email));
  if (event.handle) bits.push(`@${slackEscape(event.handle)}`);
  if (event.provider) bits.push(slackEscape(event.provider));
  if (event.ok === false) bits.push("failed");
  if (event.detail) bits.push(slackEscape(event.detail));
  const line = bits.join(" · ");
  return event.userId ? `${line}\n\`${slackEscape(event.userId)}\`` : line;
}
