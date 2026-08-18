import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftHasAiTropes,
  postNeedsStance,
  sanitizeSuggestedDraft,
  stripEmDashes,
  textUsesContrastCadence,
} from "./voiceDraft.ts";

describe("stripEmDashes", () => {
  it("turns an em dash clause into a capitalized period", () => {
    assert.equal(
      stripEmDashes("The tool was never the bottleneck \u2014 the loop is."),
      "The tool was never the bottleneck. The loop is.",
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

  it("flags if-then where an em-dash strip turned the comma into a period", () => {
    const raw = "If you want speed \u2014 then cut process.";
    assert.equal(draftHasAiTropes(stripEmDashes(raw), raw), true);
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
    assert.equal(draftHasAiTropes("This isn't the first time it's happened."), false);
    assert.equal(draftHasAiTropes("It's not that it's easy."), false);
    assert.equal(draftHasAiTropes("This isn't just about tooling; it's about timing."), false);
    assert.equal(
      draftHasAiTropes("If the build fails, someone will notice. Then we fix it."),
      false,
    );
    assert.equal(draftHasAiTropes("Check if it shipped. Then follow up."), false);
    assert.equal(
      draftHasAiTropes(
        "I'd ask if the deploy actually went out. Then I'd rerun the test.",
      ),
      false,
    );
  });

  it("lets the contrast cadence through when it is the operator's own voice", () => {
    assert.equal(
      draftHasAiTropes("It's not the model, it's the workflow.", undefined, {
        allowContrastCadence: true,
      }),
      false,
    );
    assert.equal(
      draftHasAiTropes("This isn't a tooling problem. It's a loop problem.", undefined, {
        allowContrastCadence: true,
      }),
      false,
    );
    assert.equal(
      draftHasAiTropes("If you want speed, then cut process.", undefined, {
        allowContrastCadence: true,
      }),
      true,
    );
  });

  it("detects the contrast cadence in a card exemplar", () => {
    assert.equal(
      textUsesContrastCadence("It's not the tool, it's the loop."),
      true,
    );
    assert.equal(
      textUsesContrastCadence("This isn't a tooling problem. It's a loop problem."),
      true,
    );
    assert.equal(textUsesContrastCadence("Ship it and ask what broke."), false);
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
