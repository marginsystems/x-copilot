import { describe, expect, it, vi } from "vitest";
import { toggleSidebarOnToolbarClick } from "./toolbar";

function clickSource() {
  const listeners: (() => void)[] = [];
  return {
    onClicked: { addListener: (listener: () => void) => { listeners.push(listener); } },
    click: () => { for (const listener of listeners) listener(); },
  };
}

describe("toggleSidebarOnToolbarClick", () => {
  it("toggles the Firefox sidebar when the toolbar button is clicked", () => {
    const browserAction = clickSource();
    const toggle = vi.fn().mockResolvedValue(undefined);
    expect(toggleSidebarOnToolbarClick({ browserAction, sidebarAction: { toggle } })).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    browserAction.click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("uses the Manifest V3 action when the browser has one", () => {
    const action = clickSource();
    const browserAction = clickSource();
    const toggle = vi.fn().mockResolvedValue(undefined);
    toggleSidebarOnToolbarClick({ action, browserAction, sidebarAction: { toggle } });
    browserAction.click();
    expect(toggle).not.toHaveBeenCalled();
    action.click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("does nothing in a browser without a sidebar", () => {
    const action = clickSource();
    expect(toggleSidebarOnToolbarClick({ action })).toBe(false);
    action.click();
  });
});
