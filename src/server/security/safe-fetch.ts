// SSRF-hardened HTTP client for fetching operator- or feed-supplied URLs (affiliate link checks,
// supplier pages, product feeds). Validates every resolved IP at connect time (defeats DNS
// rebinding), re-validates each redirect hop, caps response size and enforces timeouts.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { AppError } from "../errors";

export class SsrfBlockedError extends AppError {
  constructor(reason: string) {
    super(`Blocked outbound request: ${reason}`, 400, "ssrf_blocked");
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:")) return true;
    return false;
  }
  return true;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family as number | undefined }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || list.length === 0) return callback(new SsrfBlockedError(`${hostname} resolves to a private address`), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedPorts?: number[];
}

export interface SafeFetchResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
  redirects: string[];
}

export function assertPublicUrl(raw: string, allowedPorts: number[] = [80, 443]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfBlockedError(`protocol ${url.protocol} not allowed`);
  if (url.username || url.password) throw new SsrfBlockedError("credentials in URL not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowedPorts.includes(port)) throw new SsrfBlockedError(`port ${port} not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new SsrfBlockedError("internal hostname");
  if (net.isIP(host) && isPrivateIp(host)) throw new SsrfBlockedError("private IP address");
  return url;
}

function requestOnce(url: URL, opts: SafeFetchOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const mod = url.protocol === "https:" ? https : http;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: { "User-Agent": "FORGE-LinkCheck/0.1 (+https://github.com/forge-commerce-engine)", Accept: "*/*", ...opts.headers },
        lookup: safeLookup,
        timeout: opts.timeoutMs ?? 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new AppError("Request timed out", 504, "timeout")));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const redirects: string[] = [];
  let current = assertPublicUrl(raw, opts.allowedPorts);
  const max = opts.maxRedirects ?? 5;
  for (let hop = 0; hop <= max; hop++) {
    const res = await requestOnce(current, opts);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      redirects.push(next.toString());
      current = assertPublicUrl(next.toString(), opts.allowedPorts);
      continue;
    }
    return { ...res, finalUrl: current.toString(), redirects };
  }
  throw new SsrfBlockedError(`too many redirects (>${max})`);
}
