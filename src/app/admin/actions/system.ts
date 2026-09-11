"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import { actionContext } from "@/server/auth/session";
import { act, str, type ActionState } from "@/server/actions/util";
import { setSetting, type SettingKey } from "@/server/settings";
import { createApiKey, createUser, revokeUserSessions } from "@/server/auth/core";
import { apiKeys, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { updateSchedule } from "@/server/jobs/scheduler";
import { saveSourceConfig } from "@/server/discovery/service";
import { beginShopifyOAuth, disconnectShopify, publishProductToShopify } from "@/server/integrations/shopify";
import { checkLink, createLink, createNetwork, rotatePostbackSecret, saveNetworkCredentials, setLinkStatus } from "@/server/services/affiliate";
import { affiliateLinks } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";

const num = (fd: FormData, k: string) => Number(str(fd, k));

export async function saveSettingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("settings:write");
    const key = str(fd, "key") as SettingKey;
    let value: unknown;
    switch (key) {
      case "scoring.weights":
        value = Object.fromEntries(["trend", "velocity", "margin", "content", "problem", "impulse", "competition", "novelty", "shipping"].map((f) => [f, num(fd, f)]));
        break;
      case "testing.thresholds":
        value = {
          minDays: num(fd, "minDays"),
          maxDays: num(fd, "maxDays"),
          minPageViews: num(fd, "minPageViews"),
          winner: { minAffiliateCtr: num(fd, "winnerCtr") / 100, minConversionRate: num(fd, "winnerConv") / 100, minRoi: num(fd, "winnerRoi") / 100 },
          failure: { maxAffiliateCtr: num(fd, "failCtr") / 100, maxConversionRate: num(fd, "failConv") / 100 },
          engagement: { strongRate: num(fd, "engagement") / 100 },
        };
        break;
      case "ai.routing": {
        const tiers: Record<string, string> = {};
        for (const [k, v] of fd.entries()) if (k.startsWith("tier:") && typeof v === "string") tiers[k.slice(5)] = v;
        value = { provider: str(fd, "provider"), fastModel: str(fd, "fastModel"), strongModel: str(fd, "strongModel"), monthlyBudgetUsd: num(fd, "monthlyBudgetUsd"), cacheTtlHours: num(fd, "cacheTtlHours"), taskTiers: tiers };
        break;
      }
      case "currency": {
        const rates: Record<string, number> = {};
        for (const [k, v] of fd.entries()) if (k.startsWith("rate:") && typeof v === "string") rates[k.slice(5)] = Number(v);
        value = { display: str(fd, "display"), rates, ratesUpdatedAt: new Date().toISOString() };
        break;
      }
      case "markets":
        value = { primary: str(fd, "primary"), enabled: fd.getAll("enabled").map(String) };
        break;
      case "notifications":
        value = { email: str(fd, "email") === "on", telegram: str(fd, "telegram") === "on", emailTo: str(fd, "emailTo"), trafficSpikeMultiplier: num(fd, "trafficSpikeMultiplier") };
        break;
      case "discovery":
        value = { maxPriceUsd: num(fd, "maxPriceUsd"), minMarginPct: num(fd, "minMarginPct"), excludeHighRisk: str(fd, "excludeHighRisk") === "on", defaultBusinessModel: str(fd, "defaultBusinessModel"), autoScoreNewProducts: str(fd, "autoScoreNewProducts") === "on", minScoreToApprove: num(fd, "minScoreToApprove") };
        break;
      case "storefront":
        value = { name: str(fd, "name"), contactEmail: str(fd, "contactEmail"), affiliateDisclosure: str(fd, "affiliateDisclosure"), returnsSummary: str(fd, "returnsSummary"), shippingSummary: str(fd, "shippingSummary") };
        break;
      default:
        throw new ValidationError("Unknown setting");
    }
    await setSetting(ctx, key, value);
    return "Settings saved.";
  });
}

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("users:manage");
    const role = str(fd, "role") as UserRole;
    if (!(USER_ROLES as readonly string[]).includes(role)) throw new ValidationError("Unknown role");
    const u = await createUser(ctx.db, { organizationId: ctx.orgId, email: str(fd, "email"), name: str(fd, "name"), password: str(fd, "password"), role });
    await audit(ctx, "user.create", { type: "user", id: u.id }, { role });
    return `${u.email} added as ${role}.`;
  });
}

export async function updateUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("users:manage");
    const id = str(fd, "id");
    if (id === ctx.userId) throw new ValidationError("You can't change your own role or access.");
    const op = str(fd, "op");
    if (op === "disable" || op === "enable") {
      await ctx.db.update(users).set({ disabled: op === "disable" }).where(and(eq(users.id, id), eq(users.organizationId, ctx.orgId)));
      if (op === "disable") await revokeUserSessions(ctx.db, id);
    } else {
      const role = str(fd, "role") as UserRole;
      if (!(USER_ROLES as readonly string[]).includes(role)) throw new ValidationError("Unknown role");
      await ctx.db.update(users).set({ role }).where(and(eq(users.id, id), eq(users.organizationId, ctx.orgId)));
    }
    await audit(ctx, `user.${op || "role"}`, { type: "user", id });
    return "User updated.";
  });
}

