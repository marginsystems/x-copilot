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
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: { default_title: "Open X Copilot" },
  }),
  vite: () => ({
    server: { fs: { allow: [".."] } },
  }),
});
