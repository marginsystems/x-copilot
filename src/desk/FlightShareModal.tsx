import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  downloadFlightSharePng,
  flightShareCaption,
  flightShareIntentUrl,
  renderFlightShareBlob,
  type FlightSharePayload,
} from "../lib/flightShare";

export function FlightShareModal({
  payload,
  onClose,
}: {
  payload: FlightSharePayload;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let dead = false;
    void renderFlightShareBlob(payload).then(
      (blob) => {
        if (dead) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      },
      () => {
        if (!dead) setSrc(null);
      },
    );
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [payload]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-root" role="presentation">
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close share"
        onClick={onClose}
      />
      <div
        className="modal-sheet flight-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flight-share-title"
      >
        <h2 id="flight-share-title">Share flight path</h2>
        {src ? (
          <img
            className="flight-share-preview"
            src={src}
            alt="Flight path card"
          />
        ) : (
          <p className="status">Drawing the card…</p>
        )}
        <p className="flight-share-caption">{flightShareCaption(payload)}</p>
        <div className="row flight-share-actions">
          <a
            className="primary"
            href={flightShareIntentUrl(payload)}
            target="_blank"
            rel="noreferrer"
          >
            Post on X
          </a>
          <a
            className="ghost flight-share-icon-btn"
            href={flightShareIntentUrl(payload)}
            target="_blank"
            rel="noreferrer"
            aria-label="Share on X"
            title="Share on X"
          >
            <ShareIcon />
          </a>
          <button
            type="button"
            className="ghost flight-share-icon-btn"
            aria-label="Download PNG"
            title="Download PNG"
            onClick={() => void downloadFlightSharePng(payload)}
          >
            <DownloadIcon />
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}
