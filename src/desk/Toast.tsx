import type { AppToast } from "./useMarkDetect";

export function Toast({ toast }: { toast: AppToast | null }) {
  if (!toast) return null;

  return (
    <div
      className={toast.kind === "warn" ? "app-toast is-warn" : "app-toast"}
      role="status"
    >
      {toast.text}
    </div>
  );
}
