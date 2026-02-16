// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // --------------------------------------------
  // LEGACY / MIGRATION QUARANTINE (TEMPORARY)
  // --------------------------------------------
  {
    files: [
      "src/app/**/actions.ts",
      "src/app/**/route.ts",
      "src/lib/**",
      "src/components/editors/**",
      "src/components/AuthForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // --------------------------------------------
  // NEW CODE = STRICT
  // --------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);
