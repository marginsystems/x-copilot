import { defineConfig } from "vitest/config";

// Deliberately independent of vite.config.ts: no app server, proxy, or SEO plugins.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["tests/mounted/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/mounted/support/setup.ts"],
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    clearMocks: true,
  },
});
