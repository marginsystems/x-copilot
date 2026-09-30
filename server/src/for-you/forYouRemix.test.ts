import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOwnPostRemixCopy } from "./forYouRemix.ts";

await describe("isOwnPostRemixCopy", async () => {
  await it("flags view-count hooks and double-downs", () => {
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
    assert.equal(isOwnPostRemixCopy("900 views on the recap"), true);
  });

  await it("lets a live Scout angle through", () => {
    assert.equal(
      isOwnPostRemixCopy("Hiring thread is live. Take a side."),
      false,
    );
  });
});
