import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textHasProfanity, threadHasProfanity } from "./profanity.ts";

describe("textHasProfanity", () => {
  it("flags common swears on word boundaries and ignores clean text", () => {
    assert.equal(textHasProfanity("what the fuck is this deploy"), true);
    assert.equal(textHasProfanity("FUCK"), true);
    assert.equal(textHasProfanity("this is bullshit"), true);
    assert.equal(textHasProfanity("Ship the feature this week."), false);
    assert.equal(textHasProfanity("I like Shakespeare"), false);
  });
});

describe("threadHasProfanity", () => {
  it("flags the candidate or the hydrated OP", () => {
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
