export function LinkXGate(props: {
  kicker?: string;
  title?: string;
  lede?: string;
  onLinkX?: () => void;
}) {
  return (
    <div className="gate onboarding">
      <div className="onboarding-card">
        <p className="onboarding-kicker">
          {props.kicker ?? "X account required"}
        </p>
        <h1 className="gate-title">{props.title ?? "Link X to continue"}</h1>
        <p className="gate-lede">
          {props.lede ??
            "Take off, Voice, and replies need the account you log into. Sign in with X — you cannot type a handle."}
        </p>
        <div className="onboarding-nav">
          <button
            type="button"
            className="primary"
            disabled={!props.onLinkX}
            onClick={props.onLinkX}
          >
            Link X
          </button>
        </div>
      </div>
    </div>
  );
}
