import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  expect(opener.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close" }),
  );
  const close = screen.getByRole("button", { name: "Close" });
  const last = screen.getByRole("button", { name: "Continue with X" });
  last.focus();
  await user.tab();
  expect(document.activeElement).toBe(close);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener.inert).not.toBe(true);
  expect(opener.getAttribute("aria-hidden")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("overlapping menu and sign-in restore isolation only after the last dialog closes", async () => {
  function Harness() {
    const [menu, setMenu] = useState(false);
    const [signIn, setSignIn] = useState(false);
    return (
      <>
        <button type="button">Page action</button>
        <button type="button" onClick={() => setMenu(true)}>
          Open menu
        </button>
        {menu ? (
          <MenuDrawer entered onClose={() => setMenu(false)}>
            <button
              type="button"
              onClick={() => {
                setSignIn(true);
                window.setTimeout(() => setMenu(false), 0);
              }}
            >
              Sign in
            </button>
          </MenuDrawer>
        ) : null}
        <SignInModal
          open={signIn}
          onClose={() => setSignIn(false)}
          onGoogle={vi.fn()}
          onX={vi.fn()}
        />
      </>
    );
  }

  const user = userEvent.setup();
  render(<Harness />);
  const page = screen.getByRole("button", { name: "Page action" });
  const opener = screen.getByRole("button", { name: "Open menu" });
  await user.click(opener);
  expect(page.inert).toBe(true);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("dialog", { name: "Sign in to your desk" })).toBeTruthy();
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "User menu" })).toBeNull();
  });
  expect(page.inert).toBe(true);
  expect(page.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(page.inert).not.toBe(true);
  expect(page.getAttribute("aria-hidden")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("Escape dismisses only the topmost overlapping dialog", async () => {
  function Harness() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOuter(true)}>
          Open outer
        </button>
        <SignInModal
          open={outer}
          onClose={() => setOuter(false)}
          onGoogle={() => setInner(true)}
          onX={() => setInner(true)}
        />
        {inner ? (
          <MenuDrawer entered onClose={() => setInner(false)}>
            <button type="button">Inner action</button>
          </MenuDrawer>
        ) : null}
      </>
    );
  }

  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open outer" }));
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(screen.getByRole("dialog", { name: "User menu" })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "User menu" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Sign in to your desk" })).toBeTruthy();
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

test("menu drawer keeps its header close toggle interactive", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <header>
          <button type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "Close menu" : "Open menu"}
          </button>
        </header>
        {open ? (
          <MenuDrawer entered onClose={() => setOpen(false)}>
            <button type="button">Menu action</button>
          </MenuDrawer>
        ) : null}
      </div>
    );
  }

  const user = userEvent.setup();
  render(<Harness />);
  const toggle = screen.getByRole("button", { name: "Open menu" });
  await user.click(toggle);

  expect(toggle.inert).not.toBe(true);
  expect(toggle.closest("header")?.inert).not.toBe(true);
  await user.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: "Close menu",
    }),
  );
  expect(screen.queryByRole("dialog", { name: "User menu" })).toBeNull();
});
