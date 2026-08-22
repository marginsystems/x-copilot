import type { Dispatch, SetStateAction } from "react";
import { ExcludedAccountsField } from "../ExcludedAccountsField";
import { ExcludedTagsField } from "../ExcludedTagsField";
import type { AuthSessionUser } from "../auth/types";
import {
  clampMaxThreadChars,
  clampTargetCoolThreads,
  DEFAULT_SETTINGS,
  normalizePreferredLanguage,
  PREFERRED_LANGUAGES,
  type AppSettings,
} from "../lib/settings";

type SettingsFormProps = {
  authUser: AuthSessionUser | null;
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
  status: string;
  onBack: () => void;
  onOpenAccount: () => void;
  onLinkX: () => void;
  onSave: () => void;
};

export function SettingsForm({
  authUser,
  draft,
  setDraft,
  status,
  onBack,
  onOpenAccount,
  onLinkX,
  onSave,
}: SettingsFormProps) {
  return (
    <section className="panel settings-pane">
      <div className="settings-head">
        <h2>Settings</h2>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="status settings-lede">
        Filter prefs apply on the next Scout search. X is linked on Account
        through official X login — you cannot type a handle here.
      </p>
      <div className="settings-grid">
        <div className="settings-field settings-field-wide">
          <span>X account</span>
          <p className="settings-help">
            {authUser?.xLinked && authUser.xUsername
              ? `@${authUser.xUsername} — change it on Account via X login.`
              : "Required. Link X with the official login."}
          </p>
          {authUser?.xLinked ? (
            <button type="button" className="ghost" onClick={onOpenAccount}>
              Account
            </button>
          ) : (
            <button type="button" className="ghost" onClick={onLinkX}>
              Link X
            </button>
          )}
        </div>
        <label className="settings-field">
          <span>Max post characters</span>
          <input
            type="number"
            min={120}
            max={2000}
            step={1}
            value={draft.maxThreadChars}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                maxThreadChars: clampMaxThreadChars(
                  e.target.value === ""
                    ? DEFAULT_SETTINGS.maxThreadChars
                    : Number(e.target.value),
                ),
              }))
            }
          />
          <span className="settings-help">
            Skip the candidate and replies under a parent over this length.
          </span>
        </label>
        <label className="settings-field">
          <span>Cool threads target (1–20)</span>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={draft.targetCoolThreads}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                targetCoolThreads: clampTargetCoolThreads(
                  e.target.value === ""
                    ? DEFAULT_SETTINGS.targetCoolThreads
                    : Number(e.target.value),
                ),
              }))
            }
          />
        </label>
        <label className="settings-field">
          <span>Preferred language</span>
          <select
            className="settings-select"
            value={draft.preferredLanguage}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                preferredLanguage: normalizePreferredLanguage(e.target.value),
              }))
            }
          >
            {(
              [
                ["en", "English"],
                ["es", "Spanish"],
                ["fr", "French"],
                ["de", "German"],
                ["pt", "Portuguese"],
              ] as const satisfies ReadonlyArray<
                readonly [(typeof PREFERRED_LANGUAGES)[number], string]
              >
            ).map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
        </label>
        <div className="settings-checks">
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.dropArticles}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dropArticles: e.target.checked,
                }))
              }
            />
            <span>Drop X Articles and replies to them</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.dropEmDashes}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dropEmDashes: e.target.checked,
                }))
              }
            />
            <span>Drop posts with em dashes (—)</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.dropAutomatedAccounts}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dropAutomatedAccounts: e.target.checked,
                }))
              }
            />
            <span>Drop automated accounts</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.dedupeAccounts}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dedupeAccounts: e.target.checked,
                }))
              }
            />
            <span>Dedupe accounts I&apos;ve interacted with</span>
          </label>
        </div>
        <ExcludedTagsField
          tags={draft.excludedTags}
          onChange={(excludedTags) =>
            setDraft((prev) => ({ ...prev, excludedTags }))
          }
        />
        <ExcludedAccountsField
          accounts={draft.excludedAccounts}
          onChange={(excludedAccounts) =>
            setDraft((prev) => ({ ...prev, excludedAccounts }))
          }
        />
      </div>
      <div className="settings-footer">
        <p className="settings-readonly">Author cooldown: 24 hours</p>
        <div className="settings-actions">
          <button type="button" className="primary" onClick={onSave}>
            Save
          </button>
          {status ? (
            <p className="status settings-save-status">{status}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
