import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const UNIT_ROOTS = ["server/src", "src", "analytics/src", "webhook/src"];
const UNIT_SUFFIXES = [".test.ts", ".test.tsx"];

function collectTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return UNIT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
      ? [relative(process.cwd(), path)]
      : [];
  });
}

const tests = UNIT_ROOTS.flatMap(collectTests).sort();
const command = process.argv[2];

if (command === "list") {
  process.stdout.write(`${tests.join("\n")}\n`);
} else if (command === "run" || command === "coverage") {
  const args = ["--test"];
  if (command === "coverage") args.push("--experimental-test-coverage");
  const result = spawnSync("tsx", [...args, ...tests], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.error("Usage: tsx scripts/test-inventory.ts <list|run|coverage>");
  process.exitCode = 2;
}
