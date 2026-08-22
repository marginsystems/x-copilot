import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("scoutCollect suite split", () => {
  it("keeps themed files beside this pointer", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const name of ["bucket", "stop", "events", "hydrate", "prefilters"]) {
      assert.equal(existsSync(join(dir, `scoutCollect.${name}.test.ts`)), true);
    }
  });
});
