import {
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { apiFetch, apiUrl } from "../lib/apiBase";
import { parseAuthSessionUser } from "../lib/deskBoot";
import { useSession } from "./session";
import type { AuthSessionUser } from "./types";

type UseAuthSessionOptions = {
  setAgenda: Dispatch<SetStateAction<string>>;
  onLoggedOut: () => void;
  onOnboardingFinished: () => void;
};

export function useAuthSession({
  setAgenda,
  onLoggedOut,
  onOnboardingFinished,
}: UseAuthSessionOptions) {
  const session = useSession();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const generation = snapshot.generation;
  const authUser = snapshot.user;
  const authChecked = snapshot.checked;
  const authRequired = snapshot.required;
  const authNotice = snapshot.notice;
  const [onboardingDoneLocal, setOnboardingDoneLocal] = useState(false);
  const setAuthNotice = (notice: string) => session.setNotice(notice, generation);
  const setAuthUser: Dispatch<SetStateAction<AuthSessionUser | null>> = (value) => {
    if (!session.isCurrent(generation)) return;
    const user = typeof value === "function" ? value(session.getSnapshot().user) : value;
    if (user === null) session.clearUser(generation);
    else session.updateUser(user, generation);
  };
  function applyAuthUser(user: AuthSessionUser | null, required = true) {
    return session.verify(user, required, generation);
  }
  function invalidateSession() {
    if (!session.isCurrent(generation)) return false;
    session.invalidate();
    return true;
  }

  async function hydrateAuth(): Promise<AuthSessionUser | null> {
    try {
      const res = await apiFetch("/api/auth/me", {
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        authRequired?: boolean;
        user?: unknown;
      };
      const user =
        res.ok && data.ok ? parseAuthSessionUser(data.user) : null;
      return applyAuthUser(user, data.authRequired ?? true);
    } catch {
      const current = session.getSnapshot();
      return applyAuthUser(current.user, current.user ? current.required : false);
    }
  }

  function startGoogleLogin() {
    window.location.href = apiUrl("/api/auth/google");
  }

  function startXLogin() {
    window.location.href = apiUrl("/api/auth/x");
  }

  async function onLogout() {
    if (!session.isCurrent(generation)) return;
    const resetGeneration = session.invalidate("Signing out…");
    onLoggedOut();
    try {
      const response = await apiFetch("/api/auth/logout", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Logout failed (${response.status})`);
      session.setNotice("Signed out.", resetGeneration);
    } catch {
      session.setNotice(
        "This tab was cleared, but server sign-out could not be confirmed. Your session may still be active; reload and try signing out again.",
        resetGeneration,
      );
    }
  }

  function finishOnboarding(agenda: string) {
    setAgenda(agenda);
    setOnboardingDoneLocal(true);
    setAuthUser((prev) =>
      prev
        ? {
            ...prev,
            onboardingCompleted: true,
            agenda,
          }
        : prev,
    );
    onOnboardingFinished();
  }

  return {
    authUser,
    invalidateSession,
    setAuthUser,
    onboardingDoneLocal,
    authChecked,
    authRequired,
    authNotice,
    setAuthNotice,
    applyAuthUser,
    hydrateAuth,
    startGoogleLogin,
    startXLogin,
    onLogout,
    finishOnboarding,
    setOnboardingDoneLocal,
  };
}
