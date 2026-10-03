export const X_SELECTORS = {
  post: 'article[data-testid="tweet"]',
  replyComposer: '[data-testid="tweetTextarea_0"]',
  inlineReplyButton: '[data-testid="tweetButtonInline"]',
  sentToastLink: '[data-testid="toast"] a[href*="/status/"]',
} as const;

export type RectLike = { top: number; bottom: number; left: number; right: number; width: number; height: number };

export function rectInViewport(rect: RectLike, viewport: { width: number; height: number }): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
}

export const CHIP_GAP = 6;
export const CHIP_INLINE_GAP = 12;

export function sharesRow(a: RectLike, b: RectLike): boolean {
  if (a.height <= 0 || b.height <= 0) return false;
  return a.top < b.bottom && a.bottom > b.top;
}

export function chipPagePosition(
  composer: RectLike,
  scroll: { x: number; y: number },
  chipHeight: number,
  replyButton?: RectLike | null,
): { top: number; right: number } {
  if (replyButton && sharesRow(composer, replyButton)) {
    return {
      top: Math.round(replyButton.top + (replyButton.height - chipHeight) / 2 + scroll.y),
      right: Math.round(replyButton.left - CHIP_INLINE_GAP + scroll.x),
    };
  }
  const above = composer.top + scroll.y - chipHeight - CHIP_GAP;
  return {
    top: Math.round(above >= 0 ? above : composer.bottom + scroll.y + CHIP_GAP),
    right: Math.round(composer.right + scroll.x),
  };
}
