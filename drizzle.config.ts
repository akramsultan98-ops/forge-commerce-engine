import { defineConfig } from "drizzle-kit";

// Migrations are generated from the TypeScript schema and applied with `npm run db:migrate`.
// drizzle-kit only needs the dialect to generate SQL; the runtime migrator picks the driver
// (node-postgres or embedded PGlite) from DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
