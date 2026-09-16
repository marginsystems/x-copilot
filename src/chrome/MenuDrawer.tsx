import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "../useDialogFocus";

type MenuDrawerProps = {
  entered: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function MenuDrawer({ entered, onClose, children }: MenuDrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus({
    active: entered,
    rootRef,
    dialogRef,
    onDismiss: onClose,
    preserveOpener: true,
  });

  return (
    <div
      ref={rootRef}
      className={entered ? "menu-root is-open" : "menu-root"}
    >
      <button
        type="button"
        className="menu-backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className={entered ? "menu-sheet is-open" : "menu-sheet"}
        role="dialog"
        aria-modal="true"
        aria-label="User menu"
      >
        {children}
      </aside>
    </div>
  );
}
