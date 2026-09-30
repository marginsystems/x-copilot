import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function ensureDeskPreviewEnv(root: string, dbPath: string): boolean {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(
      envPath,
      [
        "PORT=8787",
        "PLATFORM_DB_PATH=data/desk-preview/platform.sqlite",
        "DESK_EVENTS_SECRET=desk-preview",
        "AUTH_REQUIRED=1",
        "",
      ].join("\n"),
    );
    return true;
  }

  const values = new Map<string, string>();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(trimmed.slice(0, separator).trim(), value);
  }

  const configuredDbPath = values.get("PLATFORM_DB_PATH");
  const authRequired = values.get("AUTH_REQUIRED")?.toLowerCase();
  if (
    !configuredDbPath ||
    resolve(root, configuredDbPath) !== dbPath ||
    ["0", "false", "off"].includes(authRequired ?? "")
  ) {
    throw new Error(
      "Existing .env is incompatible with desk preview: set PLATFORM_DB_PATH=data/desk-preview/platform.sqlite and AUTH_REQUIRED=1",
    );
  }
  return false;
}
