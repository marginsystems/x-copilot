import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_TOP_OPEN_KEY,
  deskTopDefaultOpen,
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

await describe("deskLayout", () => {
  it("uses the viewport default when nothing is stored", () => {
    assert.equal(readDeskTopOpen(memoryStore(), false), false);
    assert.equal(readDeskTopOpen(memoryStore(), true), true);
    assert.equal(readDeskTopOpen(null, true), true);
    assert.equal(readDeskTopOpen(null, false), false);
  }).catch(assert.fail);

  it("a stored preference wins over the viewport default", () => {
    assert.equal(readDeskTopOpen(memoryStore({ [DESK_TOP_OPEN_KEY]: "0" }), true), false);
    assert.equal(readDeskTopOpen(memoryStore({ [DESK_TOP_OPEN_KEY]: "1" }), false), true);
  }).catch(assert.fail);

  it("defaults collapsed without a browser window", () => {
    assert.equal(deskTopDefaultOpen(), false);
  }).catch(assert.fail);

  it("reads and writes the expand preference", () => {
    const store = memoryStore();
    assert.equal(writeDeskTopOpen(true, store), true);
    assert.equal(store.getItem(DESK_TOP_OPEN_KEY), "1");
    assert.equal(readDeskTopOpen(store), true);
    writeDeskTopOpen(false, store);
    assert.equal(readDeskTopOpen(store), false);
  }).catch(assert.fail);
});
