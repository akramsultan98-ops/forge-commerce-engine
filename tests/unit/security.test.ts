import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp } from "@/server/security/safe-fetch";
import { decryptSecret, encryptSecret, hashIp, safeEqual, signValue, verifySignedValue } from "@/server/security/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { rateLimit, resetRateLimits } from "@/server/security/rate-limit";
import { redact } from "@/server/logging/logger";
import { verifyShopifyQueryHmac, verifyShopifyWebhook, isValidShopDomain } from "@/server/integrations/shopify";
import { hmac } from "@/server/security/crypto";
import { can, PERMISSIONS } from "@/lib/rbac";

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.2.3.4", "172.16.9.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"])("blocks %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
  it("rejects internal hostnames, credentials, odd ports and non-http schemes", () => {
    expect(() => assertPublicUrl("http://localhost/x")).toThrow();
    expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertPublicUrl("https://user:pass@example.com")).toThrow();
    expect(() => assertPublicUrl("https://example.com:6379/")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
    expect(assertPublicUrl("https://example.com/a").hostname).toBe("example.com");
  });
});

describe("crypto", () => {
  it("round-trips AES-256-GCM and detects tampering", () => {
    const c = encryptSecret("shpat_secret_token");
    expect(c).not.toContain("shpat");
    expect(decryptSecret(c)).toBe("shpat_secret_token");
    const [v, iv, tag, ct] = c.split(":");
    const tampered = [v, iv, tag, Buffer.from("x" + Buffer.from(ct, "base64").toString("binary"), "binary").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it("hashes IPs with a key and signs values", () => {
    expect(hashIp("1.2.3.4")).toHaveLength(32);
    expect(hashIp("1.2.3.4")).not.toContain("1.2.3.4");
    expect(verifySignedValue("abc", signValue("abc"))).toBe(true);
    expect(verifySignedValue("abd", signValue("abc"))).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
  it("hashes passwords with scrypt and rejects short ones", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery", h)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();
  });
});

describe("rate limiting", () => {
  it("blocks after the limit within the window and recovers later", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimit("k", 5, 60_000, t0 + i).ok).toBe(true);
    expect(rateLimit("k", 5, 60_000, t0 + 10).ok).toBe(false);
    expect(rateLimit("k", 5, 60_000, t0 + 130_000).ok).toBe(true);
  });
});

describe("log redaction", () => {
  it("masks secret-looking keys recursively", () => {
    expect(redact({ user: "a", password: "p", nested: { apiKey: "k", ok: 1 }, list: [{ token: "t" }] })).toEqual({ user: "a", password: "[redacted]", nested: { apiKey: "[redacted]", ok: 1 }, list: [{ token: "[redacted]" }] });
  });
});

describe("Shopify verification", () => {
  it("validates shop domains", () => {
    expect(isValidShopDomain("my-store.myshopify.com")).toBe(true);
    expect(isValidShopDomain("evil.com")).toBe(false);
    expect(isValidShopDomain("my-store.myshopify.com.evil.com")).toBe(false);
  });
  it("verifies OAuth query HMACs", () => {
    const params = new URLSearchParams({ code: "abc", shop: "s.myshopify.com", state: "xyz", timestamp: "1" });
    const msg = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", hmac("secret", msg, "hex"));
    expect(verifyShopifyQueryHmac(params, "secret")).toBe(true);
    params.set("state", "tampered");
    expect(verifyShopifyQueryHmac(params, "secret")).toBe(false);
  });
  it("verifies webhook HMACs over the raw body", () => {
    const body = JSON.stringify({ id: 1 });
    expect(verifyShopifyWebhook(body, hmac("secret", body, "base64"), "secret")).toBe(true);
    expect(verifyShopifyWebhook(body + " ", hmac("secret", body, "base64"), "secret")).toBe(false);
    expect(verifyShopifyWebhook(body, null, "secret")).toBe(false);
  });
});

describe("RBAC", () => {
  it("enforces the admin / operator / viewer matrix", () => {
    expect(can("viewer", "products:read")).toBe(true);
    expect(can("viewer", "products:write")).toBe(false);
    expect(can("operator", "agents:run")).toBe(true);
    expect(can("operator", "settings:write")).toBe(false);
    expect(can("operator", "integrations:manage")).toBe(false);
    expect(can("admin", "users:manage")).toBe(true);
    expect(can(null, "dashboard:read")).toBe(false);
    for (const roles of Object.values(PERMISSIONS)) expect(roles as readonly string[]).toContain("admin");
  });
});
