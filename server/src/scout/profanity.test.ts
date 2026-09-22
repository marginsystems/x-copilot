import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textHasProfanity, threadHasProfanity } from "./profanity.ts";

await describe("textHasProfanity", async () => {
  await it("flags common swears on word boundaries and ignores clean text", () => {
    assert.equal(textHasProfanity("what the fuck is this deploy"), true);
    assert.equal(textHasProfanity("FUCK"), true);
    assert.equal(textHasProfanity("this is bullshit"), true);
    assert.equal(textHasProfanity("Ship the feature this week."), false);
    assert.equal(textHasProfanity("I like Shakespeare"), false);
  });

  await it("flags plural and comparative forms on word boundaries", () => {
    assert.equal(textHasProfanity("those fuckers over there"), true);
    assert.equal(textHasProfanity("the shitter is clogged"), true);
    assert.equal(textHasProfanity("shitters"), true);
    assert.equal(textHasProfanity("the shittiest code I've seen"), true);
    assert.equal(textHasProfanity("ship faster"), false);
  });
});

await describe("threadHasProfanity", async () => {
  await it("flags the candidate or the hydrated OP", () => {
    assert.equal(
      threadHasProfanity({ text: "clean reply", opText: "this is shit" }),
      true,
    );
    assert.equal(
      threadHasProfanity({ text: "clean reply", opText: "clean OP" }),
      false,
    );
  });
});
