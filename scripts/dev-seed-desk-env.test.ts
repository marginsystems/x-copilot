import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { ensureDeskPreviewEnv } from "./dev-seed-desk-env.ts";

await describe("desk preview env", () => {
  it("rejects a mismatched database or disabled auth and accepts matching settings", () => {
    const root = mkdtempSync(join(tmpdir(), "desk-preview-env-"));
    const dbPath = resolve(root, "data/desk-preview/platform.sqlite");
    const envPath = join(root, ".env");
    try {
      writeFileSync(envPath, "PORT=8787\nAUTH_REQUIRED=1\n");
      assert.throws(() => ensureDeskPreviewEnv(root, dbPath), /incompatible with desk preview/);

      writeFileSync(envPath, "PLATFORM_DB_PATH=data/platform.sqlite\nAUTH_REQUIRED=1\n");
      assert.throws(() => ensureDeskPreviewEnv(root, dbPath), /incompatible with desk preview/);

      writeFileSync(envPath, "PLATFORM_DB_PATH=data/desk-preview/platform.sqlite\nAUTH_REQUIRED=0\n");
      assert.throws(() => ensureDeskPreviewEnv(root, dbPath), /incompatible with desk preview/);

      writeFileSync(envPath, 'PLATFORM_DB_PATH="data/desk-preview/platform.sqlite"\n');
      assert.equal(ensureDeskPreviewEnv(root, dbPath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }).catch(assert.fail);

  it("creates the preview environment when no .env exists", () => {
    const root = mkdtempSync(join(tmpdir(), "desk-preview-env-"));
    const dbPath = resolve(root, "data/desk-preview/platform.sqlite");
    try {
      assert.equal(ensureDeskPreviewEnv(root, dbPath), true);
      assert.equal(
        readFileSync(join(root, ".env"), "utf8"),
        "PORT=8787\nPLATFORM_DB_PATH=data/desk-preview/platform.sqlite\nDESK_EVENTS_SECRET=desk-preview\nAUTH_REQUIRED=1\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }).catch(assert.fail);
});
