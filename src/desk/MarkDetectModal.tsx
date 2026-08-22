import type { ThreadCard } from "./types";

type MarkDetectModalProps = {
  thread: ThreadCard | null;
  note: string;
  onClose: () => void;
};

export function MarkDetectModal({
  thread,
  note,
  onClose,
}: MarkDetectModalProps) {
  if (!thread) return null;

  return (
    <div className="modal-root" role="presentation">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Cancel mark interacted"
        onClick={onClose}
      />
      <div
        className="modal-sheet mark-detect-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-reply-title"
        aria-live="polite"
      >
        <h2 id="mark-reply-title">Looking for your reply</h2>
        <div className="mark-detect-anim" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="status">
          {note || `Checking X for a reply to ${thread.author}…`}
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
