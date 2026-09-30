import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDeskPreviewEnvFile } from "../../../scripts/dev-seed-env.ts";
import { loadEnv } from "./loadEnv.ts";

describe("desk preview env", () => {
  it("overrides an existing platform database setting with the preview database", () => {
    const root = mkdtempSync(join(tmpdir(), "desk-preview-env-"));
    const envPath = join(root, ".env");
    const previousDbPath = process.env.PLATFORM_DB_PATH;
    writeFileSync(envPath, "PLATFORM_DB_PATH=data/platform.sqlite\n");

    try {
      ensureDeskPreviewEnvFile(root);
      process.env.PLATFORM_DB_PATH = "data/platform.sqlite";
      loadEnv(envPath, { override: true });
      assert.equal(process.env.PLATFORM_DB_PATH, "data/desk-preview/platform.sqlite");
    } finally {
      if (previousDbPath === undefined) delete process.env.PLATFORM_DB_PATH;
      else process.env.PLATFORM_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
