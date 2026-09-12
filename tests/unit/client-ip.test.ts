import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import { PEER_HEADER, clientIpFromHeaders, installPeerStamp, normalizeIp, parseTrustedProxies, resolveClientIp, signPeer, trustedProxies, verifyPeer } from "@/server/security/client-ip";

const none = parseTrustedProxies("");

afterEach(() => {
  delete process.env.TRUSTED_PROXIES;
  resetEnvCache();
});

describe("normalizeIp", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    [" 1.2.3.4 ", "1.2.3.4"],
    ["1.2.3.4:5678", "1.2.3.4"],
    ["::ffff:10.0.0.1", "10.0.0.1"],
    ["[2001:DB8::1]:443", "2001:db8::1"],
    ["fe80::1%eth0", "fe80::1"],
  ])("%s → %s", (raw, want) => expect(normalizeIp(raw)).toBe(want));
  it.each(["", "unknown", "1.2.3", "300.1.1.1", "[::1", "evil.com"])("rejects %j", (raw) => expect(normalizeIp(raw)).toBeNull());
});

describe("parseTrustedProxies", () => {
  it("accepts addresses, CIDR blocks and presets", () => {
    const t = parseTrustedProxies("203.0.113.7, 10.0.0.0/8, 2001:db8::/32, loopback");
    expect(t.has("203.0.113.7")).toBe(true);
    expect(t.has("203.0.113.8")).toBe(false);
    expect(t.has("10.9.8.7")).toBe(true);
    expect(t.has("2001:db8::abcd")).toBe(true);
    expect(t.has("127.0.0.1")).toBe(true);
    expect(t.has("::1")).toBe(true);
    expect(t.has("::ffff:10.1.1.1")).toBe(true);
    expect(t.has("8.8.8.8")).toBe(false);
  });
  it("trusts nobody when empty", () => {
    expect(none.size).toBe(0);
    expect(none.has("127.0.0.1")).toBe(false);
  });
  it.each(["bogus", "10.0.0.0/33", "10.0.0.0/x", "1.2.3.4/8/1", "::1/129"])("rejects %j", (spec) => expect(() => parseTrustedProxies(spec)).toThrow(/TRUSTED_PROXIES/));
});

describe("resolveClientIp", () => {
  const proxy = parseTrustedProxies("10.0.0.10, 10.0.0.11");

  it("ignores forwarding headers when no proxy is trusted", () => {
    expect(resolveClientIp("198.51.100.4", "6.6.6.6", none)).toBe("198.51.100.4");
  });
  it("ignores forwarding headers from an untrusted peer (spoofing attempt)", () => {
    expect(resolveClientIp("198.51.100.4", "6.6.6.6", proxy)).toBe("198.51.100.4");
  });
  it("uses the hop a trusted proxy appended", () => {
    expect(resolveClientIp("10.0.0.10", "203.0.113.5", proxy)).toBe("203.0.113.5");
  });
  it("skips chains of trusted proxies and never uses client-controlled entries on the left", () => {
    expect(resolveClientIp("10.0.0.10", "6.6.6.6, 203.0.113.5, 10.0.0.11", proxy)).toBe("203.0.113.5");
  });
  it("stops at a malformed hop instead of trusting what is left of it", () => {
    expect(resolveClientIp("10.0.0.10", "6.6.6.6, unknown", proxy)).toBe("10.0.0.10");
  });
  it("falls back to the peer when a trusted proxy sent no header", () => {
    expect(resolveClientIp("10.0.0.10", null, proxy)).toBe("10.0.0.10");
  });
  it("handles IPv6 and IPv4-mapped peers", () => {
    const v6 = parseTrustedProxies("fd00::/8");
    expect(resolveClientIp("fd00::2", "2001:db8::9", v6)).toBe("2001:db8::9");
    expect(resolveClientIp("::ffff:198.51.100.4", "6.6.6.6", none)).toBe("198.51.100.4");
  });
  it("returns null without a valid peer", () => {
    expect(resolveClientIp(null, "6.6.6.6", proxy)).toBeNull();
  });
});

describe("peer stamp", () => {
  it("verifies stamps it signed and rejects forged or tampered ones", () => {
    expect(verifyPeer(signPeer("198.51.100.4"))).toBe("198.51.100.4");
    expect(verifyPeer("6.6.6.6;forged")).toBeNull();
    expect(verifyPeer(signPeer("198.51.100.4").replace("198.51.100.4", "6.6.6.6"))).toBeNull();
    expect(verifyPeer("")).toBeNull();
  });
  it("without a stamp, forwarding headers are never trusted", () => {
    expect(clientIpFromHeaders((n) => (n === "x-forwarded-for" ? "6.6.6.6" : null))).toBeNull();
  });
  it("reads TRUSTED_PROXIES from the environment", () => {
    process.env.TRUSTED_PROXIES = "private";
    resetEnvCache();
    expect(trustedProxies().has("192.168.1.1")).toBe(true);
  });

  it("stamps the real TCP peer on live requests and overrides client-supplied headers", async () => {
    installPeerStamp();
    const server = http.createServer((req, res) => {
      const get = (n: string) => {
        const v = req.headers[n];
        return Array.isArray(v) ? v.join(", ") : (v ?? null);
      };
      res.end(JSON.stringify({ peer: verifyPeer(get(PEER_HEADER)), client: clientIpFromHeaders(get) }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const spoof = { "x-forwarded-for": "6.6.6.6", [PEER_HEADER]: "6.6.6.6;forged" };
    try {
      expect(await (await fetch(url, { headers: spoof })).json()).toEqual({ peer: "127.0.0.1", client: "127.0.0.1" });
      process.env.TRUSTED_PROXIES = "loopback";
      resetEnvCache();
      expect(await (await fetch(url, { headers: spoof })).json()).toEqual({ peer: "127.0.0.1", client: "6.6.6.6" });
    } finally {
      server.close();
    }
  });
});
