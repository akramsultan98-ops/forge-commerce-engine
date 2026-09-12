// Client IP resolution. Forwarding headers (X-Forwarded-For) are honoured ONLY when the TCP peer is
// an explicitly trusted proxy (TRUSTED_PROXIES). Next.js does not expose the socket address to route
// handlers and fills X-Forwarded-For from the socket only when the client did not send one — so a
// client could otherwise pick its own IP. The server therefore stamps the real peer address onto
// every request (signed with a per-process key) before Next.js handles it; see instrumentation.ts.

import crypto from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import { env } from "../env";
import { logger } from "../logging/logger";

export const PEER_HEADER = "x-forge-peer";

export interface TrustedProxies {
  /** Number of configured entries (0 = trust nobody: forwarding headers are ignored). */
  readonly size: number;
  has(ip: string | null | undefined): boolean;
}

type Globals = {
  __forgePeerKey?: Buffer;
  __forgePeerStampInstalled?: boolean;
  __forgePeerWarned?: boolean;
  __forgeTrustedProxies?: { spec: string; value: TrustedProxies };
};
const g = globalThis as unknown as Globals;

/** Named ranges accepted in TRUSTED_PROXIES next to literal addresses and CIDR blocks. */
export const PROXY_PRESETS: Record<string, string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  private: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
};

/** Canonical form of an IP (strips ports, brackets, zone ids, IPv4-mapped IPv6); null if invalid. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end < 0) return null;
    s = s.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(":"));
  }
  const zone = s.indexOf("%");
  if (zone > 0) s = s.slice(0, zone);
  if (s.toLowerCase().startsWith("::ffff:") && net.isIPv4(s.slice(7))) s = s.slice(7);
  return net.isIP(s) ? s.toLowerCase() : null;
}

const ipType = (ip: string) => (net.isIPv6(ip) ? "ipv6" : "ipv4");

/** Parses a comma-separated list of IPs, CIDR blocks and presets. Throws on any invalid entry. */
export function parseTrustedProxies(spec: string): TrustedProxies {
  const list = new net.BlockList();
  let size = 0;
  for (const token of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    for (const entry of PROXY_PRESETS[token.toLowerCase()] ?? [token]) {
      const [addr, bits, extra] = entry.split("/");
      const ip = normalizeIp(addr);
      if (!ip || extra !== undefined) throw new Error(`TRUSTED_PROXIES: "${token}" is not an IP address, CIDR block or preset (${Object.keys(PROXY_PRESETS).join(", ")})`);
      if (bits === undefined) list.addAddress(ip, ipType(ip));
      else {
        const prefix = Number(bits);
        const max = ipType(ip) === "ipv6" ? 128 : 32;
        if (!/^\d+$/.test(bits) || prefix > max) throw new Error(`TRUSTED_PROXIES: "${token}" has an invalid prefix length`);
        list.addSubnet(ip, prefix, ipType(ip));
      }
      size++;
    }
  }
  return {
    size,
    has(raw) {
      const ip = normalizeIp(raw);
      return !!ip && size > 0 && list.check(ip, ipType(ip));
    },
  };
}

/** The configured trusted proxies (parsed once per distinct TRUSTED_PROXIES value). */
export function trustedProxies(): TrustedProxies {
  const spec = env().TRUSTED_PROXIES;
  if (g.__forgeTrustedProxies?.spec !== spec) g.__forgeTrustedProxies = { spec, value: parseTrustedProxies(spec) };
  return g.__forgeTrustedProxies.value;
}

/**
 * Resolves the client address from the TCP peer and X-Forwarded-For.
 * - Peer not a trusted proxy (or none configured) → the peer itself; forwarding headers are ignored.
 * - Peer trusted → walk X-Forwarded-For right-to-left, skipping trusted hops; the first untrusted hop
 *   is the client. Entries left of it are client-controlled and never used.
 */
export function resolveClientIp(peerRaw: string | null | undefined, forwardedFor: string | null | undefined, trusted: TrustedProxies): string | null {
  const peer = normalizeIp(peerRaw);
  if (!peer) return null;
  if (!trusted.has(peer)) return peer;
  const hops = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let client = peer;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalizeIp(hops[i]);
    if (!hop) return client; // malformed entry: stop at the last address a trusted proxy vouched for
    client = hop;
    if (!trusted.has(hop)) return hop;
  }
  return client;
}

// ── Peer stamp ───────────────────────────────────────────────────────────────
const peerKey = () => (g.__forgePeerKey ??= crypto.randomBytes(32));
const peerSignature = (ip: string) => crypto.createHmac("sha256", peerKey()).update(ip).digest("base64url");

export function signPeer(ip: string): string {
  return `${ip};${peerSignature(ip)}`;
}

/** Returns the stamped peer address, or null when the header is missing, forged or tampered with. */
export function verifyPeer(value: string | null | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(";");
  if (i <= 0) return null;
  const ip = normalizeIp(value.slice(0, i));
  const sig = Buffer.from(value.slice(i + 1));
  const expected = ip ? Buffer.from(peerSignature(ip)) : null;
  return ip && expected && sig.length === expected.length && crypto.timingSafeEqual(sig, expected) ? ip : null;
}

/** Overwrites any client-supplied peer header with the real socket address. */
export function stampPeer(req: Pick<IncomingMessage, "socket" | "headers">) {
  const ip = normalizeIp(req.socket?.remoteAddress);
  req.headers[PEER_HEADER] = ip ? signPeer(ip) : "";
}

/** Hooks every HTTP(S) server in this process so each request carries the signed peer stamp. Idempotent. */
export function installPeerStamp() {
  if (g.__forgePeerStampInstalled) return;
  g.__forgePeerStampInstalled = true;
  for (const proto of [http.Server.prototype, https.Server.prototype] as Array<{ emit: (event: string | symbol, ...args: unknown[]) => boolean }>) {
    const original = proto.emit;
    proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
      if (event === "request" && args[0]) stampPeer(args[0] as IncomingMessage);
      return original.call(this, event, ...args);
    };
  }
}

/** Client IP for a request, given a header getter (NextRequest.headers.get, headers().get, …). */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string | null {
  const peer = verifyPeer(get(PEER_HEADER));
  if (!peer) {
    if (!g.__forgePeerWarned) {
      g.__forgePeerWarned = true;
      logger.warn("client peer address unavailable — forwarding headers ignored; per-IP rate limits share one bucket (is instrumentation.ts running?)");
    }
    return null;
  }
  return resolveClientIp(peer, get("x-forwarded-for"), trustedProxies());
}
