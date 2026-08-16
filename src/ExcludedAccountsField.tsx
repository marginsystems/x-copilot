import { useRef, useState } from "react";
import {
  DEFAULT_EXCLUDED_ACCOUNTS,
  MAX_EXCLUDED_ACCOUNTS,
  normalizeExcludedAccounts,
} from "./lib/settings";

type Props = {
  accounts: readonly string[];
  onChange: (accounts: string[]) => void;
};

function mergeAccounts(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  return normalizeExcludedAccounts([...current, ...additions]);
}

export function ExcludedAccountsField({ accounts, onChange }: Props) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = new Set(accounts);

  function commitRaw(raw: string) {
    const tokens = raw
      .split(/[\n,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const normalized = normalizeExcludedAccounts(tokens);
    if (!normalized.length) {
      setNotice("No valid handles — use 1–15 letters, digits, or underscore.");
      return;
    }
    const merged = mergeAccounts(accounts, normalized);
    const requestedNew = normalized.filter((h) => !selected.has(h));
    onChange(merged);
    setInput("");
    setNotice(
      requestedNew.some((h) => !merged.includes(h))
        ? `Only ${MAX_EXCLUDED_ACCOUNTS} accounts allowed; extras were dropped.`
        : "",
    );
  }

  function removeAccount(handle: string) {
    onChange(accounts.filter((h) => h !== handle));
    setNotice("");
  }

  function restoreDefaults() {
    onChange([...DEFAULT_EXCLUDED_ACCOUNTS]);
    setNotice("");
  }

  return (
    <div className="settings-field settings-span-2 excluded-tags-field">
      <span>Excluded accounts</span>
      <div className="excluded-tags-box">
        <div className="excluded-tags-chips" aria-label="Excluded accounts">
          {accounts.length ? (
            accounts.map((handle) => (
              <button
                key={handle}
                type="button"
                className="excluded-tag-chip"
                onClick={() => removeAccount(handle)}
                title={`Remove @${handle}`}
              >
                <span>@{handle}</span>
                <span aria-hidden="true" className="excluded-tag-x">
                  ×
                </span>
              </button>
            ))
          ) : (
            <span className="excluded-tags-empty">
              None — account excludes disabled
            </span>
          )}
        </div>
        <div className="excluded-tags-input-row">
          <input
            ref={inputRef}
            className="excluded-tags-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (notice) setNotice("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitRaw(input);
              } else if (e.key === "Backspace" && !input && accounts.length) {
                removeAccount(accounts[accounts.length - 1]!);
              }
            }}
            onBlur={() => {
              if (input.trim()) commitRaw(input);
            }}
            placeholder="@handle, comma or Enter to add"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="button"
            className="ghost"
            onClick={restoreDefaults}
          >
            Reset defaults
          </button>
        </div>
        {notice ? (
          <span className="excluded-tags-notice" role="alert">
            {notice}
          </span>
        ) : null}
      </div>
      <span className="settings-help">
        Never curate these authors. Defaults are well-known AI chatbots — X no
        longer always marks them Automated, and official search does not send
        that badge. Empty list disables handle excludes. Max{" "}
        {MAX_EXCLUDED_ACCOUNTS} handles.
      </span>
    </div>
  );
}
