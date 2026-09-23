import { useRef, type Dispatch, type SetStateAction } from "react";
import { useDialogFocus } from "../useDialogFocus";
import type { ThreadCard } from "./types";

type DismissModalProps = {
  thread: ThreadCard | null;
  reason: string;
  busy: boolean;
  setReason: Dispatch<SetStateAction<string>>;
  onConfirm: () => void;
  onClose: () => void;
};

export function DismissModal({
  thread,
  reason,
  busy,
  setReason,
  onConfirm,
  onClose,
}: DismissModalProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useDialogFocus({
    active: thread !== null,
    rootRef,
    dialogRef,
    initialFocusRef: reasonRef,
    onDismiss: onClose,
    dismissBlocked: busy,
  });

  if (!thread) return null;

  return (
    <div ref={rootRef} className="modal-root" role="presentation">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Cancel not interested"
        disabled={busy}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dismiss-title"
      >
        <h2 id="dismiss-title">Not interested</h2>
        <p className="status">
          Dismiss {thread.author} from Approach. Optional reason is saved to
          local knowledge memory.
        </p>
        <label className="settings-field">
          <span>Reason (optional)</span>
          <textarea
            ref={reasonRef}
            className="mark-reply-text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why skip this lead…"
            rows={3}
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onConfirm}
          >
            Confirm
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
