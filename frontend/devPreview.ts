import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const SESSION_COOKIE = "xc_session";
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function avatarSvg(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initials = handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="hsl(${hue} 42% 36%)"/><circle cx="100" cy="78" r="38" fill="hsl(${hue} 46% 62%)"/><ellipse cx="100" cy="176" rx="64" ry="50" fill="hsl(${hue} 46% 62%)"/><text x="100" y="112" font-family="monospace" font-size="34" font-weight="700" text-anchor="middle" fill="hsl(${hue} 30% 16%)">${initials}</text></svg>`;
}

export function deskPreviewPlugin(repoRoot: string): Plugin {
  const tokenPath = join(repoRoot, "data", "desk-preview", "session-token.txt");
  return {
    name: "desk-preview",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const avatar = /^\/__dev\/avatar\/([A-Za-z0-9_]{1,30})\.svg$/.exec(path);
        if (avatar?.[1]) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "no-store");
          res.end(avatarSvg(avatar[1]));
          return;
        }
        if (path === "/__dev/blank") {
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>blank</title><body style=\"margin:0\">");
          return;
        }
        if (path === "/__dev/login") {
          if (!existsSync(tokenPath)) {
            res.statusCode = 404;
            res.end("Run: npx tsx scripts/dev-seed-desk.ts");
            return;
          }
          const token = readFileSync(tokenPath, "utf8").trim();
          res.setHeader(
            "Set-Cookie",
            `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; HttpOnly; SameSite=Lax`,
          );
          res.statusCode = 302;
          res.setHeader("Location", "/dashboard");
          res.end();
          return;
        }
        next();
      });
    },
  };
}
