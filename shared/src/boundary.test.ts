import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

const sharedRoot = import.meta.dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function escapesShared(file: string, specifier: string): boolean {
  if (specifier.startsWith("node:")) return !file.endsWith(".test.ts");
  if (!specifier.startsWith(".")) return true;
  return relative(sharedRoot, resolve(dirname(file), specifier)).startsWith("..");
}

await describe("shared desk core boundary", () => {
  it("imports only other shared modules, so the desk and the extension can both load it", () => {
    const leaks = sourceFiles(sharedRoot).flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) => escapesShared(file, specifier))
        .map((specifier) => `${relative(sharedRoot, file)} -> ${specifier}`),
    );
    assert.deepEqual(leaks, []);
  }).catch(assert.fail);

  it("touches no browser storage or DOM, so the extension's service worker can load it too", () => {
    const browserGlobal = /\b(?:localStorage|sessionStorage|document|window)\b/;
    const touches = sourceFiles(sharedRoot)
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => browserGlobal.test(readFileSync(file, "utf8")))
      .map((file) => relative(sharedRoot, file));
    assert.deepEqual(touches, []);
  }).catch(assert.fail);
});
