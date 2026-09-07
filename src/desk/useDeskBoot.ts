import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import { viewFromPath, type AppView } from "../lib/appView";
import { readBootQuery } from "../lib/bootQuery";
import {
  clearDeskBootCache,
  fetchDeskBoot,
  writeDeskBootCache,
  type DeskBootDesk,
} from "../lib/deskBoot";
import {
  readOnboardingAgenda,
  readOnboardingComplete,
} from "../lib/onboarding";
import { ensureActivitySubscribe } from "./watch";

type UseDeskBootOpts = {
  dedupeAccounts: boolean;
  setAgenda: Dispatch<SetStateAction<string>>;
  setAuthNotice: (notice: string) => void;
  setBillingNotice: (notice: string) => void;
  setView: (view: AppView) => void;
  setSignInOpen: (open: boolean) => void;
  applyAuthUser: (
    user: AuthSessionUser | null,
    required?: boolean,
  ) => AuthSessionUser | null;
  hydrateAuth: () => Promise<AuthSessionUser | null>;
  /** Seed every desk slice from the one-shot boot payload. */
  applyDesk: (desk: DeskBootDesk) => void;
  /** Per-endpoint hydrate when the boot endpoint is missing or errored. */
  hydrateDeskWithoutBoot: (onboarded: boolean) => Promise<void>;
  confirmCheckout: (sessionId: string) => Promise<void>;
  hydrateCoaching: () => Promise<void>;
  hydrateActivityStats: () => Promise<void>;
  loadBilling: () => Promise<void>;
  hydrateVoice: () => Promise<void>;
  loadUsage: () => Promise<void>;
  loadAdmin: () => Promise<void>;
};

/**
 * One-shot desk boot: consume callback query flags, fetch `/api/desk/boot`,
 * write the paint cache, then fall back to per-endpoint hydrate when boot is
 * unavailable. Owns the readiness flags the desk waits on.
 */
export function useDeskBoot(opts: UseDeskBootOpts) {
  const [agendaReady, setAgendaReady] = useState(false);
  const [deskBootReady, setDeskBootReady] = useState(false);
  const [onboardingSeedAgenda, setOnboardingSeedAgenda] = useState<
    string | null
  >(null);

  useEffect(() => {
    const {
      setAgenda,
      setAuthNotice,
      setBillingNotice,
      setView,
      setSignInOpen,
      applyAuthUser,
      hydrateAuth,
      applyDesk,
      hydrateDeskWithoutBoot,
      confirmCheckout,
      hydrateCoaching,
      hydrateActivityStats,
      loadBilling,
      hydrateVoice,
      loadUsage,
      loadAdmin,
    } = opts;
    const query = readBootQuery(window.location);
    const err = query.authError;
    if (err) {
      setAuthNotice(err);
    } else if (query.authOk) setAuthNotice("Signed in.");
    const { checkout, sessionId } = query;
    if (checkout === "success") {
      setView("usage");
      setBillingNotice("Checkout complete — confirming your plan…");
    } else if (checkout === "cancel") {
      setView("usage");
      setBillingNotice("Checkout canceled.");
    }
    if (query.cleanUrl) {
      window.history.replaceState({}, "", query.cleanUrl);
    }
    void (async () => {
      const applyUser = (user: AuthSessionUser | null) => {
        const onboarded = user
          ? user.onboardingCompleted
          : readOnboardingComplete();
        if (user?.agenda) {
          setAgenda(user.agenda);
          setOnboardingSeedAgenda(null);
          readOnboardingAgenda(user.id);
        } else {
          const storedAgenda = readOnboardingAgenda(user?.id);
          if (storedAgenda) {
            setAgenda(storedAgenda);
            if (!onboarded) setOnboardingSeedAgenda(storedAgenda);
          }
        }
        setAgendaReady(true);
        return onboarded;
      };

      const refreshAfterPaint = (
        user: AuthSessionUser | null,
        refreshActivityStats = true,
      ) => {
        void hydrateCoaching();
        if (refreshActivityStats) void hydrateActivityStats();
        void loadBilling();
        if (user) {
          ensureActivitySubscribe();
          void hydrateVoice();
        }
        if (viewFromPath(window.location.pathname) === "usage" || checkout) {
          void loadUsage();
        }
        if (viewFromPath(window.location.pathname) === "admin" && user?.isAdmin) {
          void loadAdmin();
        }
      };

      const boot = await fetchDeskBoot(opts.dedupeAccounts);
      if (boot.status === "ok") {
        const user = applyAuthUser(boot.payload.user, boot.payload.authRequired);
        if (err && !user) setSignInOpen(true);
        applyUser(user);
        if (boot.payload.desk) {
          applyDesk(boot.payload.desk);
          writeDeskBootCache(boot.payload);
        } else {
          clearDeskBootCache();
        }
        if (checkout === "success" && sessionId) {
          await confirmCheckout(sessionId);
        }
        refreshAfterPaint(user, false);
        setDeskBootReady(true);
        return;
      }

      if (boot.status === "unauthenticated") {
        applyAuthUser(null, boot.authRequired);
        clearDeskBootCache();
        if (err) setSignInOpen(true);
        applyUser(null);
        setDeskBootReady(true);
        return;
      }

      clearDeskBootCache();
      const user = await hydrateAuth();
      if (err && !user) setSignInOpen(true);
      const onboarded = applyUser(user);
      await hydrateDeskWithoutBoot(onboarded);
      if (checkout === "success" && sessionId) {
        await confirmCheckout(sessionId);
      }
      refreshAfterPaint(user);
      setDeskBootReady(true);
    })();
    // Boot runs once; the callbacks are the first render's closures, same as before the extract.
  }, []);

  return { agendaReady, deskBootReady, onboardingSeedAgenda };
}
