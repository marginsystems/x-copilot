import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  clearDeskBootCache,
  readProvisionalDeskBoot,
  type DeskBootPayload,
} from "../lib/deskBoot";
import { setMutationGate } from "../lib/apiBase";
import { readOwnerHint } from "../lib/ownerHint";
import type { AuthSessionUser } from "./types";

export const SESSION_RESET_KEY = "x-copilot:session-reset";

export type SessionPhase = "unchecked" | "provisional" | "verified" | "rejected";

type SessionSnapshot = {
  generation: number;
  user: AuthSessionUser | null;
  provisional: AuthSessionUser | null;
  phase: SessionPhase;
  checked: boolean;
  required: boolean;
  active: boolean;
  notice: string;
  offline: boolean;
  ownerHint: string | null;
};

type CreateSessionOptions = { provisional?: DeskBootPayload | null };

/** A token belongs to one client session lifetime, including its initial verification. */
export function createSession({ provisional = null }: CreateSessionOptions = {}) {
  const provisionalUser = provisional?.user ?? null;
  let snapshot: SessionSnapshot = {
    generation: 0,
    user: null,
    provisional: provisionalUser,
    phase: provisionalUser ? "provisional" : "unchecked",
    checked: false,
    required: true,
    active: true,
    notice: "",
    offline: false,
    ownerHint: provisionalUser ? provisional?.ownerHint ?? null : null,
  };
  const listeners = new Set<() => void>();
  const publish = (next: SessionSnapshot) => {
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
    writesAllowed: () => snapshot.phase !== "provisional",
    invalidate(
      notice = "Signed out.",
      notifyTabs = true,
      { clearCache = true }: { clearCache?: boolean } = {},
    ) {
      if (clearCache) clearDeskBootCache();
      publish({
        ...snapshot,
        generation: snapshot.generation + 1,
        user: null,
        provisional: null,
        phase: "rejected",
        checked: true,
        required: true,
        active: false,
        notice,
        offline: false,
        ownerHint: null,
      });
      if (notifyTabs) broadcast();
      return snapshot.generation;
    },
    verify(
      user: AuthSessionUser | null,
      required: boolean,
      generation: number,
      ownerHint?: string | null,
    ) {
      if (!session.isCurrent(generation)) return null;
      const priorOwner = snapshot.user?.id ?? snapshot.provisional?.id ?? null;
      if (!user && required) {
        session.invalidate(priorOwner ? "Your session has ended." : snapshot.notice);
        return null;
      }
      const changedOwner = priorOwner !== null && priorOwner !== user?.id;
      if (changedOwner) clearDeskBootCache();
      publish({
        ...snapshot,
        user,
        provisional: null,
        phase: "verified",
        required,
        checked: true,
        offline: false,
        ownerHint: !user
          ? null
          : ownerHint === undefined
            ? snapshot.ownerHint
            : ownerHint && ownerHint === readOwnerHint()
              ? ownerHint
              : null,
        generation: snapshot.generation + Number(changedOwner),
      });
      if (changedOwner) broadcast();
      return user;
    },
    fail(notice: string, generation: number) {
      if (!session.isCurrent(generation)) return;
      if (snapshot.phase === "provisional") {
        publish({ ...snapshot, notice, offline: true });
        return;
      }
      if (snapshot.phase === "unchecked") {
        session.invalidate(notice, false, { clearCache: false });
        return;
      }
      publish({ ...snapshot, notice });
    },
    updateUser(user: AuthSessionUser | null, generation: number) {
      if (!session.isCurrent(generation)) return;
      session.verify(user, snapshot.required, generation);
    },
    clearUser(generation: number) {
      if (!session.isCurrent(generation)) return;
      if (snapshot.user) clearDeskBootCache();
      publish({ ...snapshot, user: null });
    },
    setNotice(notice: string, generation: number) {
      if (generation === snapshot.generation) publish({ ...snapshot, notice });
    },
    checkOwnerHint(cookieHint: string | null = readOwnerHint()) {
      if (!snapshot.active || !snapshot.ownerHint) return;
      if (cookieHint === snapshot.ownerHint) return;
      session.invalidate(
        "Your session changed in another tab. Sign in again to continue.",
        false,
      );
    },
  };
  return session;
}

export type Session = ReturnType<typeof createSession>;
export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionBoundary is required");
  return session;
}

/** Reset all App-owned slices together; old component setters cannot reach the new tree. */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const created = createSession({ provisional: readProvisionalDeskBoot() });
    setMutationGate(() => created.writesAllowed());
    return created;
  });
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    setMutationGate(() => session.writesAllowed());
    return () => setMutationGate(null);
  }, [session]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") session.checkOwnerHint();
    };
    const onFocus = () => session.checkOwnerHint();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [session]);
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
