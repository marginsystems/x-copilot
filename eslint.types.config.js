import tsParser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";

const rules = {
  "@typescript-eslint/no-explicit-any": ["error", {
    fixToUnknown: false,
    ignoreRestArgs: false,
  }],
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-floating-promises": ["error", {
    ignoreVoid: false,
    ignoreIIFE: false,
    checkThenables: true,
  }],
  "@typescript-eslint/no-misused-promises": ["error", {
    checksConditionals: true,
    checksSpreads: true,
    checksVoidReturn: true,
  }],
  "@typescript-eslint/no-unsafe-type-assertion": "error",
  "@typescript-eslint/ban-ts-comment": ["error", {
    "ts-ignore": true,
    "ts-nocheck": true,
    "ts-expect-error": "allow-with-description",
    "ts-check": false,
    minimumDescriptionLength: 10,
  }],
};

function typed(files, project) {
  return {
    files,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules,
  };
}

export default [
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      "server/dist/**",
      "webhook/dist/**",
      "analytics/dist/**",
      "coverage/**",
    ],
  },
  typed(
    ["frontend/src/**/*.{ts,tsx,mts,cts}"],
    ["./tsconfig.json"],
  ),
  typed(
    ["frontend/tests/mounted/**/*.{ts,tsx,mts,cts}", "frontend/vitest.mounted.config.ts"],
    ["./frontend/tsconfig.mounted.json"],
  ),
  typed(
    ["server/src/**/*.{ts,tsx,mts,cts}"],
    ["./tsconfig.eslint.server.json"],
  ),
  typed(
    ["webhook/src/**/*.{ts,tsx,mts,cts}"],
    ["./tsconfig.eslint.webhook.json"],
  ),
  typed(
    ["analytics/src/**/*.{ts,tsx,mts,cts}"],
    ["./tsconfig.eslint.analytics.json"],
  ),
  typed(
    ["scripts/**/*.{ts,tsx,mts,cts}"],
    ["./tsconfig.eslint.scripts.json"],
  ),
  typed(
    ["frontend/vite.config.ts"],
    ["./frontend/tsconfig.eslint.vite.json"],
  ),
];
