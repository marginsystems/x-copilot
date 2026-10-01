import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adoptRest,
  BUBBLE_COMPACT_MEMBERS,
  BUBBLE_ENTER_SCALE,
  BUBBLE_MAX_MEMBERS,
  bubbleGap,
  containScale,
  isStill,
  memberLimit,
  morphPose,
  planMorph,
  bubbleMinRadius,
  bubbleRadii,
  hitBody,
  overlapDepth,
  packBubbles,
  rescaleBodies,
  shouldRepack,
  settleSteps,
  snapToHome,
  stepBodies,
} from "./bubbleLayout.ts";

const BOXES = [
  { width: 222, height: 278 },
  { width: 148, height: 278 },
  { width: 120, height: 150 },
  { width: 640, height: 270 },
];

function scores(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.max(1, 30 - i * 2 - Math.floor(i / 3)));
}

await describe("bubbleLayout", () => {
  it("scales radii with the square root of the score between the min and max radius", () => {
    const box = BOXES[0]!;
    const { members, self } = bubbleRadii([100, 25, 4, 1], box);
    const min = bubbleMinRadius(box);
    assert.ok(members[0]! > members[1]! && members[1]! > members[2]! && members[2]! > members[3]!);
    const rMax = members[0]!;
    assert.ok(Math.abs((members[1]! - min) / (rMax - min) - 0.5) < 1e-9);
    assert.ok(Math.abs((members[2]! - min) / (rMax - min) - 0.2) < 1e-9);
    assert.ok(members.every((r) => r >= min));
    assert.ok(self > rMax);
  }).catch(assert.fail);

  it("places the self bubble at the center and ranks closer to the middle", () => {
    let near = 0;
    let far = 0;
    for (const box of BOXES) {
      const bodies = packBubbles(scores(12), box);
      assert.equal(bodies.length, 13);
      assert.equal(bodies[0]!.self, true);
      assert.ok(Math.abs(bodies[0]!.x - box.width / 2) < 1);
      assert.ok(Math.abs(bodies[0]!.y - box.height / 2) < 1);
      const dist = (i: number) =>
        Math.hypot(bodies[i]!.x - box.width / 2, bodies[i]!.y - box.height / 2) - bodies[i]!.r;
      near += [1, 2, 3].reduce((s, i) => s + dist(i), 0);
      far += [10, 11, 12].reduce((s, i) => s + dist(i), 0);
    }
    assert.ok(near < far);
  }).catch(assert.fail);

  it("packs without overlaps and inside the box for every size", () => {
    for (const box of BOXES) {
      for (const n of [3, 10, 25, 64]) {
        const bodies = packBubbles(scores(n), box);
        assert.equal(bodies.length, Math.min(n, BUBBLE_MAX_MEMBERS) + 1);
        assert.ok(overlapDepth(bodies) < 0.6, `${box.width}x${box.height} n=${n}`);
        for (const b of bodies) {
          assert.ok(b.x - b.r >= -0.01 && b.x + b.r <= box.width + 0.01);
          assert.ok(b.y - b.r >= -0.01 && b.y + b.r <= box.height + 0.01);
        }
      }
    }
  }).catch(assert.fail);

  it("is deterministic and starts at rest", () => {
    const a = packBubbles(scores(14), BOXES[0]!);
    const b = packBubbles(scores(14), BOXES[0]!);
    assert.deepEqual(a, b);
    assert.ok(a.every((body) => body.vx === 0 && body.vy === 0));
    assert.ok(a.every((body) => body.x === body.hx && body.y === body.hy && body.r === body.tr));
  }).catch(assert.fail);

  it("stays at rest when stepped from the precomputed layout", () => {
    const box = BOXES[0]!;
    const bodies = packBubbles(scores(14), box);
    const before = bodies.map((b) => [b.x, b.y]);
    for (let i = 0; i < 30; i++) stepBodies(bodies, box);
    bodies.forEach((b, i) => {
      assert.ok(Math.hypot(b.x - before[i]![0]!, b.y - before[i]![1]!) < 0.3);
    });
  }).catch(assert.fail);

  it("pushes neighbours away from a dragged bubble and settles to a packed rest after release", () => {
    const box = BOXES[0]!;
    const bodies = packBubbles(scores(14), box);
    const grabbed = 5;
    const pointer = { x: bodies[1]!.x, y: bodies[1]!.y + 2 };
    bodies[grabbed]!.x = pointer.x;
    bodies[grabbed]!.y = pointer.y;
    for (let i = 0; i < 20; i++) stepBodies(bodies, box, { dragged: grabbed });
    const moved = bodies.filter((b, i) => i !== grabbed && Math.hypot(b.x - b.hx, b.y - b.hy) > 2);
    assert.ok(moved.length > 0);
    assert.equal(bodies[grabbed]!.x, pointer.x);
    const steps = settleSteps(bodies, box, 600);
    assert.ok(steps < 600);
    assert.ok(overlapDepth(bodies) < 0.6);
    adoptRest(bodies);
    assert.ok(bodies.every((b) => b.x === b.hx && b.y === b.hy));
    assert.ok(settleSteps(bodies, box, 50) < 50);
  }).catch(assert.fail);

  it("hits the topmost bubble under a point and nothing in empty space", () => {
    const bodies = packBubbles(scores(6), BOXES[0]!);
    const target = bodies[2]!;
    assert.equal(hitBody(bodies, target.x, target.y), 2);
    assert.equal(hitBody(bodies, -50, -50), -1);
  }).catch(assert.fail);

  it("repacks only when the aspect ratio changes a lot", () => {
    assert.equal(shouldRepack({ width: 222, height: 278 }, { width: 240, height: 300 }), false);
    assert.equal(shouldRepack({ width: 222, height: 278 }, { width: 148, height: 278 }), true);
    assert.equal(shouldRepack({ width: 222, height: 278 }, { width: 640, height: 270 }), true);
    assert.equal(shouldRepack({ width: 0, height: 0 }, { width: 222, height: 278 }), true);
  }).catch(assert.fail);

  it("rescales homes and radii without overlaps or a new solve", () => {
    const from = { width: 222, height: 278 };
    const to = { width: 240, height: 300 };
    const bodies = packBubbles(scores(14), from);
    rescaleBodies(bodies, from, to);
    snapToHome(bodies);
    assert.ok(overlapDepth(bodies) < 0.6);
    for (const b of bodies) {
      assert.ok(b.x - b.r >= -0.6 && b.x + b.r <= to.width + 0.6);
      assert.ok(b.y - b.r >= -0.6 && b.y + b.r <= to.height + 0.6);
    }
  }).catch(assert.fail);

  it("shows fewer people when compact than when expanded", () => {
    assert.equal(memberLimit(false), BUBBLE_COMPACT_MEMBERS);
    assert.equal(memberLimit(true), BUBBLE_MAX_MEMBERS);
    assert.ok(BUBBLE_COMPACT_MEMBERS >= 18 && BUBBLE_COMPACT_MEMBERS <= 24);
    assert.ok(BUBBLE_COMPACT_MEMBERS < BUBBLE_MAX_MEMBERS);
  }).catch(assert.fail);

  it("leaves a visible gap between every pair of bubbles", () => {
    for (const box of BOXES) {
      const gap = bubbleGap(box);
      assert.ok(gap >= 2.5);
      const bodies = packBubbles(scores(BUBBLE_COMPACT_MEMBERS), box);
      let tightest = Infinity;
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]!;
          const b = bodies[j]!;
          tightest = Math.min(tightest, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
        }
      }
      assert.ok(tightest >= gap - 0.6, `${box.width}x${box.height} tightest ${tightest}`);
    }
  }).catch(assert.fail);

  it("makes the compact self bubble the largest and the cluster fill the box", () => {
    const box = BOXES[0]!;
    const bodies = packBubbles(scores(BUBBLE_COMPACT_MEMBERS), box);
    const biggest = Math.max(...bodies.slice(1).map((b) => b.r));
    assert.ok(bodies[0]!.r >= biggest * 1.3);
    const left = Math.min(...bodies.map((b) => b.x - b.r));
    const right = Math.max(...bodies.map((b) => b.x + b.r));
    const top = Math.min(...bodies.map((b) => b.y - b.r));
    const bottom = Math.max(...bodies.map((b) => b.y + b.r));
    assert.ok((right - left) / box.width > 0.85);
    assert.ok((bottom - top) / box.height > 0.8);
  }).catch(assert.fail);

  it("morphs matched people from their old pose, fades arrivals in and leavers out", () => {
    const small = { width: 222, height: 278 };
    const wide = { width: 525, height: 232 };
    const from = [
      { key: "self", pose: { x: 111, y: 139, r: 30, a: 1 } },
      { key: "a", pose: { x: 60, y: 80, r: 20, a: 1 } },
      { key: "gone", pose: { x: 150, y: 200, r: 15, a: 1 } },
    ];
    const to = [
      { key: "self", pose: { x: 262, y: 116, r: 36, a: 1 } },
      { key: "a", pose: { x: 200, y: 90, r: 25, a: 1 } },
      { key: "new", pose: { x: 400, y: 120, r: 18, a: 1 } },
    ];
    const entries = planMorph(from, small, to, wide);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    assert.equal(entries.length, 4);
    const k = containScale(small, wide);
    assert.ok(k < 1);
    assert.deepEqual(morphPose(byKey.get("self")!, 0), {
      x: 262.5,
      y: 116,
      r: 30 * k,
      a: 1,
    });
    assert.deepEqual(morphPose(byKey.get("a")!, 1), to[1]!.pose);
    const arriving = byKey.get("new")!;
    assert.equal(morphPose(arriving, 0).a, 0);
    assert.equal(morphPose(arriving, 0).r, 18 * BUBBLE_ENTER_SCALE);
    assert.deepEqual(morphPose(arriving, 1), to[2]!.pose);
    const leaving = byKey.get("gone")!;
    assert.equal(morphPose(leaving, 0).a, 1);
    assert.equal(morphPose(leaving, 1).a, 0);
    assert.ok(morphPose(leaving, 1).r < morphPose(leaving, 0).r);
    const mid = morphPose(byKey.get("a")!, 0.5);
    const start = byKey.get("a")!.from.x;
    assert.ok(mid.x > Math.min(start, 200) && mid.x < Math.max(start, 200));
    for (const e of entries) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = morphPose(e, t);
        assert.ok(p.a >= 0 && p.a <= 1 && p.r > 0);
      }
    }
  }).catch(assert.fail);

  it("keeps a contained start inside the new box and detects a no-op morph", () => {
    const big = { width: 525, height: 232 };
    const small = { width: 222, height: 278 };
    const from = packBubbles(scores(20), big).map((b, i) => ({
      key: String(i),
      pose: { x: b.x, y: b.y, r: b.r, a: 1 },
    }));
    for (const e of planMorph(from, big, from, small)) {
      assert.ok(e.from.x - e.from.r >= -0.01 && e.from.x + e.from.r <= small.width + 0.01);
      assert.ok(e.from.y - e.from.r >= -0.01 && e.from.y + e.from.r <= small.height + 0.01);
    }
    assert.equal(containScale(small, small), 1);
    assert.equal(isStill(planMorph(from, big, from, big)), true);
    assert.equal(isStill(planMorph(from, big, from.slice(1), big)), false);
  }).catch(assert.fail);
});
