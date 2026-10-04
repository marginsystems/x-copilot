import { useEffect, useRef } from "react";
import type { ScoutLook } from "../../../../shared/src/scoutCompanion";
import { SCOUT_CANVAS_LABEL, startScoutStage, type ScoutStage } from "../../../../shared/src/scoutCompanionStage";

export function Scout({ look }: { look: ScoutLook }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ScoutStage | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (stageRef.current) stageRef.current.show(look);
    else stageRef.current = startScoutStage(canvas, { look });
  }, [look]);

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
