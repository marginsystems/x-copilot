import type { ReactNode } from "react";

type MenuDrawerProps = {
  entered: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function MenuDrawer({ entered, onClose, children }: MenuDrawerProps) {
  return (
    <div className={entered ? "menu-root is-open" : "menu-root"}>
      <button
        type="button"
        className="menu-backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside
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
