import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser, mode }) => ({
    name: "X Copilot",
    description: "Your X Copilot approach card beside x.com. It never types or posts for you.",
    permissions: browser === "firefox" ? ["storage", "tabs"] : ["storage", "tabs", "sidePanel"],
    host_permissions: [
      "https://x.com/*",
      "https://api.xcopilot.dev/*",
      ...(mode === "development" ? ["http://127.0.0.1/*", "http://localhost/*"] : []),
    ],
    action: { default_title: "Open X Copilot" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "x-copilot@xcopilot.dev",
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: ["authenticationInfo", "browsingActivity", "websiteContent", "websiteActivity", "personalCommunications"],
              },
            },
            gecko_android: { strict_min_version: "142.0" },
          },
        }
      : { minimum_chrome_version: "114" }),
  }),
  zip: {
    artifactTemplate: "x-copilot-{{version}}-{{browser}}.zip",
    sourcesTemplate: "x-copilot-{{version}}-sources.zip",
    sourcesRoot: fileURLToPath(new URL("..", import.meta.url)),
    includeSources: ["extension/**", "shared/src/**"],
    excludeSources: ["extension/node_modules/**", "extension/.output/**", "extension/.wxt/**", "**/*.test.ts", "**/*.test.tsx"],
  },
  vite: () => ({
    server: { fs: { allow: [".."] } },
  }),
});
