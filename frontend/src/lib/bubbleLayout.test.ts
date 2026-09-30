import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adoptRest,
  BUBBLE_MAX_MEMBERS,
  bubbleMinRadius,
  bubbleRadii,
  hitBody,
  overlapDepth,
  packBubbles,
  rescaleBodies,
  retargetBodies,
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

  it("eases toward new radii and homes after a resize and then settles", () => {
    const from = BOXES[0]!;
    const to = BOXES[3]!;
    const s = scores(14);
    const bodies = retargetBodies(packBubbles(s, from), s, from, to);
    assert.ok(bodies[0]!.tr !== bodies[0]!.r);
    const steps = settleSteps(bodies, to, 600);
    assert.ok(steps < 600);
    assert.ok(overlapDepth(bodies) < 0.6);
  }).catch(assert.fail);

  it("snaps straight to rest positions when asked", () => {
    const from = BOXES[0]!;
    const to = BOXES[3]!;
    const s = scores(8);
    const bodies = retargetBodies(packBubbles(s, from), s, from, to);
    snapToHome(bodies);
    assert.ok(bodies.every((b) => b.x === b.hx && b.r === b.tr));
    assert.ok(overlapDepth(bodies) < 0.6);
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
});
