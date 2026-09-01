import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyDeskBeats } from "./deskPhase.ts";
import {
  onOriginalPosted,
  onReplyMarked,
  setForkChoice,
} from "./deskBeats.ts";

describe("desk beat transitions", () => {
  it("unlocks scout, organic, then the fork in order", () => {
    const empty = emptyDeskBeats();
    const scout = onReplyMarked(empty, "scout");
    const organic = onReplyMarked(scout, "organic");

    assert.deepEqual(scout, { ...empty, scoutReplyDone: true });
    assert.deepEqual(organic, {
      ...empty,
      scoutReplyDone: true,
      organicReplyDone: true,
    });
  });

  it("completes a reply fork once and ignores extra marks", () => {
    let beats = onReplyMarked(
      onReplyMarked(emptyDeskBeats(), "scout"),
      "organic",
    );
    beats = setForkChoice(beats, "reply");
    beats = onReplyMarked(beats, "organic");

    assert.equal(beats.forkDone, true);
    assert.strictEqual(onReplyMarked(beats, "organic"), beats);
  });

  it("completes an original fork without letting early originals skip beats", () => {
    const empty = emptyDeskBeats();
    assert.strictEqual(onOriginalPosted(empty), empty);

    let beats = onReplyMarked(
      onReplyMarked(empty, "scout"),
      "organic",
    );
    beats = setForkChoice(beats, "original");
    beats = onOriginalPosted(beats);
    assert.equal(beats.forkDone, true);
  });

  it("rejects a fork choice before organic is complete", () => {
    const scout = onReplyMarked(emptyDeskBeats(), "scout");
    assert.strictEqual(setForkChoice(scout, "reply"), scout);
  });

  it("does not let organic marks consume the scout beat", () => {
    const empty = emptyDeskBeats();
    assert.deepEqual(onReplyMarked(empty, "organic"), empty);
  });
});
