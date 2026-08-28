import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_TOP_OPEN_KEY,
  readDeskTopOpen,
  writeDeskTopOpen,
} from "./deskLayout.ts";

function memoryStore(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("deskLayout", () => {
  it("defaults collapsed when nothing is stored", () => {
    assert.equal(readDeskTopOpen(memoryStore()), false);
    assert.equal(readDeskTopOpen(null), false);
  });

  it("reads and writes the expand preference", () => {
    const store = memoryStore();
    assert.equal(writeDeskTopOpen(true, store), true);
    assert.equal(store.getItem(DESK_TOP_OPEN_KEY), "1");
    assert.equal(readDeskTopOpen(store), true);
    writeDeskTopOpen(false, store);
    assert.equal(readDeskTopOpen(store), false);
  });
});
