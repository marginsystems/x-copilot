import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useSession } from "../auth/session";
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
  const session = useSession();
  const generation = session.capture();
  const ownerId = authUser?.id ?? null;
  const savedRef = useRef<string | null>(authUser?.agenda ?? null);
  const savedOwnerRef = useRef({ generation, ownerId });
  const agendaRef = useRef(agenda);
  const enabledRef = useRef(enabled);
  const userIdRef = useRef(ownerId);
  const generationRef = useRef(generation);
  const inflightRef = useRef<Promise<void> | null>(null);

  agendaRef.current = agenda;
  enabledRef.current = enabled;
  userIdRef.current = ownerId;
  generationRef.current = generation;
  if (
    savedOwnerRef.current.generation !== generation ||
    savedOwnerRef.current.ownerId !== ownerId
  ) {
    savedOwnerRef.current = { generation, ownerId };
    savedRef.current = authUser?.agenda ?? null;
  }
  if (
    authUser?.agenda &&
    agendaNeedsPersist(agenda, authUser.agenda) === null
  ) {
    savedRef.current = authUser.agenda.trim();
  }

  async function persistNow(draft = agendaRef.current): Promise<void> {
    const scheduledGeneration = session.capture();
    const scheduledOwnerId = userIdRef.current;
    const isScheduledOwnerCurrent = () =>
      enabledRef.current &&
      scheduledOwnerId !== null &&
      generationRef.current === scheduledGeneration &&
      userIdRef.current === scheduledOwnerId &&
      session.isCurrent(scheduledGeneration) &&
      session.getSnapshot().user?.id === scheduledOwnerId;
    if (!isScheduledOwnerCurrent()) return;
    const prior = inflightRef.current;
    const pending = (async () => {
      if (prior) {
        try {
          await prior;
        } catch {
          /* previous attempt failed — still persist this draft */
        }
      }
      if (!isScheduledOwnerCurrent()) return;
      const next = agendaNeedsPersist(draft, savedRef.current);
      if (!next) return;
      try {
        if (!isScheduledOwnerCurrent()) return;
        const res = await apiFetch("/api/agenda", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agenda: next }),
        });
        if (!res.ok || !isScheduledOwnerCurrent()) return;
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
