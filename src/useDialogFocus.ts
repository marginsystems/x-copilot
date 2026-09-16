import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogFocusOptions = {
  active: boolean;
  rootRef: RefObject<HTMLElement>;
  dialogRef: RefObject<HTMLElement>;
  initialFocusRef?: RefObject<HTMLElement>;
  onDismiss: () => void;
  dismissBlocked?: boolean;
};

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

export function useDialogFocus({
  active,
  rootRef,
  dialogRef,
  initialFocusRef,
  onDismiss,
  dismissBlocked = false,
}: DialogFocusOptions) {
  const onDismissRef = useRef(onDismiss);
  const dismissBlockedRef = useRef(dismissBlocked);
  onDismissRef.current = onDismiss;
  dismissBlockedRef.current = dismissBlocked;

  useEffect(() => {
    if (!active || !rootRef.current || !dialogRef.current) return;

    const root = rootRef.current;
    const dialog = dialogRef.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const isolated: Array<{
      element: HTMLElement;
      inert: boolean;
      ariaHidden: string | null;
    }> = [];

    let branch: HTMLElement = root;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        isolated.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }

    const initial =
      initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
    initial.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!dismissBlockedRef.current) onDismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const { element, inert, ariaHidden } of isolated) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [active, dialogRef, initialFocusRef, rootRef]);
}
