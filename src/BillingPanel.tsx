export type PaidPlanKey = "pulse" | "radar" | "horizon";
export type CatalogPlanKey = "free" | PaidPlanKey;

type PlanCard = {
  available: boolean;
  price_label: string;
  credits: number;
  daily_events?: number;
  daily_sorties?: number;
  daily_suggests?: number;
  name: string;
  blurb: string;
  image: string;
  sorties?: number;
};

const FREE_CARD: PlanCard = {
  available: true,
  price_label: "Free",
  credits: 1500,
  daily_events: 15,
  daily_sorties: 1,
  daily_suggests: 10,
  name: "Free",
  blurb: "One Scout takeoff a day and a small watch. No credit card.",
  image: "/favicon.svg",
  sorties: 1,
};

function isPaidPlanKey(key: string): key is PaidPlanKey {
  return key === "pulse" || key === "radar" || key === "horizon";
}

export type BillingMe = {
  ok?: boolean;
  plan_key?: string;
  plan_state?: string;
  subscription_status?: string | null;
  has_stripe_subscription?: boolean;
  operator_allotment?: boolean;
  stripe_configured?: boolean;
  credits?: {
    used: number;
    limit: number;
    remaining: number;
    can_use: boolean;
  };
  sorties?: {
    used: number;
    limit: number;
    remaining: number;
    can_fly: boolean;
  };
  activity?: {
    used: number;
    limit: number;
    remaining: number;
    can_watch: boolean;
    planKey: string;
  };
  subscription?: {
    status?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  };
  plans?: Partial<Record<CatalogPlanKey, PlanCard>>;
  first_week_pulse?: {
    plan_key: string;
    ends_at: string;
    notice: string;
  } | null;
  manual_grant?: {
    plan_key: string;
    created_at?: string | null;
    created_by?: string | null;
    notice: string;
  } | null;
  error?: string;
  message?: string;
};

const PLAN_ORDER: CatalogPlanKey[] = ["free", "pulse", "radar", "horizon"];

function planName(key: string): string {
  if (key === "pulse") return "Pulse";
  if (key === "radar") return "Radar";
  if (key === "horizon") return "Horizon";
  if (key === "free") return "Free";
  return key;
}

