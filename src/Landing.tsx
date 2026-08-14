import { AuthButtons } from "./AuthButtons";
import { LegalLinks } from "./Legal";

export function BootScreen() {
  return (
    <div className="gate" role="status" aria-live="polite">
      <div className="gate-card">
        <img className="gate-mark is-busy" src="/favicon.svg" width={48} height={48} alt="" />
        <p className="gate-kicker">x-copilot</p>
        <p className="gate-status">Checking your session…</p>
      </div>
    </div>
  );
}

export function Landing(props: {
  notice?: string;
  onGoogle: () => void;
  onX: () => void;
}) {
  return (
    <div className="gate">
      <div className="gate-card">
        <img className="gate-mark" src="/favicon.svg" width={48} height={48} alt="" />
        <h1 className="gate-title">x-copilot</h1>
        <p className="gate-lede">Find the threads worth a human reply.</p>
        <p className="gate-sub">
          Scout searches X and scores what’s cool. You review the cards and post
          yourself — no auto-engage, no AI drafts.
        </p>
        <AuthButtons stacked onGoogle={props.onGoogle} onX={props.onX} />
        {props.notice ? (
          <p className="status auth-notice" role="status">
            {props.notice}
          </p>
        ) : null}
        <p className="brand-legal">
          Built by Mergestorm, Inc. Not affiliated with X Corp. By signing in
          you agree to the Terms and acknowledge the Privacy Policy.
        </p>
        <LegalLinks />
      </div>
    </div>
  );
}
