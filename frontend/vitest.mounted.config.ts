import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const frontendRoot = dirname(fileURLToPath(import.meta.url));

// Deliberately independent of vite.config.ts: no app server, proxy, or SEO plugins.
export default defineConfig({
  root: frontendRoot,
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["tests/mounted/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/mounted/support/setup.ts"],
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    clearMocks: true,
  },
});
