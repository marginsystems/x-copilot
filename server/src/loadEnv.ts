import { existsSync, readFileSync } from "node:fs";

export type LoadEnvOpts = {
  /**
   * When true, .env overwrites keys already in process.env.
   * Default false (dotenv-style) so tests/CI can inject overrides.
   * The sidecar passes true — PM2 restart otherwise keeps stale secrets.
   */
  override?: boolean;
};

/** Load KEY=VAL pairs from a .env file into process.env. */
export function loadEnv(path: string, opts?: LoadEnvOpts): boolean {
  if (!existsSync(path)) return false;
  const override = opts?.override === true;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (override || !(key in process.env)) process.env[key] = val;
  }
  return true;
}
