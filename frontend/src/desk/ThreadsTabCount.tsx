/** Hidden "(0)" keeps the slot when empty so a first count cannot jump the pill. */
export function ThreadsTabCount({ n }: { n: number }) {
  return (
    <span
      className={n > 0 ? "threads-tab-count" : "threads-tab-count is-empty"}
      aria-hidden={n === 0}
    >
      {n > 0 ? `(${n})` : "(0)"}
    </span>
  );
}
