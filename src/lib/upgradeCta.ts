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
}): string {
  const next = nextPlanLabel(opts.planKey);
  const base = `Grounded — ${opts.limit} sortie${opts.limit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC.`;
  return next ? `${base} ${next} raises this.` : `${base}`;
}
