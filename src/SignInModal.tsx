import { AuthButtons } from "./AuthButtons";

export function SignInModal(props: {
  open: boolean;
  notice?: string;
  onClose: () => void;
  onGoogle: () => void;
  onX: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className="signin-root" role="presentation">
      <button
        type="button"
        className="signin-backdrop"
        aria-label="Close sign in"
        onClick={props.onClose}
      />
      <div
        className="signin-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
      >
        <button
          type="button"
          className="signin-close"
          aria-label="Close"
          onClick={props.onClose}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="square"
            />
          </svg>
        </button>
        <div className="signin-brand">
          <img src="/favicon.svg" width={36} height={36} alt="" />
          <p className="signin-wordmark">x-copilot</p>
        </div>
        <h2 id="signin-title">Sign in to your desk</h2>
        <p className="signin-lede">
          Free plan — 1,500 credits every month. No credit card. X is
          identity-only until you post from the desk.
        </p>
        {props.notice ? (
          <p className="status auth-notice" role="status">
            {props.notice}
          </p>
        ) : null}
        <AuthButtons stacked onGoogle={props.onGoogle} onX={props.onX} />
        <p className="signin-fine">
          By signing in you agree to the Terms and acknowledge the Privacy
          Policy.
        </p>
      </div>
    </div>
  );
}