export function BillingPanel(props: {
  billing: BillingMe | null;
  busy: boolean;
  notice: string;
  checkoutPlan: PaidPlanKey | null;
  portalBusy: boolean;
  onSubscribe: (plan: PaidPlanKey) => void;
  onManage: () => void;
}) {
  const billing = props.billing;
  const credits = billing?.credits;
  const activity = billing?.activity;
  const live = Boolean(billing?.has_stripe_subscription);
  const paymentFailed =
    live &&
    (billing?.subscription_status === "past_due" ||
      billing?.subscription_status === "unpaid");
  // `incomplete`/`paused` are live subscriptions that still need the portal to
  // retry payment or change plans — show the manage path instead of Subscribe,
  // which the server rejects with 409 subscription_exists.
  const usePortal =
    live &&
    (billing?.plan_state === "subscription_active" ||
      paymentFailed ||
      billing?.subscription_status === "incomplete" ||
      billing?.subscription_status === "paused");
  const pct =
    credits && credits.limit > 0
      ? Math.min(100, Math.round((credits.used / credits.limit) * 100))
      : 0;

  return (
    <div className="billing-block">
      <div className="credit-meter">
        <div className="credit-meter-head">
          <span className="usage-stat-label">Credits this UTC month</span>
          <strong className="usage-stat-value">
            {credits
              ? `${credits.used.toLocaleString()} / ${credits.limit.toLocaleString()}`
              : props.busy
                ? "…"
                : "—"}
          </strong>
        </div>
        <div className="credit-meter-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="settings-help">
          {billing?.manual_grant
            ? `${billing.manual_grant.notice} One credit = one X post read.`
            : billing?.first_week_pulse
            ? `${billing.first_week_pulse.notice} One credit = one X post read.`
            : billing?.operator_allotment
            ? "Operator allotment (Horizon pool) until you subscribe. One credit = one X post read."
            : billing?.plan_state === "free_limit_reached"
              ? "Free · monthly credit limit reached. Upgrade below, or wait until the next UTC month."
              : !billing
                ? props.busy
                  ? "…"
                  : "—"
                : !live
                  ? `Free · ${(credits?.limit ?? FREE_CARD.credits).toLocaleString()} credits/month. No credit card. Subscribe below when you need more.`
                  : `Plan: ${planName(billing?.plan_key ?? "free")}. One credit = one X post read (Scout, post watch, and 1h/24h snapshots). Hard ceiling, no rollover.`}
          {billing?.subscription?.current_period_end
            ? ` Period ends ${new Date(billing.subscription.current_period_end).toLocaleDateString()}.`
            : ""}
        </p>
      </div>

      {activity ? (
        <div className="credit-meter">
          <div className="credit-meter-head">
            <span className="usage-stat-label">Posts watched today (UTC)</span>
            <strong className="usage-stat-value">
              {`${activity.used.toLocaleString()} / ${activity.limit.toLocaleString()}`}
            </strong>
          </div>
          <div className="credit-meter-bar" aria-hidden="true">
            <span
              style={{
                width: `${
                  activity.limit > 0
                    ? Math.min(100, Math.round((activity.used / activity.limit) * 100))
                    : 0
                }%`,
              }}
            />
          </div>
          <p className="settings-help">
            Every public tweet you send is a billed post.create. The daily cap
            pauses the watch until 00:00 UTC. Higher plans raise this cap.
          </p>
        </div>
      ) : null}

      {billing?.manual_grant ? (
        <p className="usage-banner" role="status">
          {billing.manual_grant.notice}
        </p>
      ) : null}

      {billing?.first_week_pulse && !billing?.manual_grant ? (
        <p className="usage-banner" role="status">
          {billing.first_week_pulse.notice}
        </p>
      ) : null}

      {billing?.plan_state === "free_limit_reached" &&
      !billing?.operator_allotment &&
      !billing?.manual_grant ? (
        <p className="usage-banner">
          You've used this month's free credits. Pulse raises this — upgrade
          below, or wait until the next UTC month.
        </p>
      ) : null}

      {paymentFailed ? (
        <p className="usage-banner">
          Payment failed. Update your card in Manage billing to keep the paid pool.
        </p>
      ) : null}

      {props.notice ? <p className="status">{props.notice}</p> : null}

      {live ? (
        <div className="billing-account">
          <button
            type="button"
            className="ghost"
            disabled={props.portalBusy}
            onClick={props.onManage}
          >
            {props.portalBusy ? "Opening…" : "Manage billing"}
          </button>
        </div>
      ) : null}

      <h3 className="usage-log-title">Plans</h3>
      <p className="settings-help">
        Start free — no credit card. Paid pools are billed by Mergestorm, Inc.
        Change paid plans in the Stripe portal once you subscribe.
      </p>
      {!billing?.stripe_configured ? (
        <p className="status">
          Checkout is not live yet — Stripe keys are not on this sidecar.
        </p>
      ) : null}

      <div className="plan-grid">
        {PLAN_ORDER.map((key) => {
          const plan =
            billing?.plans?.[key] ?? (key === "free" ? FREE_CARD : undefined);
          const onFree =
            !live &&
            (billing?.plan_key === "free" || Boolean(billing?.first_week_pulse));
          const isCurrent =
            key === "free"
              ? onFree
              : billing?.plan_key === key &&
                billing?.plan_state === "subscription_active";
          const takeoffs = plan?.daily_sorties ?? plan?.sorties;
          const suggests = plan?.daily_suggests;
          return (
            <article
              key={key}
              className={
                isCurrent
                  ? "plan-card is-current"
                  : key === "free"
                    ? "plan-card is-free"
                    : "plan-card"
              }
            >
              <img
                className="plan-card-art"
                src={
                  plan?.image ??
                  (key === "free" ? "/favicon.svg" : `/images/plan-${key}.png`)
                }
                alt=""
                width={120}
                height={120}
              />
              <h4>{plan?.name ?? planName(key)}</h4>
              <p className="plan-card-price">{plan?.price_label ?? ""}</p>
              <p className="plan-card-credits">
                {(plan?.credits ?? 0).toLocaleString()} credits / month
                {plan?.daily_events
                  ? ` · ${plan.daily_events} posts watched / day`
                  : ""}
                {takeoffs
                  ? ` · ${takeoffs} takeoff${takeoffs === 1 ? "" : "s"} / day`
                  : ""}
                {suggests
                  ? ` · ${suggests} suggests / day`
                  : ""}
              </p>
              <p className="plan-card-blurb">{plan?.blurb ?? ""}</p>
              {isCurrent ? (
                <p className="plan-card-current">Current plan</p>
              ) : key === "free" ? (
                <p className="plan-card-current">No credit card</p>
              ) : usePortal ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={props.portalBusy}
                  onClick={props.onManage}
                >
                  {paymentFailed ? "Update payment" : "Change plan"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={
                    props.busy ||
                    !plan?.available ||
                    props.checkoutPlan !== null
                  }
                  onClick={() => {
                    if (isPaidPlanKey(key)) props.onSubscribe(key);
                  }}
                >
                  {props.checkoutPlan === key ? "Redirecting…" : "Subscribe"}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
