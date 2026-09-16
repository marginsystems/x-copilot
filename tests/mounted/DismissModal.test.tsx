import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DismissModal } from "../../src/desk/DismissModal";

const thread = {
  id: "lead-1",
  author: "@example",
  text: "A test lead",
  url: "https://x.com/example/status/1",
};

test("typing a dismissal reason and confirming uses current state and respects busy", async () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  function Form({ busy }: { busy: boolean }) {
    const [reason, setReason] = useState("");
    return (
      <DismissModal
        thread={thread}
        reason={reason}
        busy={busy}
        setReason={setReason}
        onConfirm={() => onConfirm(reason)}
        onClose={onClose}
      />
    );
  }
  const user = userEvent.setup();
  const { rerender, unmount } = render(<Form busy={false} />);
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reason (optional)",
  });
  expect(document.activeElement).toBe(reason);
  await user.type(reason, "Outside my focus");
  expect(reason.value).toBe("Outside my focus");

  // Keyboard activation exercises the same handler as a pointer click.
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Confirm" }),
  );
  await user.keyboard("{Enter}");
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Outside my focus");

  rerender(<Form busy />);
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Cancel not interested" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  rerender(<Form busy={false} />);
  expect(reason.value).toBe("Outside my focus");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("traps focus, blocks busy Escape, and restores the opener", async () => {
  function Harness({ busy }: { busy: boolean }) {
    const [threadToDismiss, setThreadToDismiss] = useState<typeof thread | null>(
      null,
    );
    const [reason, setReason] = useState("");
    return (
      <>
        <button type="button" onClick={() => setThreadToDismiss(thread)}>
          Dismiss lead
        </button>
        <DismissModal
          thread={threadToDismiss}
          reason={reason}
          busy={busy}
          setReason={setReason}
          onConfirm={vi.fn()}
          onClose={() => setThreadToDismiss(null)}
        />
      </>
    );
  }

  const user = userEvent.setup();
  const { rerender } = render(<Harness busy={false} />);
  const opener = screen.getByRole("button", { name: "Dismiss lead" });
  await user.click(opener);

  const reason = screen.getByRole("textbox", { name: "Reason (optional)" });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(reason);

  await user.tab({ shift: true });
  expect(document.activeElement).toBe(cancel);
  await user.tab();
  expect(document.activeElement).toBe(reason);

  rerender(<Harness busy />);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();

  rerender(<Harness busy={false} />);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
