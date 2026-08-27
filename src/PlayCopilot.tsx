import {
  playStateClass,
  type PlayCreatureState,
  type PlayScene,
} from "./lib/play";

const STATE_LABELS: Record<PlayCreatureState, string> = {
  idle: "The copilot rests on its perch.",
  celebrate: "The copilot hops on its perch.",
  nudge: "The copilot has a suggestion.",
  sleep: "The copilot is asleep.",
};

/**
 * The copilot creature: one inline SVG in the GuestAvatar pixel idiom
 * (6px blocks, square caps, stroke 0.85). Pose and lamp come from
 * playStateClass on the wrapper; all motion is CSS so 99-motion.css can
 * flatten it to a still pose per state. Colors are token classes only —
 * see 21-play.css.
 */
export function PlayCopilot({ scene }: { scene: PlayScene }) {
  const showSpeech = scene.state === "nudge" && scene.speech !== null;

  return (
    <div className={`play-scene ${playStateClass(scene)}`}>
      <svg
        className="play-stage"
        viewBox="0 0 132 96"
        role="img"
        aria-label={STATE_LABELS[scene.state]}
        focusable="false"
      >
        <rect className="play-bg" width="132" height="96" />

        {/* Perch bar and legs */}
        <rect className="play-perch" x="18" y="78" width="96" height="6" />
        <rect className="play-perch" x="27" y="84" width="6" height="12" />
        <rect className="play-perch" x="99" y="84" width="6" height="12" />

        {/* Perch lamp: glow + bulb follow the is-lit modifier */}
        <rect className="play-lamp-glow" x="21" y="45" width="18" height="18" />
        <rect className="play-perch" x="28.5" y="51" width="3" height="27" />
        <rect className="play-perch" x="22.5" y="45" width="15" height="6" />
        <rect className="play-lamp-bulb" x="27" y="51" width="6" height="6" />

        {/* The bird. Hop/breathe animate this group. */}
        <g className="play-bird">
          <rect className="play-tail" x="42" y="51" width="6" height="9" />
          <path
            className="play-body"
            d="M48 48 H84 V66 H78 V72 H54 V66 H48 Z"
          />
          <rect className="play-shade" x="54" y="63" width="24" height="9" />
          <path
            className="play-wing"
            d="M54 52.5 H67.5 V63 H60 V66 H54 Z"
          />
          <rect className="play-feet" x="58.5" y="72" width="3" height="6" />
          <rect className="play-feet" x="70.5" y="72" width="3" height="6" />
          {/* Head tilts for nudge; drawn last so it overlaps the wing. */}
          <g className="play-head">
            <path
              className="play-head-block"
              d="M60 36 H78 V42 H84 V54 H54 V42 H60 Z"
            />
            <rect className="play-beak" x="84" y="46.5" width="6" height="4.5" />
            <rect className="play-eye" x="70.5" y="43.5" width="4.5" height="4.5" />
            <g className="play-eye-shut">
              <rect className="play-eye-lid" x="69" y="42" width="7.5" height="7.5" />
              <rect className="play-eye-seam" x="69" y="46.5" width="7.5" height="1.5" />
            </g>
          </g>
        </g>
      </svg>
      {scene.state === "celebrate" ? (
        // Text slot for the celebrate line; PR 4 fills it from the cursor diff.
        <p className="play-celebrate-line" aria-live="polite" />
      ) : null}
      {showSpeech ? (
        <div className="play-speech" role="status">
          {scene.speechKind ? (
            <span className="play-speech-kind">{scene.speechKind}</span>
          ) : null}
          <p className="play-speech-text">{scene.speech}</p>
        </div>
      ) : null}
    </div>
  );
}
