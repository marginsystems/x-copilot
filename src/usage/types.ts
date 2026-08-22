export type UsageWindow = "24h" | "7d" | "all";

export type UsageRecentRow = {
  id: string;
  at: string;
  activity: string;
  status: number;
  error: string | null;
  credits: number;
  remaining: number | null;
};

export type UsageSummaryResponse = {
  ok: boolean;
  tenantSlug?: string;
  window?: UsageWindow;
  calls?: number;
  creditsUsed?: number;
  creditLimit?: number;
  remaining?: number;
  creditsDepletedRecent?: boolean;
  note?: string;
  recent?: UsageRecentRow[];
  error?: string;
  message?: string;
};
