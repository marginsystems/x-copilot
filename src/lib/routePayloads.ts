import type { AccountPayload, PublicSession } from "../Account";
import type { AnalyticsPayload } from "../Analytics";
import type { BillingMe } from "../BillingPanel";
import type { UsageSummaryResponse } from "../usage/types";

function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
const string = (v: unknown) => typeof v === "string";
const nullableString = (v: unknown) => v === null || string(v);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const boolean = (v: unknown) => typeof v === "boolean";
function fields(v: Record<string, unknown>, keys: string, check: (v: unknown) => boolean) {
  return keys.split(" ").every((key) => check(v[key]));
}
function optional(v: Record<string, unknown>, keys: string, check: (v: unknown) => boolean) {
  return fields(v, keys, (value) => value === undefined || check(value));
}
function rows<T>(v: unknown, check: (v: unknown) => v is T): v is T[];
function rows(v: unknown, check: (v: unknown) => boolean): boolean;
function rows(v: unknown, check: (v: unknown) => boolean) {
  return Array.isArray(v) && v.every(check);
}
function envelope(v: unknown): v is Record<string, unknown> {
  return object(v) && optional(v, "ok", boolean) && v.ok !== false &&
    optional(v, "error message", string);
}
export function payloadError(v: unknown, fallback: string): string {
  return object(v) && typeof v.message === "string" ? v.message :
    object(v) && typeof v.error === "string" ? v.error : fallback;
}
function session(v: unknown): v is PublicSession {
  return object(v) && fields(v, "id createdAt lastSeenAt browser os", string) &&
    nullableString(v.ip) && boolean(v.current);
}
function isSessions(v: unknown): v is { sessions: PublicSession[]; signedOut?: boolean } {
  return envelope(v) && v.ok === true && rows(v.sessions, session) &&
    optional(v, "signedOut", boolean);
}
export function parseSessions(v: unknown): { sessions: PublicSession[]; signedOut?: boolean } | null {
  if (envelope(v) && v.ok === true && v.signedOut === true) return { signedOut: true, sessions: [] };
  return isSessions(v) ? v : null;
}
function isMail(v: unknown): v is { digestEmailOptIn: boolean; digestEmailAvailable: boolean } {
  return envelope(v) && fields(v, "digestEmailOptIn digestEmailAvailable", boolean);
}
export function parseMail(v: unknown): { digestEmailOptIn: boolean; digestEmailAvailable: boolean } | null {
  return isMail(v) ? v : null;
}
export function parseAccount(v: unknown): AccountPayload | null {
  return envelope(v) && v.ok === true && object(v.user) &&
    fields(v.user, "displayName email avatarUrl xUsername", nullableString) &&
    optional(v.user, "xCanPost", boolean) &&
    (v.mail === undefined || parseMail(v.mail) !== null) &&
    rows(v.providers, (p) => object(p) && (p.provider === "google" || p.provider === "x") &&
      fields(p, "username email", nullableString)) && rows(v.sessions, session) ? v as AccountPayload : null;
}
function activity(v: unknown) {
  return object(v) && fields(v, "used limit remaining", number) && boolean(v.can_watch) && string(v.planKey);
}
const kind = (v: unknown) => typeof v === "string" && ["original", "reply", "quote", "repost"].includes(v);
export function parseAnalytics(v: unknown): AnalyticsPayload | null {
  return envelope(v) && object(v.totals) &&
    fields(v.totals, "posts originals replies quotes reposts views likes replyCount retweets bookmarks", number) &&
    (v.activity === undefined || activity(v.activity)) &&
    (v.insight === undefined || v.insight === null || (object(v.insight) &&
      fields(v.insight, "headline day createdAt", string) && rows(v.insight.bullets, string))) &&
    rows(v.series, (r) => object(r) && string(r.day) && fields(r, "posts views likes", number)) &&
    rows(v.kinds, (r) => object(r) && kind(r.key) && number(r.count)) &&
    rows(v.top, (r) => object(r) && fields(r, "id postedAt", string) &&
      fields(r, "text url", nullableString) && kind(r.kind) &&
      fields(r, "views likes replies retweets bookmarks", number)) ? v as AnalyticsPayload : null;
}
function isUsage(v: unknown): v is UsageSummaryResponse {
  return envelope(v) && v.ok === true && typeof v.window === "string" && ["24h", "7d", "all"].includes(v.window) &&
    fields(v, "calls creditsUsed creditLimit remaining", number) &&
    optional(v, "tenantSlug note", string) && optional(v, "creditsDepletedRecent", boolean) &&
    rows(v.recent, (r) => object(r) && fields(r, "id at activity", string) &&
      fields(r, "status credits", number) && nullableString(r.error) &&
      (r.remaining === null || number(r.remaining)));
}
export function parseUsage(v: unknown): UsageSummaryResponse | null {
  return isUsage(v) ? v : null;
}
export function parseBilling(v: unknown): BillingMe | null {
  if (!envelope(v) || !string(v.plan_key) || !optional(v, "plan_state", string) ||
    !optional(v, "subscription_status", nullableString) ||
    !optional(v, "has_stripe_subscription operator_allotment stripe_configured", boolean)) return null;
  const credits = v.credits;
  if (!object(credits) || !fields(credits, "used limit remaining", number) || !boolean(credits.can_use)) return null;
  const sorties = v.sorties;
  if (sorties !== undefined && (!object(sorties) || !fields(sorties, "used limit remaining", number) || !boolean(sorties.can_fly))) return null;
  if (v.activity !== undefined && !activity(v.activity)) return null;
  if (v.subscription !== undefined && (!object(v.subscription) ||
    !optional(v.subscription, "status current_period_end", nullableString) ||
    !optional(v.subscription, "cancel_at_period_end", boolean))) return null;
  for (const key of ["first_week_pulse", "manual_grant"]) {
    const grant = v[key];
    if (grant != null && (!object(grant) || !fields(grant, "plan_key notice", string) ||
      (key === "first_week_pulse" && !string(grant.ends_at)) ||
      !optional(grant, "created_at created_by", nullableString))) return null;
  }
  if (v.plans !== undefined && (!object(v.plans) || !Object.values(v.plans).every((p) =>
    object(p) && fields(p, "price_label name blurb image", string) && boolean(p.available) &&
    number(p.credits) && optional(p, "daily_events daily_sorties daily_suggests sorties", number)))) return null;
  return v as BillingMe;
}
