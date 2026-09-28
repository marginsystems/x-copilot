import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { lazyRoute } from "../../src/routing/lazyRoute";
import { deferred } from "./support/deferred";

test("a failed chunk shows recovery and retry loads the page with its props", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const pending = deferred<{ default: (props: { label: string }) => JSX.Element }>();
  const load = vi.fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue({ default: ({ label }: { label: string }) => <h1>{label}</h1> });
  const Page = lazyRoute<(props: { label: string }) => JSX.Element>(load);
  const first = render(<Page label="Recovered page" />);
  expect(screen.getByRole("status").textContent).toBe("Loading page…");
  await act(async () => { pending.reject(new Error("Chunk unavailable")); });
  expect(screen.getByRole("alert").textContent).toBe("This page could not be loaded.");
  expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Recovered page" })).toBeTruthy();
  first.unmount();
  render(<Page label="Return visit" />);
  expect(await screen.findByRole("heading", { name: "Return visit" })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

test("preload starts the chunk once and the mounted page reuses it", async () => {
  const pending = deferred<{ default: (props: { label: string }) => JSX.Element }>();
  const load = vi.fn(() => pending.promise);
  const Page = lazyRoute<(props: { label: string }) => JSX.Element>(load);
  Page.preload();
  Page.preload();
  expect(load).toHaveBeenCalledTimes(1);
  render(<Page label="Preloaded page" />);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ default: ({ label }) => <h1>{label}</h1> }); });
  expect(await screen.findByRole("heading", { name: "Preloaded page" })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
});

test("a failed preload does not poison the page, which loads again on render", async () => {
  const failed = deferred<{ default: (props: { label: string }) => JSX.Element }>();
  const load = vi.fn()
    .mockImplementationOnce(() => failed.promise)
    .mockResolvedValue({ default: ({ label }: { label: string }) => <h1>{label}</h1> });
  const Page = lazyRoute<(props: { label: string }) => JSX.Element>(load);
  Page.preload();
  await act(async () => { failed.reject(new Error("Chunk unavailable")); });
  render(<Page label="After failed preload" />);
  expect(await screen.findByRole("heading", { name: "After failed preload" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});
