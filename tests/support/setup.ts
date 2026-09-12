// Runs before every test file (each file is its own process — pool: "forks").
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "pglite://memory",
  DEMO_MODE: process.env.TEST_DEMO_MODE ?? "true",
  LOG_LEVEL: "error",
  TRENDS_WIKIPEDIA_ENABLED: "false",
  JOB_RUNNER: "off",
  APP_URL: "http://localhost:3000",
  AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnopqrstuv",
  ENCRYPTION_KEY: "test-encryption-key-0123456789abcdefghijklmnopq",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
});
