import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PREVIEW_DB_SETTING = "PLATFORM_DB_PATH=data/desk-preview/platform.sqlite";

export function ensureDeskPreviewEnvFile(root: string): void {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(
      envPath,
      [
        "PORT=8787",
        PREVIEW_DB_SETTING,
        "DESK_EVENTS_SECRET=desk-preview",
        "AUTH_REQUIRED=1",
        "",
      ].join("\n"),
    );
    console.log("wrote .env for the preview server (gitignored)");
    return;
  }

  const existing = readFileSync(envPath, "utf8");
  const dbSettings = existing
    .split(/\r?\n/)
    .filter((line) => /^\s*PLATFORM_DB_PATH\s*=/.test(line))
    .map((line) => line.trim());
  if (dbSettings[dbSettings.length - 1] === PREVIEW_DB_SETTING) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(envPath, `${existing}${separator}${PREVIEW_DB_SETTING}\n`);
  console.log("updated .env with the preview database path (gitignored)");
}
