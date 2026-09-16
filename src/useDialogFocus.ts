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

type Isolation = {
  count: number;
  original: { inert: boolean; ariaHidden: string | null };
};

const isolation = new WeakMap<HTMLElement, Isolation>();
let dialogDepth = 0;

function isolateSibling(element: HTMLElement) {
  const existing = isolation.get(element);
  if (existing) {
    existing.count += 1;
    return;
  }
  isolation.set(element, {
    count: 1,
    original: {
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    },
  });
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}

function releaseSibling(element: HTMLElement) {
  const existing = isolation.get(element);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  isolation.delete(element);
  element.inert = existing.original.inert;
  if (existing.original.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", existing.original.ariaHidden);
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
    const isolated: HTMLElement[] = [];

    let branch: HTMLElement = root;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        isolateSibling(sibling);
        isolated.push(sibling);
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
    dialogDepth += 1;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const element of isolated) releaseSibling(element);
      dialogDepth -= 1;
      if (dialogDepth === 0 && opener?.isConnected) opener.focus();
    };
  }, [active, dialogRef, initialFocusRef, rootRef]);
}
