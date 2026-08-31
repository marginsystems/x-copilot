import type { Dispatch, SetStateAction } from "react";
import { ExcludedAccountsField } from "../ExcludedAccountsField";
import { ExcludedTagsField } from "../ExcludedTagsField";
import type { AuthSessionUser } from "../auth/types";
import { AGENDA_MAX_CHARS, AGENDA_MIN_CHARS } from "../lib/agendaPersist";
import {
  clampMaxThreadChars,
  DEFAULT_SETTINGS,
  DROP_OUTBOUND_LINKS_LABEL,
  MAX_AVOID_CHARS,
  normalizeAvoidPrompt,
  normalizePreferredLanguage,
  PREFERRED_LANGUAGES,
  type AppSettings,
} from "../lib/settings";

type SettingsFormProps = {
  authUser: AuthSessionUser | null;
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
  status: string;
  agenda: string;
  onAgendaChange: (value: string) => void;
  onAgendaBlur: () => void;
  onBack: () => void;
  onOpenAccount: () => void;
  onLinkX: () => void;
  onSave: () => void;
};

export function SettingsForm({
  authUser,
  draft,
  setDraft,
  agenda,
  onAgendaChange,
  onAgendaBlur,
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
        Agenda and filter prefs apply on the next Scout search. X is linked
        on Account through official X login — you cannot type a handle here.
      </p>
      <div className="settings-grid">
        <label className="settings-field settings-field-wide">
          <span>Agenda</span>
          <textarea
            className="settings-textarea"
            value={agenda}
            maxLength={AGENDA_MAX_CHARS}
            rows={5}
            placeholder="What should we look for and how should we sound?"
            onChange={(e) => onAgendaChange(e.target.value)}
            onBlur={onAgendaBlur}
          />
          <span className="settings-help">
            Scout uses this when Approach is empty. Saves at {AGENDA_MIN_CHARS}
            –{AGENDA_MAX_CHARS} characters. {agenda.trim().length}/
            {AGENDA_MAX_CHARS}.
          </span>
        </label>
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
              checked={draft.dropOutboundLinks}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dropOutboundLinks: e.target.checked,
                }))
              }
            />
            <span>{DROP_OUTBOUND_LINKS_LABEL}</span>
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
              checked={draft.dropProfanity}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  dropProfanity: e.target.checked,
                }))
              }
            />
            <span>Drop posts with profanity</span>
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
        <label className="settings-field settings-field-wide">
          <span>Avoid</span>
          <textarea
            className="settings-textarea"
            value={draft.avoidPrompt}
            maxLength={MAX_AVOID_CHARS}
            rows={3}
            placeholder="Skip threads about fundraising. Skip dunking on beginners."
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                avoidPrompt: e.target.value.slice(0, MAX_AVOID_CHARS),
              }))
            }
            onBlur={() =>
              setDraft((prev) => ({
                ...prev,
                avoidPrompt: normalizeAvoidPrompt(prev.avoidPrompt),
              }))
            }
          />
          <span className="settings-help">
            Standing never-show rules for triage — not the agenda.{" "}
            {draft.avoidPrompt.length}/{MAX_AVOID_CHARS}. Empty disables.
          </span>
        </label>
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
