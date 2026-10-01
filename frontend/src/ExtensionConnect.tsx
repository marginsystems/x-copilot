import { useExtensionBridge } from "./lib/useExtensionBridge";

export function ExtensionConnect() {
  const { hello, state, connect } = useExtensionBridge();
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
        </div>
        <div className="account-row-action">
          {hello ? (
            <button
              type="button"
              className="ghost"
              disabled={state.kind === "connecting"}
              onClick={() => { connect().catch(() => undefined); }}
            >
              {connected ? "Reconnect" : "Connect extension"}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
