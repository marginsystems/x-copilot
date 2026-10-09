import { useId, useState } from "react";
import { useExtensionBridge } from "./lib/useExtensionBridge";

export function ExtensionConnect() {
  const { hello, state, connect } = useExtensionBridge();
  const [agreed, setAgreed] = useState(false);
  const disclosureId = useId();
  const connected = state.kind === "connected" || (state.kind === "idle" && hello?.paired === true);
  const help = !hello
    ? "Install the X Copilot extension, then reload this page to connect it."
    : state.kind === "connecting"
      ? "Connecting…"
      : state.kind === "failed"
        ? state.message
        : connected
          ? "Connected. The side panel on x.com uses this account."
          : `Extension found (v${hello.version}). Connect it to this account.`;

  return (
    <>
      <h3 className="account-section-title">Browser extension</h3>
      <div className="account-mail">
        <div className="account-mail-copy">
          <strong>X Copilot for x.com</strong>
          <p className={state.kind === "failed" ? "settings-help danger" : "settings-help"} role="status" aria-live="polite">
            {help}
          </p>
          <p className="settings-help" id={disclosureId}>
            When connected, the extension stores a sign-in token in your browser and
            automatically sends published X post URLs and the open post’s ID to your
            XCoPilot account to update your desk. It also sends approach-card content
            and your Next, Skip, and Not interested choices. The reading timer stays
            in your browser. Turning it off does not stop post reporting. Sign out
            in the extension to disconnect. <a href="/privacy">Privacy Policy</a>
          </p>
          {hello ? (
            <label className="extension-consent">
              <input
                type="checkbox"
                checked={agreed}
                disabled={state.kind === "connecting"}
                aria-describedby={disclosureId}
                onChange={(event) => setAgreed(event.currentTarget.checked)}
              />
              <span>I agree to this extension data use.</span>
            </label>
          ) : null}
        </div>
        <div className="account-row-action">
          {hello ? (
            <button
              type="button"
              className="ghost"
              disabled={!agreed || state.kind === "connecting"}
              onClick={() => { if (agreed) connect().catch(() => undefined); }}
            >
              {connected ? "Reconnect" : "Connect extension"}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
