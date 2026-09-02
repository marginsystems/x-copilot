import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchesSkippedTheme,
  sameSuggestionTheme,
  themeTokens,
  withoutSkippedThemes,
} from "./forYouTheme.ts";

describe("forYouTheme", () => {
  it("treats remixes of the same original thesis as one theme", () => {
    const first = {
      kind: "post",
      why: "Your 8.7k-view Claude refusal reply is your best shape—double down with an original take.",
      draft: "Refusal is a feature, not a bug.",
    };
    const remix = {
      kind: "post",
      why: "Your 8.7k Claude refusal still leads. Write the next original.",
      draft: "Your prompts are the real problem.",
    };
    const other = {
      kind: "post",
      why: "Your 2k shipping recap landed. Write the next builder note.",
      draft: "What did you ship this week?",
    };
    assert.equal(sameSuggestionTheme(first, remix), true);
    assert.equal(sameSuggestionTheme(first, other), false);
    assert.ok(themeTokens(first.why).has("claude"));
    assert.ok(themeTokens(first.why).has("refusal"));
  });

  it("matches quote and reply cards by target, not by why wording", () => {
    const skipped = {
      kind: "quote",
      why: "weird requote",
      targetId: "99",
      targetUrl: "https://x.com/a/status/99",
    };
    assert.equal(
      sameSuggestionTheme(skipped, {
        kind: "quote",
        why: "quote the winner",
        targetId: "99",
      }),
      true,
    );
    assert.equal(
      sameSuggestionTheme(skipped, {
        kind: "quote",
        why: "quote the winner",
        targetUrl: "https://x.com/a/status/99",
      }),
      true,
    );
    assert.equal(
      sameSuggestionTheme(skipped, {
        kind: "quote",
        why: "weird requote",
        targetId: "100",
      }),
      false,
    );
    assert.equal(
      sameSuggestionTheme(skipped, {
        kind: "reply",
        why: "weird requote",
        targetId: "99",
      }),
      false,
    );
  });

  it("drops inbox rows that match a recent skip", () => {
    const skipped = [
      {
        kind: "post",
        why: "Your 8.7k-view Claude refusal reply is your best shape.",
        draft: "Refusal is a feature.",
      },
    ];
    const rows = withoutSkippedThemes(
      [
        {
          id: "keep",
          kind: "quote",
          why: "quote a win",
          targetId: "10",
        },
        {
          id: "bury",
          kind: "post",
          why: "Your 8.7k Claude refusal still leads.",
          draft: "Limits are your creativity.",
        },
      ],
      skipped,
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      ["keep"],
    );
    assert.equal(
      matchesSkippedTheme(
        {
          kind: "post",
          why: "Your 8.7k Claude refusal still leads.",
          draft: "Another remix.",
        },
        skipped,
      ),
      true,
    );
  });

  it("does not bury a post sharing only generic cross-field tokens", () => {
    assert.equal(
      sameSuggestionTheme(
        {
          kind: "post",
          why: "Your Claude reply on product launches failed.",
          draft: "Launch notes are a feature.",
        },
        {
          kind: "post",
          why: "Your 8.7k Claude refusal reply is your best shape.",
          draft: "Refusal is a feature, not a bug.",
        },
      ),
      false,
    );
  });
});
