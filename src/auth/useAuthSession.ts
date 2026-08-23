import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { apiFetch, apiUrl } from "../lib/apiBase";
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
  const [authUser, setAuthUser] = useState<AuthSessionUser | null>(null);
  const [onboardingDoneLocal, setOnboardingDoneLocal] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);
  const [authNotice, setAuthNotice] = useState("");

  async function hydrateAuth(): Promise<AuthSessionUser | null> {
    try {
      const res = await apiFetch("/api/auth/me", {
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        authRequired?: boolean;
        user?: {
          id: string;
          email: string | null;
          displayName: string | null;
          avatarUrl: string | null;
          onboardingCompleted?: boolean;
          agenda?: string | null;
          xUsername?: string | null;
          xLinked?: boolean;
          xCanPost?: boolean;
          isAdmin?: boolean;
        };
      };
      setAuthRequired(data.authRequired ?? true);
      if (res.ok && data.ok && data.user?.id) {
        const user: AuthSessionUser = {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName,
          avatarUrl: data.user.avatarUrl,
          onboardingCompleted: data.user.onboardingCompleted !== false,
          agenda:
            typeof data.user.agenda === "string" && data.user.agenda.trim()
              ? data.user.agenda
              : null,
          xUsername:
            typeof data.user.xUsername === "string" && data.user.xUsername.trim()
              ? data.user.xUsername.replace(/^@+/, "")
              : null,
          xLinked: Boolean(data.user.xLinked),
          xCanPost: Boolean(data.user.xCanPost),
          isAdmin: Boolean(data.user.isAdmin),
        };
        setAuthUser(user);
        return user;
      }
      setAuthUser(null);
      return null;
    } catch {
      setAuthUser(null);
      return null;
    } finally {
      setAuthChecked(true);
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
    hydrateAuth,
    startGoogleLogin,
    startXLogin,
    onLogout,
    finishOnboarding,
  };
}
