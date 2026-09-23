import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useDeskRowExit } from "../../src/desk/useDeskRowExit";
import { DESK_ROW_EXPAND_MS } from "../../src/lib/deskRow";
import { deferred } from "./support/deferred";

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches, media: query })),
  );
}

test("delayed exit fires once after the expand delay and ignores a repeat click", () => {
  vi.useFakeTimers();
  const then = vi.fn();
  const { result } = renderHook(() => useDeskRowExit(), { wrapper: StrictMode });

  act(() => {
    result.current.beginExit("row-1", then);
    result.current.beginExit("row-1", then);
  });
  expect(result.current.exitingIds).toEqual(new Set(["row-1"]));
  expect(vi.getTimerCount()).toBe(1);

  act(() => {
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS - 1);
  });
  expect(then).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(then).toHaveBeenCalledTimes(1);
  expect(result.current.exitingIds).toEqual(new Set());
  expect(vi.getTimerCount()).toBe(0);

  // The guard is released once the action settles, so the id can exit again.
  act(() => {
    result.current.beginExit("row-1", then);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(then).toHaveBeenCalledTimes(2);
});

test("an id stays a no-op while its async action is still pending", async () => {
  vi.useFakeTimers();
  const action = deferred<void>();
  const then = vi.fn(() => action.promise);
  const { result } = renderHook(() => useDeskRowExit(), { wrapper: StrictMode });

  act(() => {
    result.current.beginExit("row-1", then);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(then).toHaveBeenCalledTimes(1);
  expect(result.current.exitingIds).toEqual(new Set(["row-1"]));

  act(() => {
    result.current.beginExit("row-1", then);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(then).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);

  await act(async () => {
    action.resolve();
    await action.promise;
  });
  expect(result.current.exitingIds).toEqual(new Set());
});

test("unmount cancels scheduled actions and ignores in-flight settlement", async () => {
  vi.useFakeTimers();
  const scheduled = vi.fn();
  const inFlight = deferred<void>();
  const started = vi.fn(() => inFlight.promise);
  const { result, unmount } = renderHook(() => useDeskRowExit(), {
    wrapper: StrictMode,
  });

  act(() => {
    result.current.beginExit("in-flight", started);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
    result.current.beginExit("scheduled-a", scheduled);
    result.current.beginExit("scheduled-b", scheduled);
  });
  expect(started).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(2);

  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS * 2);
  });
  expect(scheduled).not.toHaveBeenCalled();

  await act(async () => {
    inFlight.resolve();
    await inFlight.promise;
  });
});

test("a rejected action releases the per-id guard", async () => {
  vi.useFakeTimers();
  const failing = deferred<void>();
  const then = vi.fn(() => failing.promise);
  const { result } = renderHook(() => useDeskRowExit(), { wrapper: StrictMode });

  act(() => {
    result.current.beginExit("row-1", then);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(then).toHaveBeenCalledTimes(1);
  expect(result.current.exitingIds).toEqual(new Set(["row-1"]));

  await act(async () => {
    failing.reject(new Error("network"));
    await failing.promise.catch(() => {});
  });
  expect(result.current.exitingIds).toEqual(new Set());

  act(() => {
    result.current.beginExit("row-1", then);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(then).toHaveBeenCalledTimes(2);
  await act(async () => {
    failing.reject(new Error("network"));
    await failing.promise.catch(() => {});
  });
});

test("reduced motion fires immediately and a sync throw still releases the guard", () => {
  vi.useFakeTimers();
  stubReducedMotion(true);
  const immediate = vi.fn();
  const throwing = vi.fn(() => {
    throw new Error("boom");
  });
  const { result } = renderHook(() => useDeskRowExit(), { wrapper: StrictMode });

  act(() => {
    result.current.beginExit("row-1", immediate);
  });
  expect(immediate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(result.current.exitingIds).toEqual(new Set());

  expect(() =>
    act(() => {
      result.current.beginExit("row-2", throwing);
    }),
  ).toThrow("boom");
  expect(throwing).toHaveBeenCalledTimes(1);
  expect(result.current.exitingIds).toEqual(new Set());

  act(() => {
    result.current.beginExit("row-2", immediate);
  });
  expect(immediate).toHaveBeenCalledTimes(2);
});

test("a sync throw on the delayed path releases the guard too", () => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  const throwing = vi.fn(() => {
    throw new Error("boom");
  });
  const recovered = vi.fn();
  const { result } = renderHook(() => useDeskRowExit(), { wrapper: StrictMode });

  act(() => {
    result.current.beginExit("row-1", throwing);
  });
  expect(result.current.exitingIds).toEqual(new Set(["row-1"]));
  expect(() =>
    act(() => {
      vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
    }),
  ).toThrow("boom");
  // act() rethrows before flushing the update queued by revert(); flush it.
  act(() => {});
  expect(result.current.exitingIds).toEqual(new Set());
  expect(vi.getTimerCount()).toBe(0);

  act(() => {
    result.current.beginExit("row-1", recovered);
    vi.advanceTimersByTime(DESK_ROW_EXPAND_MS);
  });
  expect(recovered).toHaveBeenCalledTimes(1);
});
