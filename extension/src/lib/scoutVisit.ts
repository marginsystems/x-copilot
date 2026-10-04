import {
  parseScoutVisit,
  SCOUT_VISIT,
  SCOUT_VISIT_ACCEPTED,
  type ScoutVisitAccepted,
  type ScoutVisitSide,
} from "../../../shared/src/scoutVisit";
import { isRecord } from "../../../shared/src/typeGuards";

export function panelSide(): ScoutVisitSide {
  return import.meta.env.CHROME || import.meta.env.EDGE ? "right" : "left";
}

export async function relayScoutVisit(
  send: (message: { type: typeof SCOUT_VISIT }) => Promise<unknown>,
  side: ScoutVisitSide,
): Promise<ScoutVisitAccepted | null> {
  const reply: unknown = await send({ type: SCOUT_VISIT }).catch(() => null);
  return isRecord(reply) && reply.ok === true ? { type: SCOUT_VISIT_ACCEPTED, side } : null;
}

export function answerScoutVisit(raw: unknown, host: () => boolean): Promise<{ ok: true }> | undefined {
  if (!parseScoutVisit(raw)) return undefined;
  return host() ? Promise.resolve({ ok: true }) : undefined;
}
