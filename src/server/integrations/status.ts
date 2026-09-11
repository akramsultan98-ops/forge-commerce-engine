import type { ServiceContext } from "../context";
import { providerStatus } from "../ai/registry";
import { resolveEngine } from "../ai/service";
import { isDemoMode } from "../env";
import { emailConfigured } from "./email";
import { telegramConfigured } from "./telegram";
import { shopifyStatus } from "./shopify";
import { socialStatus } from "./social";
import { ADAPTERS } from "../discovery/adapters";
import { ensureSources } from "../discovery/service";

/** One place that answers "what is connected, what is mocked, what needs credentials". */
export async function integrationOverview(ctx: ServiceContext) {
  const [engine, shopify, sources] = await Promise.all([resolveEngine(ctx, "research"), shopifyStatus(ctx), ensureSources(ctx)]);
  return {
    demoMode: isDemoMode(),
    ai: { providers: providerStatus(), engine },
    shopify,
    social: socialStatus(),
    email: { configured: emailConfigured(), requirements: ["EMAIL_PROVIDER=resend", "EMAIL_PROVIDER_KEY", "EMAIL_FROM", "ALERT_EMAIL_TO"] },
    telegram: { configured: telegramConfigured(), requirements: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] },
    sources: sources.map((s) => {
      const a = ADAPTERS.find((x) => x.key === s.adapter);
      return { ...s, credentialsEncrypted: undefined, hasCredentials: !!s.credentialsEncrypted, adapter: a ? { key: a.key, label: a.label, kind: a.kind, officialApi: a.officialApi, docsUrl: a.docsUrl, requirements: a.requirements, implementation: a.implementation, notes: a.notes } : null };
    }),
  };
}
