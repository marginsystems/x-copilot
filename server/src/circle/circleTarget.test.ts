import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { circleTargetFromAuthors } from "./circleTarget.ts";
import { parseXUsers } from "./xProfiles.ts";

const users = new Map(
  parseXUsers(
    [
      { id: "7", username: "Bob" },
      { id: "77", username: "Alice" },
      { id: "99", username: "me" },
    ],
    "2026-09-30T00:00:00.000Z",
  ).map((user) => [user.id ?? "", user] as const),
);

await describe("circleTargetFromAuthors", async () => {
  await it("credits the quoted author of a quote-reply", () => {
    assert.deepEqual(
      circleTargetFromAuthors({ quotedAuthorId: "7", replyUserId: "77", ownXUserId: "99", users }),
      { authorKey: "bob", kind: "quote" },
    );
  });

  await it("falls back to the reply parent when the quoted author cannot be credited", () => {
    for (const quotedAuthorId of ["99", "404", null]) {
      assert.deepEqual(
        circleTargetFromAuthors({ quotedAuthorId, replyUserId: "77", ownXUserId: "99", users }),
        { authorKey: "alice", kind: "reply" },
      );
    }
  });

  await it("credits nobody for self-replies and unknown users", () => {
    assert.equal(
      circleTargetFromAuthors({ quotedAuthorId: "99", replyUserId: "99", ownXUserId: "99", users }),
      null,
    );
    assert.equal(
      circleTargetFromAuthors({ quotedAuthorId: null, replyUserId: "404", ownXUserId: "99", users }),
      null,
    );
  });
});
