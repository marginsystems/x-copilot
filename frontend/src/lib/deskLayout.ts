/** Persist whether the agenda / flight-path bar is open. Default: collapsed. */

export const DESK_TOP_OPEN_KEY = "x-copilot-desk-top-open";

export function readDeskTopOpen(
  store: Pick<Storage, "getItem"> | null = defaultStore(),
): boolean {
  if (!store) return false;
  try {
    const stored = store.getItem(DESK_TOP_OPEN_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    /* private mode */
  }
  return false;
}

export function writeDeskTopOpen(
  next: boolean,
  store: Pick<Storage, "setItem"> | null = defaultStore(),
): boolean {
  if (!store) return next;
  try {
    store.setItem(DESK_TOP_OPEN_KEY, next ? "1" : "0");
  } catch {
    /* private mode */
  }
  return next;
}

function defaultStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
