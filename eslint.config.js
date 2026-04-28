import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.test.json",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-console": ["error", { allow: ["error"] }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["src/core/audit.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
