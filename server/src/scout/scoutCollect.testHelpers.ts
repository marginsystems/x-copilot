import type { ThreadCard } from "./threadCard.ts";

export function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "user",
    text: "hello short candidate",
    url: `https://x.com/i/status/${partial.id}`,
    onAgenda: true,
    views: 101,
    ...partial,
  };
}

export function fillBucket(id: { n: number }, n: number): ThreadCard[] {
  return Array.from({ length: n }, () => {
    id.n += 1;
    // Unique authors — per-run author dedupe keeps only one card per authorKey.
    return card({ id: `t${id.n}`, author: `@u${id.n}` });
  });
}
