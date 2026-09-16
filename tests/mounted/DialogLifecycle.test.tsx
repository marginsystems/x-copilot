import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SignInModal } from "../../src/SignInModal";
import { MenuDrawer } from "../../src/chrome/MenuDrawer";

test("sign-in isolates the background, closes on Escape, and returns focus", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Sign in
        </button>
        <SignInModal
          open={open}
          onClose={() => setOpen(false)}
          onGoogle={vi.fn()}
          onX={vi.fn()}
        />
      </>
    );
  }

  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Sign in" });
  await user.click(opener);

  expect(opener.inert).toBe(true);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener.inert).not.toBe(true);
  expect(document.activeElement).toBe(opener);
});

test("menu drawer focuses its contents and handles Escape while entered", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open menu
        </button>
        {open ? (
          <MenuDrawer entered onClose={() => setOpen(false)}>
            <button type="button">Menu action</button>
          </MenuDrawer>
        ) : null}
      </>
    );
  }

  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open menu" });
  await user.click(opener);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Menu action" }),
  );
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(opener);
});
