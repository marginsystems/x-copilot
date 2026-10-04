export type FocusSender = { url?: string; tab?: { windowId?: number } };

export type WindowFocusReply = { focused: boolean };

function isXPage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === "https://x.com";
  } catch {
    return false;
  }
}

export function senderWindowFocused(
  sender: FocusSender,
  getWindow: (windowId: number) => Promise<{ focused: boolean }>,
): Promise<WindowFocusReply> {
  const windowId = sender.tab?.windowId;
  if (windowId === undefined || !isXPage(sender.url)) return Promise.resolve({ focused: false });
  return getWindow(windowId).then(
    (window) => ({ focused: window.focused === true }),
    () => ({ focused: false }),
  );
}