export async function apiKeyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("apikeys:manage");
    if (str(fd, "op") === "revoke") {
      await ctx.db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, str(fd, "id")), eq(apiKeys.organizationId, ctx.orgId)));
      await audit(ctx, "api_key.revoke", { type: "api_key", id: str(fd, "id") });
      return "Key revoked.";
    }
    const role = (str(fd, "role") || "viewer") as UserRole;
    const { key, record } = await createApiKey(ctx.db, { organizationId: ctx.orgId, name: str(fd, "name") || "API key", role, createdBy: ctx.userId });
    await audit(ctx, "api_key.create", { type: "api_key", id: record.id }, { role });
    return { message: `Key created — copy it now, it will not be shown again: ${key}`, data: { key } };
  });
}

export async function scheduleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("settings:write");
    await updateSchedule(ctx.db, ctx.orgId, str(fd, "id"), { cron: str(fd, "cron") || undefined, enabled: str(fd, "enabled") === "on" });
    await audit(ctx, "schedule.update", { type: "schedule", id: str(fd, "id") });
    return "Automation updated.";
  });
}

// ── Sources & integrations ───────────────────────────────────────────────────
export async function sourceConfigAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("integrations:manage");
    const config: Record<string, unknown> = {};
    const credentials: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (k.startsWith("config:")) config[k.slice(7)] = k === "config:defaultCommission" ? Number(v) : v.trim();
      if (k.startsWith("cred:")) credentials[k.slice(5)] = v.trim();
    }
    await saveSourceConfig(ctx, str(fd, "id"), { config, credentials, enabled: str(fd, "enabled") === "on" });
    return "Source saved. Credentials are encrypted at rest.";
  });
}

export async function connectShopifyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let url = "";
  const res = await act(async () => {
    const ctx = await actionContext("integrations:manage");
    url = await beginShopifyOAuth(ctx, str(fd, "shop"));
  });
  if (!res?.ok) return res;
  redirect(url);
}

export async function shopifyOpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("integrations:manage");
    const op = str(fd, "op");
    if (op === "disconnect") {
      await disconnectShopify(ctx);
      return "Disconnected.";
    }
    if (op === "publish") {
      const r = await publishProductToShopify(ctx, str(fd, "productId"));
      return `Created in Shopify as a draft (${r.gid}).`;
    }
    throw new ValidationError("Unknown operation");
  });
}

export async function networkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const op = str(fd, "op");
    if (op === "create") {
      const ctx = await actionContext("affiliate:write");
      await createNetwork(ctx, { name: str(fd, "name"), type: str(fd, "type"), website: str(fd, "website"), defaultCookieDays: str(fd, "defaultCookieDays") || null, subIdParam: str(fd, "subIdParam") });
      return "Network added.";
    }
    const ctx = await actionContext("integrations:manage");
    if (op === "credentials") {
      const creds: Record<string, string> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("cred:") && typeof v === "string") creds[k.slice(5)] = v;
      await saveNetworkCredentials(ctx, str(fd, "id"), creds);
      return "Credentials saved (encrypted). FORGE does not verify them against the network automatically.";
    }
    if (op === "postback") {
      const url = await rotatePostbackSecret(ctx, str(fd, "id"));
      return { message: "New postback URL generated — paste it into the network's postback/pixel settings. It is shown only now.", data: { postbackUrl: url } };
    }
    throw new ValidationError("Unknown operation");
  });
}

export async function linkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("affiliate:write");
    const op = str(fd, "op");
    if (op === "create") {
      await createLink(ctx, { productId: str(fd, "productId"), networkId: str(fd, "networkId"), merchant: str(fd, "merchant") || undefined, url: str(fd, "url"), commissionRate: str(fd, "commissionRate") || null, cookieDays: str(fd, "cookieDays") || null, country: str(fd, "country"), isPrimary: str(fd, "isPrimary") === "on" });
      return "Tracked link created.";
    }
    const id = str(fd, "id");
    if (op === "check") {
      const [link] = await ctx.db.select().from(affiliateLinks).where(and(eq(affiliateLinks.id, id), eq(affiliateLinks.organizationId, ctx.orgId))).limit(1);
      if (!link) throw new ValidationError("Link not found");
      const r = await checkLink(ctx, link);
      return r.error === "demo" ? "Demo link — not checked against the network." : `Status ${r.status}${r.code ? ` (HTTP ${r.code})` : ""}${r.error ? ` — ${r.error}` : ""}.`;
    }
    if (op === "pause" || op === "activate") {
      await setLinkStatus(ctx, id, op === "pause" ? "PAUSED" : "ACTIVE");
      return "Link updated.";
    }
    throw new ValidationError("Unknown operation");
  });
}
