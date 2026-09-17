import { SessionBoundary } from "../../src/auth/session";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useBilling } from "../../src/billing/useBilling";
import { deferred } from "./support/deferred";

test("UTC-day effect survives rerenders and cancels its next refresh on unmount", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T23:59:59.000Z"));
  const response = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
  vi.stubGlobal("fetch", fetchMock);
  const onUtcDay = vi.fn();
  const { result, rerender, unmount } = renderHook(
    () => useBilling({ onUtcDay }),
    { wrapper: ({ children }) => <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode> },
  );

  // StrictMode's mount/cleanup/remount must leave exactly one live timer.
  expect(vi.getTimerCount()).toBe(1);
  rerender();
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1499);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "http://localhost:8787/api/billing/me",
    { credentials: "include" },
  );
  expect(onUtcDay).toHaveBeenCalledTimes(1);
  expect(result.current.billing).toBeNull();

  const billing = {
    ok: true,
    plan_key: "free",
    credits: { used: 0, limit: 1500, remaining: 1500, can_use: true },
  };
  await act(async () => {
    response.resolve(new Response(JSON.stringify(billing)));
    await response.promise;
  });
  expect(result.current.billing).toEqual(billing);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(86_400_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onUtcDay).toHaveBeenCalledTimes(1);
});
