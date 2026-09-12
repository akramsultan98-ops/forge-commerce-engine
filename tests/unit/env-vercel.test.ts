import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/server/env";

const KEYS = ["APP_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

function withEnv(vars: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  resetEnvCache();
  return env();
}

describe("APP_URL on Vercel", () => {
  const vercel = { VERCEL: "1", VERCEL_URL: "forge-abc123-acme.vercel.app", VERCEL_BRANCH_URL: "forge-git-main-acme.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "forge-acme.vercel.app" };

  it("uses the stable branch URL for preview deployments", () => {
    expect(withEnv({ ...vercel, VERCEL_ENV: "preview" }).APP_URL).toBe("https://forge-git-main-acme.vercel.app");
  });
  it("falls back to the deployment URL when there is no branch URL", () => {
    expect(withEnv({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "forge-abc123-acme.vercel.app" }).APP_URL).toBe("https://forge-abc123-acme.vercel.app");
  });
  it("uses the production URL for production deployments", () => {
    expect(withEnv({ ...vercel, VERCEL_ENV: "production" }).APP_URL).toBe("https://forge-acme.vercel.app");
  });
  it("never overrides an explicit APP_URL", () => {
    expect(withEnv({ ...vercel, VERCEL_ENV: "preview", APP_URL: "https://review.example.com" }).APP_URL).toBe("https://review.example.com");
  });
  it("keeps the local default outside Vercel", () => {
    expect(withEnv({ VERCEL_BRANCH_URL: "ignored.vercel.app" }).APP_URL).toBe("http://localhost:3000");
  });
});
