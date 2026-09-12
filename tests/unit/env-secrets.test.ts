import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache, secretProblem } from "@/server/env";

// Fresh random values per run — no secret is ever hardcoded.
const strong = () => crypto.randomBytes(48).toString("base64url");

const KEYS = ["NODE_ENV", "AUTH_SECRET", "ENCRYPTION_KEY", "DEMO_MODE", "VERCEL", "VERCEL_ENV"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else Object.assign(process.env, { [k]: saved[k] }); // NODE_ENV is typed read-only
  }
  resetEnvCache();
});

function load(vars: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: "production", ...vars });
  resetEnvCache();
  return () => env();
}
function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

describe("secretProblem", () => {
  it.each([
    [undefined, /not set/],
    ["", /not set/],
    [` ${"k".repeat(0)}${crypto.randomBytes(48).toString("base64url")}`, /whitespace/],
    [`${crypto.randomBytes(48).toString("base64url")}\n`, /whitespace/],
    [`"${crypto.randomBytes(48).toString("base64url")}"`, /quotes/],
    ["replace-with-32-random-bytes-base64", /placeholder/],
    ["build-stage-placeholder-not-a-secret-0000000000", /placeholder/],
    ["change-me-change-me-change-me-change-me", /placeholder/],
    [crypto.randomBytes(12).toString("base64"), /too short \(16 characters; at least 32 required\)/],
    ["ab".repeat(20), /does not look random/],
  ])("flags %j", (value, reason) => {
    expect(secretProblem(value)).toMatch(reason);
  });

  it.each([
    ["base64url, 48 bytes", crypto.randomBytes(48).toString("base64url")],
    ["base64, 32 bytes", crypto.randomBytes(32).toString("base64")],
    ["hex, 32 bytes", crypto.randomBytes(32).toString("hex")],
  ])("accepts %s", (_label, value) => {
    expect(secretProblem(value)).toBeNull();
  });
});

describe("production secret validation", () => {
  it("accepts two different strong secrets", () => {
    expect(load({ AUTH_SECRET: strong(), ENCRYPTION_KEY: strong() })()).toMatchObject({ NODE_ENV: "production" });
  });

  it("names every invalid variable in one error", () => {
    expect(errorOf(load({}))).toMatch(/AUTH_SECRET is not set; ENCRYPTION_KEY is not set/);
  });

  it("names only the variable that is wrong", () => {
    const message = errorOf(load({ AUTH_SECRET: strong(), ENCRYPTION_KEY: "replace-with-32-random-bytes-base64" }));
    expect(message).toMatch(/ENCRYPTION_KEY is still a placeholder/);
    expect(message).not.toMatch(/AUTH_SECRET (is|has|does)/);
  });

  it("rejects one value reused for both", () => {
    const same = strong();
    expect(errorOf(load({ AUTH_SECRET: same, ENCRYPTION_KEY: same }))).toMatch(/must be different/);
  });

  it("is not relaxed by DEMO_MODE", () => {
    expect(errorOf(load({ DEMO_MODE: "true" }))).toMatch(/AUTH_SECRET is not set/);
  });

  it("names the Vercel environment and explains that a redeploy is needed", () => {
    const message = errorOf(load({ VERCEL: "1", VERCEL_ENV: "preview", AUTH_SECRET: strong() }));
    expect(message).toMatch(/Vercel environment: preview/);
    expect(message).toMatch(/ENCRYPTION_KEY is not set/);
    expect(message).toMatch(/redeploy/);
  });

  it("never includes a secret value in the error", () => {
    const shortSecret = crypto.randomBytes(9).toString("hex");
    const quoted = `"${strong()}"`;
    const message = errorOf(load({ AUTH_SECRET: shortSecret, ENCRYPTION_KEY: quoted }));
    expect(message).toMatch(/AUTH_SECRET is too short/);
    expect(message).toMatch(/ENCRYPTION_KEY is wrapped in quotes/);
    expect(message).not.toContain(shortSecret);
    expect(message).not.toContain(quoted.slice(1, -1));
  });

  it("does not require secrets outside production", () => {
    expect(load({ NODE_ENV: "test" })()).toMatchObject({ NODE_ENV: "test" });
  });
});
