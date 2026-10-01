import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "X Copilot",
    description: "Your X Copilot approach card beside x.com. It never types or posts for you.",
    permissions: browser === "firefox" ? ["storage", "tabs"] : ["storage", "tabs", "sidePanel"],
    host_permissions: [
      "https://x.com/*",
      "https://api.xcopilot.dev/*",
      "http://127.0.0.1/*",
      "http://localhost/*",
    ],
    action: { default_title: "Open X Copilot" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "x-copilot@xcopilot.dev",
              strict_min_version: "115.0",
              data_collection_permissions: { required: ["websiteActivity"] },
            },
          },
        }
      : {}),
  }),
  zip: {
    artifactTemplate: "x-copilot-{{version}}-{{browser}}.zip",
    sourcesTemplate: "x-copilot-{{version}}-sources.zip",
    sourcesRoot: "..",
    includeSources: ["extension/**", "shared/src/**"],
    excludeSources: ["extension/node_modules/**", "extension/.output/**", "extension/.wxt/**", "**/*.test.ts", "**/*.test.tsx"],
  },
  vite: () => ({
    server: { fs: { allow: [".."] } },
  }),
});
