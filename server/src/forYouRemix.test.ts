import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOwnPostRemixCopy } from "./forYouRemix.ts";

describe("isOwnPostRemixCopy", () => {
  it("flags view-count hooks and double-downs", () => {
    assert.equal(
      isOwnPostRemixCopy(
        "Your 4k contributions post got 12 views—the agent-counting angle is worth a sharper hook.",
      ),
      true,
    );
    assert.equal(
      isOwnPostRemixCopy(
        "Your 8.7k-view Claude refusal reply is your best shape—double down with an original take.",
      ),
      true,
    );
    assert.equal(isOwnPostRemixCopy("900 views on the recap", "Ship it."), true);
  });

  it("lets a live Scout angle through", () => {
    assert.equal(
      isOwnPostRemixCopy(
        "Hiring thread is live. Take a side.",
        "Who is actually hiring this week?",
      ),
      false,
    );
  });

  it("does not flag remix phrases used in the draft", () => {
    assert.equal(
      isOwnPostRemixCopy(
        "AI hiring thread is live",
        "Should builders double down on reasoning models?",
      ),
      false,
    );
  });
});
