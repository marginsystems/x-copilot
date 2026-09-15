import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { clearDeskBootCache } from "../lib/deskBoot";
import type { AuthSessionUser } from "./types";

export const SESSION_RESET_KEY = "x-copilot:session-reset";

/** A token belongs to one client session lifetime, including its initial verification. */
export function createSession() {
  let snapshot = {
    generation: 0,
    user: null as AuthSessionUser | null,
    checked: false,
    required: true,
    active: true,
    notice: "",
  };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const broadcast = () => {
    try {
      localStorage.setItem(SESSION_RESET_KEY, crypto.randomUUID());
    } catch {
      /* Local reset still works when storage is unavailable. */
    }
  };
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    capture: () => snapshot.generation,
    isCurrent: (generation: number) =>
      snapshot.active && generation === snapshot.generation,
    invalidate(notice = "Signed out.", notifyTabs = true) {
      clearDeskBootCache();
      publish({
        ...snapshot,
        generation: snapshot.generation + 1,
        user: null,
        checked: true,
        required: true,
        active: false,
        notice,
      });
      if (notifyTabs) broadcast();
      return snapshot.generation;
    },
    verify(user: AuthSessionUser | null, required: boolean, generation: number) {
      if (!session.isCurrent(generation)) return null;
      if (!user && required) {
        session.invalidate(snapshot.user ? "Your session has ended." : snapshot.notice);
        return null;
      }
      const changedOwner = snapshot.user !== null && snapshot.user.id !== user?.id;
      if (changedOwner) clearDeskBootCache();
      publish({
        ...snapshot,
        user,
        required,
        checked: true,
        generation: snapshot.generation + Number(changedOwner),
      });
      if (changedOwner) broadcast();
      return user;
    },
    updateUser(user: AuthSessionUser | null, generation: number) {
      if (!session.isCurrent(generation)) return;
      session.verify(user, snapshot.required, generation);
    },
    setNotice(notice: string, generation: number) {
      if (generation === snapshot.generation) publish({ ...snapshot, notice });
    },
  };
  return session;
}

export type Session = ReturnType<typeof createSession>;
const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionBoundary is required");
  return session;
}

/** Reset all App-owned slices together; old component setters cannot reach the new tree. */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_RESET_KEY || event.key === null) {
        session.invalidate(
          "Your session changed in another tab. Sign in again to continue.",
          false,
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [session]);
  return (
    <SessionContext.Provider key={snapshot.generation} value={session}>
      {children}
    </SessionContext.Provider>
  );
}
