type ClickSource = { onClicked: { addListener(listener: () => void): void } };

export type ToolbarApi = {
  action?: ClickSource;
  browserAction?: ClickSource;
  sidebarAction?: { toggle(): Promise<void> };
};

export function toggleSidebarOnToolbarClick(api: ToolbarApi): boolean {
  const sidebar = api.sidebarAction;
  const toolbar = api.action ?? api.browserAction;
  if (!sidebar || !toolbar) return false;
  toolbar.onClicked.addListener(() => {
    sidebar.toggle().catch(() => undefined);
  });
  return true;
}
