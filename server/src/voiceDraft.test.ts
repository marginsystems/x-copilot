import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftHasAiTropes,
  postNeedsStance,
  sanitizeSuggestedDraft,
  stripEmDashes,
} from "./voiceDraft.ts";

describe("stripEmDashes", () => {
  it("turns an em dash clause into a period", () => {
    assert.equal(
      stripEmDashes("The tool was never the bottleneck \u2014 the loop is."),
      "The tool was never the bottleneck. the loop is.",
    );
  });

  it("leaves clean text alone", () => {
    assert.equal(stripEmDashes("Ship it and ask what broke."), "Ship it and ask what broke.");
  });
});

describe("draftHasAiTropes", () => {
  it("flags if-this-then-that", () => {
    assert.equal(
      draftHasAiTropes("If you want speed, then you have to cut process."),
      true,
    );
  });

  it("flags this-isn-t-X-it-s-Y", () => {
    assert.equal(
      draftHasAiTropes("This isn't a tooling problem. It's a loop problem."),
      true,
    );
    assert.equal(
      draftHasAiTropes("It's not the model, it's the workflow."),
      true,
    );
  });

  it("keeps ordinary human takes", () => {
    assert.equal(
      draftHasAiTropes("The loop between research and shipping is the real tax."),
      false,
    );
    assert.equal(draftHasAiTropes("If it ships, tell me."), false);
  });
});

describe("postNeedsStance", () => {
  it("asks on sharp opinions and timely takes", () => {
    assert.equal(postNeedsStance({ threadKind: "sharp_opinion" }), true);
    assert.equal(postNeedsStance({ threadKind: "timely_take" }), true);
    assert.equal(postNeedsStance({ threadKind: "fact_add" }), false);
  });

  it("asks on political or rage-bait flags", () => {
    assert.equal(
      postNeedsStance({ threadKind: "other", flags: ["political"] }),
      true,
    );
    assert.equal(postNeedsStance({ threadKind: "fact_add", flags: ["on_agenda"] }), false);
  });
});

describe("sanitizeSuggestedDraft", () => {
  it("strips em dashes so they never reach the pane", () => {
    const out = sanitizeSuggestedDraft(
      "Exactly. The bottleneck \u2014 the loop between research and shipping.",
    );
    assert.equal(out.includes("\u2014"), false);
  });
});
