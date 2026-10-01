import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ExtensionConnect } from "../../src/ExtensionConnect";
import {
  EXTENSION_HELLO,
  EXTENSION_PAIR,
  EXTENSION_PAIR_ACK_MS,
  EXTENSION_PAIRED,
  EXTENSION_PING,
  parseExtensionPair,
} from "../../../shared/src/extensionBridge";

const EXPIRES = "2026-11-01T00:00:00.000Z";

function fromPage(data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: window }));
  });
}

function capturePosts() {
  const posts: unknown[] = [];
  const spy = vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    posts.push(message);
  });
  return { posts, spy };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("asks the extension to announce itself and offers install help until it does", () => {
  const { posts } = capturePosts();
  render(<ExtensionConnect />);
  expect(posts).toContainEqual({ type: EXTENSION_PING });
  expect(screen.getByText(/Install the X Copilot extension/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("ignores hello messages from another origin", () => {
  capturePosts();
  render(<ExtensionConnect />);
  fromPage({ type: EXTENSION_HELLO, version: "0.1.0", paired: false }, "https://evil.example");
  expect(screen.queryByRole("button")).toBeNull();
});

test("mints a token, hands it to the extension on this origin, and shows the ack", async () => {
  const { posts, spy } = capturePosts();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, token: "ext-token", expiresAt: EXPIRES }, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ExtensionConnect />);
  fromPage({ type: EXTENSION_HELLO, version: "0.1.0", paired: false });
  expect(screen.getByText("Extension found (v0.1.0). Connect it to this account.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Connect extension" }));
  await vi.waitFor(() => expect(posts.some((m) => parseExtensionPair(m))).toBe(true));
  expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/auth\/extension-session$/);
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "include" });
  const pair = posts.map(parseExtensionPair).find(Boolean);
  expect(pair).toMatchObject({ type: EXTENSION_PAIR, token: "ext-token", expiresAt: EXPIRES });
  const pairCall = spy.mock.calls.find(([message]) => parseExtensionPair(message));
  expect(pairCall?.[1]).toBe(window.location.origin);

  fromPage({ type: EXTENSION_PAIRED, ok: true });
  expect(await screen.findByText("Connected. The side panel on x.com uses this account.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
});

test("reports a missing ack after the timeout", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  capturePosts();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, token: "t", expiresAt: EXPIRES }, { status: 201 })));
  render(<ExtensionConnect />);
  fromPage({ type: EXTENSION_HELLO, version: "0.1.0", paired: false });
  fireEvent.click(screen.getByRole("button", { name: "Connect extension" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(EXTENSION_PAIR_ACK_MS + 1); });
  expect(await screen.findByText("The extension did not answer. Reload this page and try again.")).toBeTruthy();
});

test("reports a refused pairing request without posting a token", async () => {
  const { posts } = capturePosts();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "rate_limited" }, { status: 429 })));
  render(<ExtensionConnect />);
  fromPage({ type: EXTENSION_HELLO, version: "0.1.0", paired: true });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(await screen.findByText("Could not create an extension sign-in (429).")).toBeTruthy();
  expect(posts.some((m) => parseExtensionPair(m))).toBe(false);
});
