import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { htmlWithSeo } from "./src/lib/seo";

/** Emit public-route HTML so crawlers that skip JS still see the tags. */
function seoRouteHtml(): Plugin {
  return {
    name: "seo-route-html",
    apply: "build",
    closeBundle() {
      const dist = join(process.cwd(), "dist");
      const index = readFileSync(join(dist, "index.html"), "utf8");
      const routes = [
        { view: "changelog" as const, dir: "changelog" },
        { view: "learn" as const, dir: "learn" },
        { view: "learnWeights" as const, dir: "learn/what-a-like-is-worth" },
        { view: "learnReply" as const, dir: "learn/posts-that-get-a-reply" },
        { view: "learnFollow" as const, dir: "learn/follow" },
      ];
      for (const route of routes) {
        mkdirSync(join(dist, route.dir), { recursive: true });
        writeFileSync(
          join(dist, route.dir, "index.html"),
          htmlWithSeo(index, route.view),
        );
      }
    },
  };
}

/**
 * Search Console's HTML-tag verification fetches the raw HTML without running
 * JS, so the google-site-verification meta tag must be present in the served
 * static HTML. Inject it at build time from VITE_GSC_VERIFICATION.
 */
function gscVerificationMeta(verification: string): Plugin {
  return {
    name: "gsc-verification-meta",
    transformIndexHtml(html) {
      if (!verification) return html;
      const meta = `<meta name="google-site-verification" content="${verification}" />`;
      return html.replace("</head>", `    ${meta}\n  </head>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      gscVerificationMeta(env.VITE_GSC_VERIFICATION ?? ""),
      seoRouteHtml(),
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("x-real-ip");
            });
          },
        },
      },
    },
  };
});
