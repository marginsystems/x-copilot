import { LegalLink, LegalLinks } from "./Legal";
import { PRODUCT_NAME } from "./lib/legal";
import { PUBLIC_PLANS } from "./lib/publicPlans";

export function PricingPage(props: {
  signedIn: boolean;
  onHome: () => void;
  onSignIn: () => void;
  onOpenDesk: () => void;
  onUsage: () => void;
}) {
  return (
    <article className="legal-page pricing-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
      </p>
      <h1>Plans</h1>
      <p className="legal-meta">
        Usage-metered. Nothing is feature-gated. Free needs no card. You
        review and post on X yourself.
      </p>
      <div className="plan-grid">
        {PUBLIC_PLANS.map((plan) => (
          <article
            key={plan.key}
            className={
              plan.key === "free" ? "plan-card is-free" : "plan-card"
            }
          >
            <img
              className="plan-card-art"
              src={plan.image}
              alt=""
              width={120}
              height={120}
            />
            <h3>{plan.name}</h3>
            <p className="plan-card-price">{plan.priceLabel}</p>
            <p className="plan-card-credits">
              {plan.credits.toLocaleString()} credits / month · {plan.sorties}{" "}
              takeoff{plan.sorties === 1 ? "" : "s"} / day · {plan.watch}{" "}
              watched / day · {plan.suggests} suggests / day
            </p>
            <p className="plan-card-blurb">{plan.blurb}</p>
          </article>
        ))}
      </div>
      <p>
        {props.signedIn ? (
          <>
            Manage a paid plan on{" "}
            <LegalLink href="/usage" onNavigate={props.onUsage}>
              Usage & Billing
            </LegalLink>
            , or{" "}
            <LegalLink href="/dashboard" onNavigate={props.onOpenDesk}>
              open the desk
            </LegalLink>
            .
          </>
        ) : (
          <>
            <button type="button" className="primary" onClick={props.onSignIn}>
              Sign in to start Free
            </button>
          </>
        )}
      </p>
      <nav className="legal-foot" aria-label="Pricing footer">
        <LegalLinks />
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}
