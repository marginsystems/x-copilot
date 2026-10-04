import { useEffect, useRef } from "react";
import { browser } from "wxt/browser";
import { scoutCheersFor, type ScoutCardWatch, type ScoutLook } from "../../../../shared/src/scoutCompanion";
import {
  SCOUT_CANVAS_LABEL,
  SCOUT_DESK_PALETTE,
  startScoutStage,
  type ScoutStage,
} from "../../../../shared/src/scoutCompanionStage";
import { scoutVisitEntryEdge } from "../../../../shared/src/scoutVisit";
import { answerScoutVisit, panelSide } from "../../lib/scoutVisit";

const NO_CARD: ScoutCardWatch = { cardKey: null, detected: false };

export function Scout({ look, card = NO_CARD }: { look: ScoutLook; card?: ScoutCardWatch }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ScoutStage | null>(null);

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
    const onMessage = (raw: unknown) =>
      answerScoutVisit(raw, () => stageRef.current?.host(SCOUT_DESK_PALETTE, scoutVisitEntryEdge(panelSide())) ?? false);
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [awake]);

  useEffect(
    () => () => {
      stageRef.current?.stop();
      stageRef.current = null;
    },
    [],
  );

  return (
    <section className="scout" aria-label="Scout">
      <canvas ref={canvasRef} className="scout-stage" role="img" aria-label={SCOUT_CANVAS_LABEL} />
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
    </section>
  );
}
