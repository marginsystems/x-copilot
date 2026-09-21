import {
  useEffect,
  useState,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { apiFetch } from "../lib/apiBase";
import { useSession } from "../auth/session";
import type { AuthSessionUser } from "../auth/types";
import { viewFromPath, type AppView } from "../lib/appView";
import { readBootQuery } from "../lib/bootQuery";
import {
  clearDeskBootCache,
  fetchDeskBoot,
  parseDeskBoot,
  parseAuthSessionUser,
  writeDeskBootCache,
  type DeskBootDeskPatch,
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
  /** Seed every desk slice from the one-shot boot payload. */
  applyDesk: (desk: DeskBootDeskPatch) => void;
  confirmCheckout: (sessionId: string) => Promise<void>;
  hydrateCoaching: () => Promise<void>;
  hydrateActivityStats: () => Promise<void>;
  loadBilling: () => Promise<void>;
  hydrateVoice: () => Promise<void>;
  loadUsage: () => Promise<void>;
  loadAdmin: () => Promise<void>;
  /** Optional post-paint familiarity refresh when boot predates the field. */
  hydrateScoutFamiliarity?: () => Promise<void>;
};

/**
 * One-shot desk boot: consume callback query flags, fetch `/api/boot`,
 * write the paint cache, then fall back to per-endpoint hydrate when boot is
 * unavailable. Owns the readiness flags the desk waits on.
 */
export function useDeskBoot(opts: UseDeskBootOpts) {
  const session = useSession();
  const [agendaReady, setAgendaReady] = useState(false);
  const [deskBootReady, setDeskBootReady] = useState(false);
  const [onboardingSeedAgenda, setOnboardingSeedAgenda] = useState<
    string | null
  >(null);

  const queryRef = useRef(readBootQuery(window.location));

  useEffect(() => {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && session.isCurrent(generation);
    const unsubscribe = session.subscribe(() => {
      if (!session.isCurrent(generation)) controller.abort();
    });
    const {
      setAgenda,
      setAuthNotice,
      setBillingNotice,
      setView,
      setSignInOpen,
      applyAuthUser,
      applyDesk,
      confirmCheckout,
      hydrateCoaching,
      hydrateActivityStats,
      loadBilling,
      hydrateVoice,
      loadUsage,
      loadAdmin,
      hydrateScoutFamiliarity,
    } = opts;
    const query = queryRef.current;
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
    const deadline = window.setTimeout(() => {
      if (!current()) return;
      if (!session.getSnapshot().checked) {
        session.invalidate("Desk loading timed out. Reload to try again.", false);
        return;
      }
      setAuthNotice("Desk loading timed out. Reload to try again.");
      setAgendaReady(true);
      setDeskBootReady(true);
      controller.abort();
    }, 24000);
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

      const boot = await fetchDeskBoot(opts.dedupeAccounts, controller.signal);
      if (!current()) return;
      if (boot.status === "ok") {
        const user = applyAuthUser(boot.payload.user, boot.payload.authRequired);
        if (!current()) return;
        if (err && !user) setSignInOpen(true);
        applyUser(user);
        if (boot.payload.desk) {
          applyDesk(boot.payload.desk);
          if (!current()) return;
          writeDeskBootCache(boot.payload);
        } else {
          clearDeskBootCache();
        }
        if (!current()) return;
        if (checkout === "success" && sessionId) {
          await confirmCheckout(sessionId);
        }
        if (!current()) return;
        refreshAfterPaint(user, false);
        setDeskBootReady(true);
        // An older boot payload has no familiarity slice: one optional
        // refresh after paint, no retry, never blocking readiness.
        if (user && boot.payload.desk && boot.payload.desk.scoutFamiliarity === undefined) {
          void hydrateScoutFamiliarity?.();
        }
        return;
      }

      if (boot.status === "unauthenticated") {
        applyAuthUser(null, boot.authRequired);
        if (!current()) return;
        clearDeskBootCache();
        if (err) setSignInOpen(true);
        applyUser(null);
        setDeskBootReady(true);
        return;
      }

      clearDeskBootCache();
      // Read first, commit together: legacy hydrators commit internally and cannot
      // be canceled at this call site during StrictMode replay or session reset.
      const read = async (path: string) => {
        if (!current()) throw new Error("Boot canceled");
        const res = await apiFetch(path, { signal: controller.signal });
        if (!current()) throw new Error("Boot canceled");
        if (res.status === 401) {
          let required = path === "/api/auth/me" || session.getSnapshot().required;
          try {
            const body = (await res.json()) as { authRequired?: boolean };
            if (typeof body.authRequired === "boolean") required = body.authRequired;
          } catch {
            /* Empty 401 bodies still expire a required session. */
          }
          applyAuthUser(null, required);
          if (required) throw new Error("Session expired");
          return path === "/api/auth/me" ? null : undefined;
        }
        if (!res.ok) return undefined;
        const data = await res.json();
        if (!current()) throw new Error("Boot canceled");
        return data;
      };
      const auth = await read("/api/auth/me");
      if (!current()) return;
      const optionalAnonymous =
        auth === null && session.getSnapshot().checked && !session.getSnapshot().required;
      if (!auth?.ok && !optionalAnonymous) throw new Error("Invalid auth response");
      const user = optionalAnonymous
        ? applyAuthUser(null, false)
        : applyAuthUser(parseAuthSessionUser(auth.user), auth.authRequired ?? true);
      if (!current()) return;
      if (err && !user) setSignInOpen(true);
      const onboarded = applyUser(user);
      const [dismissed, skipped, interacted, expired, forYou, gamification, lastScout, scoutProfile] = await Promise.all([
        read("/api/dismissed"), read("/api/skipped"), read("/api/interacted"),
        read("/api/expired"), read("/api/for-you"), read("/api/gamification"),
        onboarded ? read(`/api/scout/last?dedupeAccounts=${opts.dedupeAccounts}&autoStart=0`) : null,
        // Optional: an older API (404) or failed read leaves the slice absent.
        user ? read("/api/scout/profile").catch(() => undefined) : null,
      ]);
      if (!current()) return;
      const parsedDesk = parseDeskBoot({ ok: true, user, desk: {
        dismissed, skipped, interacted, expired, forYou, gamification, lastScout,
        ...(scoutProfile == null
          ? {}
          : { scoutFamiliarity: (scoutProfile as { scoutFamiliarity?: unknown }).scoutFamiliarity ?? null }),
      } })!.desk!;
      const desk: DeskBootDeskPatch = parsedDesk;
      if (dismissed === undefined) delete desk.dismissed;
      if (skipped === undefined) delete desk.skipped;
      if (interacted === undefined) delete desk.interacted;
      if (expired === undefined) delete desk.expired;
      if (forYou === undefined) delete desk.forYou;
      if (gamification === undefined) delete desk.gamification;
      delete desk.activityStats;
      delete desk.coaching;
      if (lastScout == null) delete desk.lastScout;
      applyDesk(desk);
      if (!current()) return;
      if (checkout === "success" && sessionId) {
        await confirmCheckout(sessionId);
      }
      if (!current()) return;
      refreshAfterPaint(user);
      setDeskBootReady(true);
    })().catch(() => {
      if (!current()) return;
      if (!session.getSnapshot().checked) {
        session.invalidate("Desk could not load. Reload to try again.", false);
        return;
      }
      setAuthNotice("Desk could not load. Reload to try again.");
      setAgendaReady(true);
      setDeskBootReady(true);
      controller.abort();
    }).finally(() => window.clearTimeout(deadline));
    return () => {
      controller.abort();
      unsubscribe();
      window.clearTimeout(deadline);
    };
    // Boot runs once; the callbacks are the first render's closures, same as before the extract.
  }, []);

  return { agendaReady, deskBootReady, onboardingSeedAgenda };
}
