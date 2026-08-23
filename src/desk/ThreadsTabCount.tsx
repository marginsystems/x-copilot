/** Always occupies a count slot so hydrate cannot grow the tab pills. */
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
