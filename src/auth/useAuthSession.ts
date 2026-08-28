import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { apiFetch, apiUrl } from "../lib/apiBase";
import {
  clearDeskBootCache,
  parseAuthSessionUser,
  peekDeskBootCache,
} from "../lib/deskBoot";
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
  const cached = peekDeskBootCache();
  const [authUser, setAuthUser] = useState<AuthSessionUser | null>(
    () => cached?.user ?? null,
  );
  const [onboardingDoneLocal, setOnboardingDoneLocal] = useState(false);
  const [authChecked, setAuthChecked] = useState(() => Boolean(cached?.user));
  const [authRequired, setAuthRequired] = useState(
    () => cached?.authRequired ?? true,
  );
  const [authNotice, setAuthNotice] = useState("");

  function applyAuthUser(
    user: AuthSessionUser | null,
    required = true,
  ): AuthSessionUser | null {
    setAuthRequired(required);
    setAuthUser(user);
    setAuthChecked(true);
    return user;
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
      return applyAuthUser(null);
    }
  }

  function startGoogleLogin() {
    window.location.href = apiUrl("/api/auth/google");
  }

  function startXLogin() {
    window.location.href = apiUrl("/api/auth/x");
  }

  async function onLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* still clear local */
    }
    setAuthUser(null);
    clearDeskBootCache();
    setAuthNotice("Signed out.");
    onLoggedOut();
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
