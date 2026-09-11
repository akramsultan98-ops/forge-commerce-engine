import crypto from "node:crypto";
import { env } from "../env";
import { logger } from "../logging/logger";

const DEV_FALLBACK = "forge-dev-only-insecure-key-do-not-use-in-production";
let warned = false;

function keyFrom(material: string, label: string): Buffer {
  if (!material || material.startsWith("replace-with")) {
    if (env().NODE_ENV === "production") throw new Error(`${label} is not configured`);
    if (!warned) {
      logger.warn(`${label} not configured — using an insecure development key. Set it before storing real credentials.`);
      warned = true;
    }
    material = DEV_FALLBACK;
  }
  const decoded = Buffer.from(material, "base64");
  if (decoded.length === 32) return decoded;
  // Accept any high-entropy string by stretching it to 32 bytes.
  return crypto.createHash("sha256").update(material).digest();
}

const encryptionKey = () => keyFrom(env().ENCRYPTION_KEY, "ENCRYPTION_KEY");
const authKey = () => keyFrom(env().AUTH_SECRET, "AUTH_SECRET");

/** AES-256-GCM encryption for third-party credentials at rest. Format: v1:<iv>:<tag>:<ciphertext> (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  try {
    return JSON.parse(decryptSecret(payload)) as T;
  } catch (err) {
    logger.error("failed to decrypt stored credentials", { err });
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmac(secret: string | Buffer, data: string | Buffer, encoding: "hex" | "base64" = "hex"): string {
  return crypto.createHmac("sha256", secret).update(data).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Keyed hash of an IP address — lets us rate-limit and de-duplicate without storing raw IPs. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return hmac(authKey(), `ip:${ip}`).slice(0, 32);
}

/** Signs a short value with AUTH_SECRET (used for signed postback URLs and experiment cookies). */
export function signValue(value: string): string {
  return hmac(authKey(), value).slice(0, 32);
}

export function verifySignedValue(value: string, signature: string): boolean {
  return safeEqual(signValue(value), signature);
}
