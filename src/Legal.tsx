import type { ReactNode } from "react";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  PRODUCT_NAME,
  SITE_ORIGIN,
  type LegalKind,
} from "./lib/legal";

function LegalLink(props: {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={props.href}
      onClick={(e) => {
        if (!props.onNavigate) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          return;
        }
        e.preventDefault();
        props.onNavigate();
      }}
    >
      {props.children}
    </a>
  );
}

function PrivacyBody() {
  return (
    <>
      <p>
        This Privacy Policy describes how {LEGAL_ENTITY} (“we,” “us,” or “our”)
        collects, uses, and shares information when you use {PRODUCT_NAME} at{" "}
        {SITE_ORIGIN}. It is provided for transparency and is not legal advice.
      </p>

      <h2>Who we are</h2>
      <p>
        {PRODUCT_NAME} is a research and triage desk for posting on X.{" "}
        {LEGAL_ENTITY} operates the service. We are not affiliated with X Corp.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account.</strong> Email, display name, and avatar from Google
          sign-in; X username if you link X. We use these to keep you signed in
          and to apply your plan.
        </li>
        <li>
          <strong>Desk content.</strong> Agendas you write, Scout settings, marks
          (interacted / skipped / not interested), optional reply URLs and reply
          text you save, and onboarding choices.
        </li>
        <li>
          <strong>X data we read for you.</strong> Public posts, author handles,
          and public metrics returned by the X API so Scout can search and score
          threads. If you post a reply from the desk, we send that text to X
          with the official X tokens from your X login. We do not like, follow,
          or auto-reply. Suggest drafts are shown for you to rewrite — we do
          not publish an AI draft unless you send it.
        </li>
        <li>
          <strong>Billing.</strong> If you subscribe, Stripe processes the card.
          We store Stripe customer and subscription IDs, plan, and credit/sortie
          usage — not full card numbers.
        </li>
        <li>
          <strong>Technical logs.</strong> IP address, user agent, and error
          traces needed to run the API, rate-limit login, and debug failures.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use this information to operate Scout and the desk, enforce plan
        limits, bill paid plans, prevent abuse, and improve the product. Agenda
        text and candidate posts are sent to our language-model provider
        (DeepSeek) so Scout can score threads. That provider processes the text
        to return results and must not use it to train their public models under
        our API terms, but it still leaves our servers.
      </p>

      <h2>Cookies</h2>
      <p>
        Strictly necessary cookies keep you signed in (
        <code>xc_session</code>, <code>xc_oauth_state</code>, and{" "}
        <code>xc_x_oauth</code> for X sign-in). We also store preferences in
        your browser: <code>xc-theme</code>, <code>xc-cookie-consent</code>,
        onboarding flags (<code>xc-onboarding-complete</code>,{" "}
        <code>xc-onboarding-agenda</code>, scoped per account), and Scout
        filters (<code>x-copilot-settings</code> and a one-time excluded-tags
        migration key). The service cannot function without the session
        cookies.
        If you accept analytics cookies, we load Google Analytics (GA4) to
        understand how the site is used. That script is not loaded until you
        accept, and we do not use it for ads. Google Fonts are loaded to render
        the UI.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data with vendors who help us run the product: Google (sign-in),
        X (identity and search), Stripe (payments), DeepSeek (triage), and
        Cloudflare (hosting the site). We do not sell personal information. We
        may disclose information if required by law or to protect the service.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep account, desk, and billing records while your account is active
        and as needed for taxes, disputes, and security. {PRODUCT_NAME} does not
        yet offer in-app account deletion. Email{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> to
        request access, correction, or deletion. We will respond within a
        reasonable time.
      </p>

      <h2>International users</h2>
      <p>
        The service is operated from the United States. If you use it from
        elsewhere, you understand your information is processed in the U.S. and
        in the countries where our vendors run.
      </p>

      <h2>Children</h2>
      <p>
        {PRODUCT_NAME} is not directed at children under 16. Do not use the
        service if you are under 16.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy. The “Last updated” date will change when we
        do. Continued use after a change means you accept the revised policy.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <p>
        These Terms of Service (“Terms”) govern your access to {PRODUCT_NAME} at{" "}
        {SITE_ORIGIN}, operated by {LEGAL_ENTITY}. By using the service, you
        agree to these Terms. This is a general template for an early product
        and is not legal advice.
      </p>

      <h2>Acceptance</h2>
      <p>
        If you do not agree, do not use {PRODUCT_NAME}. We may update these
        Terms; the “Last updated” date will change when we do. Continued use
        after changes means you accept the revised Terms.
      </p>

      <h2>The service</h2>
      <p>
        {PRODUCT_NAME} helps you find public X threads worth a human reply.
        Scout searches X and scores candidates. Suggest may show a
        Voice-matched draft that you must rewrite before Copy / Open on X.
        You may post that reply from the desk with your official X login. We
        do not auto-engage, auto-like, auto-follow, or post without your
        click. You are responsible for complying with X’s terms and
        applicable law in anything you post.
      </p>

      <h2>Accounts</h2>
      <p>
        You must sign in with Google or X. You are responsible for
        activity under your account. We may suspend or terminate access for
        conduct we reasonably believe violates these Terms, X’s rules, or puts
        the service at risk.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not misuse the service, attempt unauthorized access, scrape beyond
        your own desk, interfere with other users, or use {PRODUCT_NAME} for
        spam, mass automation, or anything unlawful. Personal research tooling
        only — not a bot farm.
      </p>

      <h2>Plans and billing</h2>
      <p>
        The Free plan needs no credit card and is not billed through Stripe.
        Paid plans (Pulse, Radar, Horizon) are a monthly pool of X post-read
        credits plus a daily Scout takeoff cap, billed by {LEGAL_ENTITY}{" "}
        through Stripe. Unused credits do not roll over. Limits reset on the
        UTC month (credits) or UTC day (takeoffs). Failure to pay may drop you
        back to the free pool. Prices and limits may change; we will not change
        the price of an active subscription term without showing the new price
        at renewal in Stripe.
      </p>

      <h2>AI output</h2>
      <p>
        Scout scores and reasons are generated by a language model. They can be
        wrong, incomplete, or biased. You decide what to read and what to post.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The service is provided “as is” and “as available.” To the fullest
        extent permitted by law, we disclaim warranties of merchantability,
        fitness for a particular purpose, and non-infringement. We do not
        guarantee uninterrupted or error-free operation, or that Scout will
        find any particular thread.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, {LEGAL_ENTITY} and its
        operators will not be liable for any indirect, incidental, special,
        consequential, or exemplary damages, or for loss of profits, data, or
        goodwill, arising from your use of the service. Our aggregate liability
        for claims relating to the service will not exceed the greater of one
        hundred U.S. dollars (USD $100) or the amount you paid us for the
        service in the twelve months preceding the claim, if any.
      </p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, United
        States, excluding conflict-of-law rules, unless a different
        jurisdiction applies by mandatory law.
      </p>

      <h2>Contact</h2>
      <p>
        Questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}

export function LegalPage(props: {
  kind: LegalKind;
  onHome: () => void;
  onOther: () => void;
}) {
  const title = props.kind === "privacy" ? "Privacy Policy" : "Terms of Service";
  const otherHref = props.kind === "privacy" ? "/terms" : "/privacy";
  const otherLabel =
    props.kind === "privacy" ? "Terms of Service" : "Privacy Policy";

  return (
    <article className="legal-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
      </p>
      <h1>{title}</h1>
      <p className="legal-meta">
        Last updated: {LEGAL_UPDATED}. Operated by {LEGAL_ENTITY}.
      </p>
      {props.kind === "privacy" ? <PrivacyBody /> : <TermsBody />}
      <nav className="legal-foot" aria-label="Legal">
        <LegalLink href={otherHref} onNavigate={props.onOther}>
          {otherLabel}
        </LegalLink>
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}

export function LegalLinks(props: { className?: string }) {
  return (
    <nav className={props.className ?? "legal-links"} aria-label="Legal">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  );
}
