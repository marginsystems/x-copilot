/**
 * Public session DTO — UUIDs only, never cookie or token_hash.
 */
export type SessionListRow = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  createdIp: string | null;
  lastSeenIp: string | null;
  createdUserAgent: string | null;
  lastSeenUserAgent: string | null;
};

export type PublicSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  browser: string;
  os: string;
  current: boolean;
};

export function parseUserAgent(ua: string | null | undefined): {
  browser: string;
  os: string;
} {
  const raw = (ua ?? "").trim();
  if (!raw) return { browser: "Unknown", os: "Unknown" };

  let browser = "Unknown";
  if (/Edg\//i.test(raw)) browser = "Edge";
  else if (/OPR\/|Opera\//i.test(raw)) browser = "Opera";
  else if (/Chrome\//i.test(raw) && !/Chromium/i.test(raw)) browser = "Chrome";
  else if (/Chromium\//i.test(raw)) browser = "Chromium";
  else if (/Firefox\//i.test(raw)) browser = "Firefox";
  else if (/Safari\//i.test(raw) && !/Chrome|Chromium|Android/i.test(raw)) {
    browser = "Safari";
  }

  let os = "Unknown";
  if (/iPhone|iPad|iPod/i.test(raw)) os = "iOS";
  else if (/Android/i.test(raw)) os = "Android";
  else if (/Mac OS X|Macintosh/i.test(raw)) os = "macOS";
  else if (/Windows/i.test(raw)) os = "Windows";
  else if (/Linux/i.test(raw)) os = "Linux";

  return { browser, os };
}

export function toPublicSession(
  row: SessionListRow,
  currentSessionId: string | null,
): PublicSession {
  const ua = row.lastSeenUserAgent ?? row.createdUserAgent;
  const parsed = parseUserAgent(ua);
  return {
    id: row.id,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    ip: row.lastSeenIp ?? row.createdIp,
    browser: parsed.browser,
    os: parsed.os,
    current: Boolean(currentSessionId && row.id === currentSessionId),
  };
}
