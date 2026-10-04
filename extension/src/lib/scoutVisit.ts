import { SCOUT_GROUND_INSET, SCOUT_SHADOW_DEPTH } from "../../../shared/src/scoutCompanionStage";
import {
  parseScoutVisit,
  scoutStageShift,
  SCOUT_VISIT,
  SCOUT_VISIT_ACCEPTED,
  type ScoutVisit,
  type ScoutVisitAccepted,
  type ScoutVisitSide,
} from "../../../shared/src/scoutVisit";
import { isRecord } from "../../../shared/src/typeGuards";

export function panelSide(): ScoutVisitSide {
  return import.meta.env.CHROME || import.meta.env.EDGE ? "right" : "left";
}

export async function relayScoutVisit(
  send: (message: ScoutVisit) => Promise<unknown>,
  side: ScoutVisitSide,
  visit: ScoutVisit,
): Promise<ScoutVisitAccepted | null> {
  const reply: unknown = await send({ type: SCOUT_VISIT, groundFromBottomPx: visit.groundFromBottomPx }).catch(() => null);
  return isRecord(reply) && reply.ok === true ? { type: SCOUT_VISIT_ACCEPTED, side } : null;
}

export function answerScoutVisit(raw: unknown, host: (visit: ScoutVisit) => boolean): Promise<{ ok: true }> | undefined {
  const visit = parseScoutVisit(raw);
  if (!visit) return undefined;
  return host(visit) ? Promise.resolve({ ok: true }) : undefined;
}

export function measureStageShift(canvas: HTMLElement, deskGroundPx: number | null, viewportHeight: number): number {
  const rect = canvas.getBoundingClientRect();
  const above = canvas.previousElementSibling?.getBoundingClientRect().bottom;
  const below = canvas.parentElement?.nextElementSibling?.getBoundingClientRect().top;
  return scoutStageShift({
    deskGroundPx,
    ownGroundPx: viewportHeight - (rect.bottom - SCOUT_GROUND_INSET),
    roomUpPx: above === undefined ? 0 : Math.max(0, rect.top - above),
    roomDownPx: SCOUT_GROUND_INSET - SCOUT_SHADOW_DEPTH + (below === undefined ? 0 : Math.max(0, below - rect.bottom)),
  });
}
