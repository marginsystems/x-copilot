import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AuthSessionUser } from "../auth/types";
import { apiFetch } from "../lib/apiBase";
import {
  AGENDA_DEBOUNCE_MS,
  agendaNeedsPersist,
} from "../lib/agendaPersist";

type UseAgendaPersistOpts = {
  agenda: string;
  enabled: boolean;
  authUser: AuthSessionUser | null;
  setAuthUser: Dispatch<SetStateAction<AuthSessionUser | null>>;
};

export function useAgendaPersist({
  agenda,
  enabled,
  authUser,
  setAuthUser,
}: UseAgendaPersistOpts) {
  const savedRef = useRef<string | null>(authUser?.agenda ?? null);
  const agendaRef = useRef(agenda);
  const enabledRef = useRef(enabled);
  const userIdRef = useRef(authUser?.id ?? null);
  const inflightRef = useRef<Promise<void> | null>(null);

  agendaRef.current = agenda;
  enabledRef.current = enabled;
  userIdRef.current = authUser?.id ?? null;
  if (
    authUser?.agenda &&
    agendaNeedsPersist(agenda, authUser.agenda) === null
  ) {
    savedRef.current = authUser.agenda.trim();
  }

  async function persistNow(draft = agendaRef.current): Promise<void> {
    if (!enabledRef.current || !userIdRef.current) return;
    const next = agendaNeedsPersist(draft, savedRef.current);
    if (!next) return;
    const prior = inflightRef.current;
    const pending = (async () => {
      if (prior) {
        try {
          await prior;
        } catch {
          /* previous attempt failed — still persist this draft */
        }
      }
      try {
        const res = await apiFetch("/api/agenda", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agenda: next }),
        });
        if (!res.ok) return;
        savedRef.current = next;
        setAuthUser((prev) => (prev ? { ...prev, agenda: next } : prev));
      } catch {
        /* next debounce or blur retries */
      }
    })();
    inflightRef.current = pending;
    await pending;
    if (inflightRef.current === pending) inflightRef.current = null;
  }

  function flushAgenda(): void {
    void persistNow();
  }

  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => {
      void persistNow();
    }, AGENDA_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [agenda, enabled, authUser?.id]);

  useEffect(() => {
    return () => {
      void persistNow();
    };
  }, []);

  return { flushAgenda, onAgendaBlur: flushAgenda };
}
