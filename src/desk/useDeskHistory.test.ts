import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AppSettings } from "../lib/settings.ts";
import type { ThreadCard } from "./types.ts";
import { keepCuratedByHistory, useDeskHistory } from "./useDeskHistory.ts";

describe("keepCuratedByHistory", () => {
  it("hides consumed ids", () => {
    const hidden = new Set(["used"]);
    assert.equal(
      keepCuratedByHistory(
        { id: "used" },
        (id) => hidden.has(id),
        new Set(),
      ),
      false,
    );
    assert.equal(
      keepCuratedByHistory(
        { id: "fresh" },
        (id) => hidden.has(id),
        new Set(),
      ),
      true,
    );
  });

  it("keeps the active locked card while history hydrates", () => {
    assert.equal(
      keepCuratedByHistory(
        { id: "locked" },
        (id) => id === "locked",
        new Set(["locked"]),
        "locked",
      ),
      true,
    );
  });

  it("does not let a preserved card bypass history blocking", () => {
    assert.equal(
      keepCuratedByHistory(
        { id: "other", conversationId: "locked" },
        () => false,
        new Set(["locked"]),
        "locked",
      ),
      false,
    );
  });

  it("hides blocked conversations and parents", () => {
    const blocked = new Set(["root", "parent"]);
    assert.equal(
      keepCuratedByHistory(
        { id: "reply-1", conversationId: "root" },
        () => false,
        blocked,
      ),
      false,
    );
    assert.equal(
      keepCuratedByHistory(
        { id: "reply-2", inReplyToId: "parent" },
        () => false,
        blocked,
      ),
      false,
    );
  });

  it("does not inspect settings-shaped thread fields", () => {
    const parked = {
      id: "parked",
      views: 1,
      flags: ["political"],
      author: "@excluded",
    };
    assert.equal(
      keepCuratedByHistory(parked, () => false, new Set()),
      true,
    );
  });

  it("filters the released card synchronously when the lock moves", () => {
    let threads = [
      { id: "A" } as ThreadCard,
      { id: "B" } as ThreadCard,
    ];
    const pending = new Promise<Response>(() => {});
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() => pending) as typeof fetch;

    try {
      let history!: ReturnType<typeof useDeskHistory>;
      function Harness() {
        history = useDeskHistory({
          setThreads: (update) => {
            threads =
              typeof update === "function" ? update(threads) : update;
          },
          setStatus: () => {},
          setActionBusy: () => {},
          settings: {} as AppSettings,
        });
        return null;
      }

      renderToString(createElement(Harness));
      void history.hydrateInteracted("A");
      void history.hydrateInteracted("B");

      assert.deepEqual(
        threads.map((thread) => thread.id),
        ["B"],
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
