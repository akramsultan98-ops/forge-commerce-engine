"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CURRENCIES } from "@/lib/constants";
import { CURRENCY_COOKIE, LOCALE_COOKIE, isLocale, makeT } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { getDb } from "@/server/db/client";
import { newsletterSubscribers } from "@/server/db/schema";
import { resolveStorefront } from "@/server/services/org";
import { recordEvent } from "@/server/services/tracking";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { env } from "@/server/env";

const YEAR = 365 * 86400;
const secure = () => env().APP_URL.startsWith("https://");

export async function setLocaleAction(fd: FormData) {
  const locale = fd.get("locale");
  if (isLocale(locale)) (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax", secure: secure() });
  revalidatePath("/", "layout");
}

export async function setCurrencyAction(fd: FormData) {
  const c = String(fd.get("currency") ?? "");
  if ((CURRENCIES as readonly string[]).includes(c)) (await cookies()).set(CURRENCY_COOKIE, c, { path: "/", maxAge: YEAR, sameSite: "lax", secure: secure() });
  revalidatePath("/", "layout");
}

/** Consent for the single first-party analytics cookie (random visitor id). No third-party trackers exist. */
export async function consentAction(granted: boolean) {
  const store = await cookies();
  store.set("forge_consent", granted ? "granted" : "denied", { path: "/", maxAge: YEAR, sameSite: "lax", secure: secure() });
  if (granted && !store.get("forge_vid")) store.set("forge_vid", crypto.randomUUID(), { path: "/", maxAge: YEAR, sameSite: "lax", secure: secure(), httpOnly: true });
  if (!granted) store.delete("forge_vid");
}

type State = { ok: boolean; message?: string; error?: string } | null;

export async function subscribeAction(_prev: State, fd: FormData): Promise<State> {
  const t = makeT(await getLocale());
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`newsletter:${ip}`, LIMITS.newsletter.limit, LIMITS.newsletter.windowMs).ok) return { ok: false, error: t("admin.login.rateLimited") };
  if (fd.get("company")) return { ok: true, message: t("newsletter.success") }; // honeypot
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(fd.get("email"));
  if (!parsed.success) return { ok: false, error: t("newsletter.invalid") };
  const db = getDb();
  const { org } = await resolveStorefront(db, h.get("host"));
  const locale = await getLocale();
  await db.insert(newsletterSubscribers).values({ organizationId: org.id, email: parsed.data, locale, source: String(fd.get("source") ?? "storefront").slice(0, 60) }).onConflictDoNothing();
  const vid = (await cookies()).get("forge_vid")?.value ?? null;
  await recordEvent(db, { orgId: org.id, eventType: "NEWSLETTER_SIGNUP", visitorId: vid, path: String(fd.get("source") ?? "/"), userAgent: h.get("user-agent"), ip });
  return { ok: true, message: t("newsletter.success") };
}
