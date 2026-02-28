import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUnscopedQuery from "./eslint-rules/no-unscoped-supabase-query.js";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // 🔥 TEMP BUILD STABILISATION MODE
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },

  // 🏢 MULTI-TENANT: flag Supabase queries missing organisation_id scope
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: {
      "local-rules": {
        rules: {
          "no-unscoped-supabase-query": noUnscopedQuery,
        },
      },
    },
    rules: {
      "local-rules/no-unscoped-supabase-query": ["warn", {
        ignore: [],
      }],
    },
  },
]);
