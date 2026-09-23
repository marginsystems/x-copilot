import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Known exception: existing dependency findings remain warning-only until
      // follow-up PRs fix them. No source files or custom hooks are exempt.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
