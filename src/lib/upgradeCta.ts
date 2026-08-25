/** Next paid desk for cap copy. Horizon has nowhere to go. */
export function nextPlanLabel(planKey?: string | null): string | null {
  if (planKey === "horizon") return null;
  if (planKey === "radar") return "Horizon";
  if (planKey === "pulse") return "Radar";
  return "Pulse";
}

export function groundedHint(opts: {
  limit: number;
  planKey?: string | null;
  firstWeek?: boolean;
}): string {
  const base = `Grounded — ${opts.limit} takeoff${opts.limit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC.`;
  if (opts.firstWeek) {
    return `${base} Subscribe to Pulse to keep these limits after your first week.`;
  }
  const next = nextPlanLabel(opts.planKey);
  return next ? `${base} ${next} raises this.` : `${base}`;
}
