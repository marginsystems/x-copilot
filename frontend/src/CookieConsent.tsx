import type { ConsentChoice } from "./lib/consent";

export function CookieConsent(props: {
  open: boolean;
  onChoose: (choice: ConsentChoice) => void;
}) {
  if (!props.open) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
      <p>
        Necessary cookies keep you signed in. Analytics (Google Analytics) load
        only if you accept.{" "}
        <a href="/privacy">Privacy Policy</a>
      </p>
      <div className="cookie-banner-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => props.onChoose("rejected")}
        >
          Reject
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => props.onChoose("accepted")}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
