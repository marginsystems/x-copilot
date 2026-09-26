import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ThreadsTab } from "../../src/desk/types";
import type { VoiceState } from "../../src/lib/voice";

vi.mock("../../src/desk/useApproachTask", () => ({
  // ready:false keeps the Approach loading branch; cardInput/actions are unread.
  useApproachTask: () => ({ badge: 0, ready: false }),
}));

import { ThreadsTabs } from "../../src/desk/ThreadsTabs";

function Harness({ total = 0, page = 1, onPage = async (_page: number) => {} }: { total?: number; page?: number; onPage?: (page: number) => Promise<void> }) {
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setVoice] = useState<VoiceState | null>(null);
  return (
    <ThreadsTabs
      threadsTab={threadsTab}
      setThreadsTab={setThreadsTab}
      curatedThreads={[]}
      forYouSuggestions={[]}
      interactedHistory={[]}
      interactedRetainedHistory={[]}
      interactedTotal={total}
      interactedPage={page}
      onInteractedPageChange={onPage}
      skippedHistory={[]}
      dismissedHistory={[]}
      expiredHistory={[]}
      searching={false}
      actionBusy={false}
      expandedId={expandedId}
      setExpandedId={setExpandedId}
      interactedIds={new Set()}
      voice={null}
      agenda=""
      agendaReady
      deskBootReady
      authUser={null}
      dismissThread={null}
      setVoice={setVoice}
      actForYou={async () => false}
      onOpenVoice={vi.fn()}
      onOpenSettings={vi.fn()}
      onLinkX={vi.fn()}
      onSkip={vi.fn()}
      onDismiss={vi.fn()}
      onRefreshCoaching={vi.fn()}
      onHydrateInteracted={vi.fn()}
      onPollInteracted={vi.fn()}
    />
  );
}

test("uses roving focus and links keyboard-selected tabs to their panel", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const approach = screen.getByRole("tab", { name: /Approach/ });
  const interacted = screen.getByRole("tab", { name: /Interacted/ });
  expect(approach.tabIndex).toBe(0);
  expect(interacted.tabIndex).toBe(-1);
  for (const tab of screen.getAllByRole("tab")) {
    expect(
      document.getElementById(tab.getAttribute("aria-controls")!),
    ).toBeTruthy();
  }

  approach.focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(interacted);
  expect(interacted.getAttribute("aria-selected")).toBe("true");
  expect(interacted.tabIndex).toBe(0);
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    interacted.id,
  );
  expect(interacted.getAttribute("aria-controls")).toBe(
    screen.getByRole("tabpanel").id,
  );

  await user.keyboard("{End}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: /Expired/ }),
  );
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(approach);
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: /Expired/ }),
  );
});


test("uses stored count and previous/next controls for Interacted", async () => {
  const user = userEvent.setup();
  const onPage = vi.fn(async (_page: number) => {});
  render(<Harness total={215} page={2} onPage={onPage} />);
  await user.click(screen.getByRole("tab", { name: /Interacted/ }));
  expect(screen.getByRole("tab", { name: /Interacted/ }).textContent).toContain("215");
  expect(screen.queryByText(/No interacted threads yet/)).toBeNull();
  expect(screen.getByText("Page 2 of 22")).toBeTruthy();
  // The pager sits in the tab row, so scrolling the rows cannot hide it.
  const pager = screen.getByRole("navigation", { name: "Interacted pages" });
  expect(pager.closest(".threads-pane-head")).toBeTruthy();
  expect(pager.closest(".threads-scroll, .history-list")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  expect(onPage).toHaveBeenLastCalledWith(1);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(onPage).toHaveBeenLastCalledWith(3);
  await user.click(screen.getByRole("tab", { name: /Skipped/ }));
  expect(screen.queryByRole("navigation", { name: "Interacted pages" })).toBeNull();
});

test.each([0, 10])("hides pagination for %i stored rows", async (total) => {
  const user = userEvent.setup();
  render(<Harness total={total} />);
  await user.click(screen.getByRole("tab", { name: /Interacted/ }));
  expect(screen.queryByRole("navigation", { name: "Interacted pages" })).toBeNull();
  expect(Boolean(screen.queryByText(/No interacted threads yet/))).toBe(total === 0);
});
