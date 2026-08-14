import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./loadEnv.ts";

describe("loadEnv", () => {
  const prev = process.env.LOADENV_TEST_KEY;
  const dirs: string[] = [];

  afterEach(() => {
    if (prev === undefined) delete process.env.LOADENV_TEST_KEY;
    else process.env.LOADENV_TEST_KEY = prev;
    while (dirs.length) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeEnv(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), "x-loadenv-"));
    dirs.push(dir);
    const file = join(dir, ".env");
    writeFileSync(file, body);
    return file;
  }

  it("does not override an existing key by default", () => {
    const file = writeEnv("LOADENV_TEST_KEY=from-file\n");
    process.env.LOADENV_TEST_KEY = "from-process";
    assert.equal(loadEnv(file), true);
    assert.equal(process.env.LOADENV_TEST_KEY, "from-process");
  });

  it("overwrites when override is true", () => {
    const file = writeEnv("LOADENV_TEST_KEY=from-file\n");
    process.env.LOADENV_TEST_KEY = "from-process";
    assert.equal(loadEnv(file, { override: true }), true);
    assert.equal(process.env.LOADENV_TEST_KEY, "from-file");
  });
});
