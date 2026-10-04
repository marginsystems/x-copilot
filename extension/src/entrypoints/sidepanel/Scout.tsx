import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { scoutCheersFor, type ScoutCardWatch, type ScoutLook } from "../../../../shared/src/scoutCompanion";
import {
  SCOUT_CANVAS_LABEL,
  SCOUT_DESK_PALETTE,
  startScoutStage,
  type ScoutStage,
} from "../../../../shared/src/scoutCompanionStage";
import { SCOUT_VISIT_TOTAL_MS, scoutVisitEntryEdge, type ScoutVisit } from "../../../../shared/src/scoutVisit";
import { answerScoutVisit, measureStageShift, panelSide } from "../../lib/scoutVisit";

const NO_CARD: ScoutCardWatch = { cardKey: null, detected: false };

export function Scout({ look, card = NO_CARD }: { look: ScoutLook; card?: ScoutCardWatch }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ScoutStage | null>(null);
  const releaseRef = useRef<number | null>(null);
  const [shiftPx, setShiftPx] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (stageRef.current) stageRef.current.show(look);
    else stageRef.current = startScoutStage(canvas, { look });
  }, [look]);

  const { cardKey, detected } = card;
  const watchedCardRef = useRef<ScoutCardWatch>({ cardKey, detected });
  useEffect(() => {
    const next = { cardKey, detected };
    if (scoutCheersFor(watchedCardRef.current, next)) stageRef.current?.cheer();
    watchedCardRef.current = next;
  }, [cardKey, detected]);

  const awake = look.awake;
  useEffect(() => {
    if (!awake) return;
    const hostVisit = (visit: ScoutVisit) => {
      if (!stageRef.current?.host(SCOUT_DESK_PALETTE, scoutVisitEntryEdge(panelSide()))) return false;
      const canvas = canvasRef.current;
      const shift = canvas ? measureStageShift(canvas, visit.groundFromBottomPx, window.innerHeight) : 0;
      if (releaseRef.current !== null) window.clearTimeout(releaseRef.current);
      setShiftPx(shift);
      releaseRef.current = shift === 0 ? null : window.setTimeout(() => setShiftPx(0), SCOUT_VISIT_TOTAL_MS);
      return true;
    };
    const onMessage = (raw: unknown) => answerScoutVisit(raw, hostVisit);
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [awake]);

  useEffect(
    () => () => {
      if (releaseRef.current !== null) window.clearTimeout(releaseRef.current);
      stageRef.current?.stop();
      stageRef.current = null;
    },
    [],
  );

  return (
    <section className="scout" aria-label="Scout">
      <p className="scout-line">{look.line}</p>
      {look.facts.length > 0 ? (
        <dl className="scout-facts">
          {look.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <canvas
        ref={canvasRef}
        className="scout-stage"
        style={shiftPx === 0 ? undefined : { transform: `translateY(${shiftPx}px)` }}
        role="img"
        aria-label={SCOUT_CANVAS_LABEL}
      />
    </section>
  );
}
