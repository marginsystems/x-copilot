/** Empty /play shell. Creature and scene land in later PRs. */

export function PlayPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="panel settings-pane play-pane">
      <div className="settings-head">
        <h2>Perch</h2>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="status settings-lede play-lede">
        A souvenir of the day's desk work. Nothing here yet.
      </p>
    </section>
  );
}
