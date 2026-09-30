import { useRef } from "react";
import { createPortal } from "react-dom";
import {
  circleShareIntentUrl,
  downloadCircleSharePng,
  type CircleSharePayload,
  loadCircleImages,
} from "../lib/circleShare";
import { useDialogFocus } from "../useDialogFocus";

type CircleImages = Awaited<ReturnType<typeof loadCircleImages>>;

export function CircleCardModal({
  payload,
  images,
  src,
  onClose,
}: {
  payload: CircleSharePayload;
  images: CircleImages;
  src: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    active: true,
    rootRef,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: onClose,
  });

  return createPortal(
    <div ref={rootRef} className="modal-root" role="presentation">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close circle card"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="modal-sheet circle-card-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="circle-card-title"
      >
        <h2 id="circle-card-title">Your X Circle card</h2>
        <img
          className="circle-card-full"
          src={src}
          alt={`Full size X Circle card with ${payload.members.length} people`}
        />
        <p className="circle-card-note">
          X cannot attach images from a link. Download the card, then add it
          to your post.
        </p>
        <div className="row circle-card-actions">
          <a
            className="primary"
            href={circleShareIntentUrl(payload)}
            target="_blank"
            rel="noreferrer"
          >
            Post on X
          </a>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              downloadCircleSharePng(payload, images).catch(() => undefined);
            }}
          >
            Download PNG
          </button>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
