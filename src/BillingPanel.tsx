export type PaidPlanKey = "pulse" | "radar" | "horizon";

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
  subscription?: {
    status?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  };
  plans?: Record<
    PaidPlanKey,
    {
      available: boolean;
      price_label: string;
      credits: number;
      name: string;
      blurb: string;
      image: string;
    }
  >;
  error?: string;
  message?: string;
};

const PLAN_ORDER: PaidPlanKey[] = ["pulse", "radar", "horizon"];

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
          {billing?.operator_allotment
            ? "Operator allotment (Horizon pool) until you subscribe. One credit = one X post read."
            : `Plan: ${planName(billing?.plan_key ?? "free")}. One credit = one X post read. Hard ceiling, no rollover.`}
          {billing?.subscription?.current_period_end
            ? ` Period ends ${new Date(billing.subscription.current_period_end).toLocaleDateString()}.`
            : ""}
        </p>
      </div>

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
        Hosted credits billed by Mergestorm, Inc. Change plans in the Stripe portal
        once you subscribe.
      </p>
      {!billing?.stripe_configured ? (
        <p className="status">
          Checkout is not live yet — Stripe keys are not on this sidecar.
        </p>
      ) : null}

      <div className="plan-grid">
        {PLAN_ORDER.map((key) => {
          const plan = billing?.plans?.[key];
          const isCurrent =
            live &&
            billing?.plan_state === "subscription_active" &&
            billing.plan_key === key;
          return (
            <article
              key={key}
              className={isCurrent ? "plan-card is-current" : "plan-card"}
            >
              <img
                className="plan-card-art"
                src={plan?.image ?? `/images/plan-${key}.png`}
                alt=""
                width={120}
                height={120}
              />
              <h4>{plan?.name ?? planName(key)}</h4>
              <p className="plan-card-price">{plan?.price_label ?? ""}</p>
              <p className="plan-card-credits">
                {(plan?.credits ?? 0).toLocaleString()} credits / month
              </p>
              <p className="plan-card-blurb">{plan?.blurb ?? ""}</p>
              {isCurrent ? (
                <p className="plan-card-current">Current plan</p>
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
                  onClick={() => props.onSubscribe(key)}
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
