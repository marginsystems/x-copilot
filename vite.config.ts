import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

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
    plugins: [react(), gscVerificationMeta(env.VITE_GSC_VERIFICATION ?? "")],
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
