import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", ".data/**", "dist/**", "coverage/**", "playwright-report/**", "test-results/**", "blob-report/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Route files under src/app are async Server Components: they render once per request on the
    // server, so request-time values like Date.now() are intended. Client components keep the rule.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: { "react-hooks/purity": "off" },
  },
];

export default config;
