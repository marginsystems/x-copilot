export function OnboardingPreviewBar(props: {
  simulateUnlinked: boolean;
  onSimulateUnlinked: (next: boolean) => void;
  onExit: () => void;
}) {
  return (
    <div className="onboarding-preview-bar">
      <p className="onboarding-preview-note">
        Preview — generate is live. Completing writes nothing. Simulate
        unlinked shows the X wall after you pick an agenda.
      </p>
      <label className="onboarding-preview-sim">
        <input
          type="checkbox"
          checked={props.simulateUnlinked}
          onChange={(e) => props.onSimulateUnlinked(e.target.checked)}
        />
        Simulate: unlinked
      </label>
      <button type="button" className="ghost" onClick={props.onExit}>
        Exit preview
      </button>
    </div>
  );
}
