/**
 * Fail if a frontend source file grows back over 1,000 lines.
 * Allowlist is empty and can only ratchet down.
 *
 *   npx tsx scripts/check-file-sizes.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN = join(ROOT, "src");
const FAIL_LINES = 1000;
const EXTS = new Set([".ts", ".tsx", ".css"]);

/** posix path → max lines. Empty: nothing over 1,000 is allowed. */
const ALLOWLIST: Record<string, number> = {};

function isTestFile(name: string): boolean {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".test.fixtures.ts") ||
    name.endsWith(".testHelpers.ts")
  );
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = name.slice(name.lastIndexOf("."));
    if (!EXTS.has(ext) || isTestFile(name)) continue;
    out.push(full);
  }
}

const files: string[] = [];
walk(SCAN, files);
files.sort();

const failures: string[] = [];
for (const full of files) {
  const rel = relative(ROOT, full).split("\\").join("/");
  const lines = lineCount(readFileSync(full, "utf8"));
  const cap = ALLOWLIST[rel];
  if (cap != null) {
    if (lines < FAIL_LINES) {
      failures.push(
        `${rel}: ${lines} lines — drop from the allowlist (ratchet down)`,
      );
    } else if (lines > cap) {
      failures.push(`${rel}: ${lines} lines — allowlist cap is ${cap}`);
    }
    continue;
  }
  if (lines > FAIL_LINES) {
    failures.push(`${rel}: ${lines} lines (limit ${FAIL_LINES})`);
  }
}

if (failures.length) {
  console.error("file-size ratchet failed:");
  for (const row of failures) console.error(`  ${row}`);
  process.exit(1);
}

console.log(
  `file-size ratchet ok: ${files.length} frontend files, none over ${FAIL_LINES}`,
);
