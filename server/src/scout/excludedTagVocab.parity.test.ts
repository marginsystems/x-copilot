import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXCLUDEABLE_TAG_VOCAB as clientVocab } from "../../../frontend/src/lib/settings.ts";
import { EXCLUDEABLE_TAG_VOCAB as serverVocab } from "./threadFilters.ts";

await describe("excludeable tag vocabulary", async () => {
  await it("stays equal on the client and server", () => {
    assert.deepEqual(clientVocab, serverVocab);
  });
});
