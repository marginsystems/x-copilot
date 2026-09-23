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

function Harness() {
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
