import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  admitScoutPage,
  appendScoutTank,
  drainScoutReserve,
  reserveScoutCandidates,
  SCOUT_RESERVE_CAPACITY,
  SCOUT_TANK_CAPACITY,
} from "./scoutCollectReserve.ts";
import { card } from "./scoutCollect.testHelpers.ts";

describe("Scout survivor reserve", () => {
  it("reserves overflow instead of counting it as a rejection", () => {
    const reserve = [];
    const bucket = [];
    const acceptedIds = new Set<string>();
    const result = admitScoutPage({
      candidates: [
        card({ id: "keep-1", author: "@a" }),
        card({ id: "keep-2", author: "@b" }),
        card({ id: "spare-1", author: "@c" }),
        card({ id: "spare-2", author: "@d" }),
      ],
      reserve,
      bucket,
      bucketSize: 2,
      seenAuthors: new Set(),
      acceptedIds,
    });

    assert.deepEqual(bucket.map((thread) => thread.id), ["keep-1", "keep-2"]);
    assert.deepEqual(reserve.map((thread) => thread.id), ["spare-1", "spare-2"]);
    assert.equal(result.added, 2);
    assert.equal(result.reserved, 2);
    assert.equal(result.authorDedupe, 0);
  });

  it("keeps a bounded FIFO and drops the oldest overflow", () => {
    const reserve = [];
    const candidates = Array.from(
      { length: SCOUT_RESERVE_CAPACITY + 2 },
      (_, index) => card({ id: `t${index + 1}`, author: `@u${index + 1}` }),
    );

    assert.equal(reserveScoutCandidates(reserve, candidates), candidates.length);
    assert.equal(reserve.length, SCOUT_RESERVE_CAPACITY);
    assert.equal(reserve[0]?.id, "t3");
    assert.equal(reserve.at(-1)?.id, `t${SCOUT_RESERVE_CAPACITY + 2}`);
  });

  it("drains oldest eligible survivors into the next bucket", () => {
    const reserve = [
      card({ id: "blocked", author: "@blocked" }),
      card({ id: "duplicate-author", author: "@seen" }),
      card({ id: "first", author: "@first" }),
      card({ id: "second", author: "@second" }),
    ];
    const bucket = [];
    const acceptedIds = new Set<string>();

    const result = drainScoutReserve({
      reserve,
      bucket,
      bucketSize: 2,
      seenAuthors: new Set(["seen"]),
      acceptedIds,
      blockedConversations: new Set(["blocked"]),
    });

    assert.deepEqual(bucket.map((thread) => thread.id), ["first", "second"]);
    assert.deepEqual([...acceptedIds], ["first", "second"]);
    assert.equal(result.added, 2);
    assert.equal(result.authorDedupe, 1);
    assert.equal(result.blocked, 1);
  });
});

describe("Scout qualified tank", () => {
  it("keeps qualified extras up to tank capacity", () => {
    const tank = [];
    const candidates = Array.from(
      { length: SCOUT_TANK_CAPACITY + 3 },
      (_, index) => card({ id: `t${index + 1}`, author: `@u${index + 1}` }),
    );

    const added = appendScoutTank({
      tank,
      candidates,
      tankIds: new Set(),
      tankAuthors: new Set(),
    });

    assert.equal(added, SCOUT_TANK_CAPACITY);
    assert.equal(tank.length, SCOUT_TANK_CAPACITY);
    assert.equal(tank.at(-1)?.id, `t${SCOUT_TANK_CAPACITY}`);
  });
});
