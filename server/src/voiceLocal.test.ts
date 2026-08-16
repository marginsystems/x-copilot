import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { memoryRepliesToVoiceInputs } from "./voiceLocal.ts";

describe("memoryRepliesToVoiceInputs", () => {
  it("prefers the marked reply id and conversation root", () => {
    const rows = memoryRepliesToVoiceInputs(
      [
        {
          threadId: "111",
          text: "my reply",
          postedAt: "2026-08-16T12:00:00.000Z",
        },
      ],
      [
        {
          threadId: "111",
          replyId: "999",
          conversationId: "100",
          inReplyToId: "111",
          at: "2026-08-16T12:01:00.000Z",
        },
      ],
    );
    assert.deepEqual(rows, [
      {
        id: "999",
        text: "my reply",
        conversationId: "100",
        inReplyToId: "111",
        postedAt: "2026-08-16T12:00:00.000Z",
        source: "memory",
      },
    ]);
  });

  it("falls back to mem:threadId when the mark has no reply id", () => {
    const rows = memoryRepliesToVoiceInputs(
      [{ threadId: "222", text: "solo", postedAt: null }],
      [],
    );
    assert.equal(rows[0]?.id, "mem:222");
    assert.equal(rows[0]?.conversationId, "222");
  });
});
