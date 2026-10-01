export const X_SELECTORS = {
  post: 'article[data-testid="tweet"]',
  replyComposer: '[data-testid="tweetTextarea_0"]',
} as const;

export type RectLike = { top: number; bottom: number; left: number; right: number; width: number; height: number };

export function rectInViewport(rect: RectLike, viewport: { width: number; height: number }): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
}

export function chipPosition(composer: RectLike, chipHeight: number): { top: number; left: number } {
  const above = composer.top - chipHeight - 6;
  return { top: above >= 0 ? above : composer.bottom + 6, left: Math.max(0, composer.left) };
}
