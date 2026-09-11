// Social publishing via official APIs only. Channels whose APIs require an audited app or video
// upload flows ship as "package" mode: FORGE produces ready-to-publish packages instead.

import { and, desc, eq } from "drizzle-orm";
import type { Platform } from "@/lib/constants";
import { assertCan, type ServiceContext } from "../context";
import { content, contentAssets, products } from "../db/schema";
import { env } from "../env";
import { assertOutboundAllowed } from "../demo";
import { audit } from "../audit";
import { IntegrationNotConfiguredError, ValidationError } from "../errors";
import { trackingUrlFor } from "../services/content";

const GRAPH = "https://graph.facebook.com/v23.0";

interface PublishInput {
  text: string;
  link: string | null;
  title: string;
  imageUrl: string | null;
}

export interface SocialChannel {
  platform: Platform;
  label: string;
  api: string;
  docsUrl: string;
  mode: "direct" | "package";
  requirements: string[];
  notes: string;
  isConfigured(): boolean;
  publish?(input: PublishInput): Promise<{ externalId: string; url?: string }>;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export const CHANNELS: SocialChannel[] = [
  {
    platform: "TIKTOK",
    label: "TikTok",
    api: "Content Posting API",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    mode: "package",
    requirements: ["TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET", "App audit for public direct posting (unaudited apps can only post privately)", "A rendered video file per concept"],
    notes: "FORGE generates scripts, captions, hashtags and tracked links. Film, then upload in TikTok (or implement the video.publish flow after your app is audited).",
    isConfigured: () => false,
  },
  {
    platform: "INSTAGRAM",
    label: "Instagram",
    api: "Instagram Graph API — content publishing",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    mode: "direct",
    requirements: ["Instagram Business/Creator account linked to a Facebook Page", "INSTAGRAM_BUSINESS_ACCOUNT_ID", "FACEBOOK_PAGE_ACCESS_TOKEN with instagram_content_publish", "A public image URL (attach an image asset)"],
    notes: "Direct publishing supports single-image posts here; Reels need a hosted video URL.",
    isConfigured: () => !!(env().INSTAGRAM_BUSINESS_ACCOUNT_ID && env().FACEBOOK_PAGE_ACCESS_TOKEN),
    async publish(i) {
      if (!i.imageUrl) throw new ValidationError("Instagram requires an image — attach an image asset first");
      const e = env();
      const container = await postJson(`${GRAPH}/${e.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`, { image_url: i.imageUrl, caption: i.text, access_token: e.FACEBOOK_PAGE_ACCESS_TOKEN });
      const published = await postJson(`${GRAPH}/${e.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`, { creation_id: container.id, access_token: e.FACEBOOK_PAGE_ACCESS_TOKEN });
      return { externalId: String(published.id) };
    },
  },
  {
    platform: "YOUTUBE",
    label: "YouTube Shorts",
    api: "YouTube Data API v3 — videos.insert",
    docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
    mode: "package",
    requirements: ["YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET (OAuth)", "Verified Google Cloud app (uploads from unverified apps are private)", "A rendered vertical video"],
    notes: "FORGE produces the Short's title, script, description and tracked link.",
    isConfigured: () => false,
  },
  {
    platform: "PINTEREST",
    label: "Pinterest",
    api: "Pinterest API v5 — POST /pins",
    docsUrl: "https://developers.pinterest.com/docs/api/v5/pins-create/",
    mode: "direct",
    requirements: ["PINTEREST_ACCESS_TOKEN with pins:write", "PINTEREST_BOARD_ID", "An image asset"],
    notes: "Creates an image Pin linking to the tracked landing page.",
    isConfigured: () => !!(env().PINTEREST_ACCESS_TOKEN && env().PINTEREST_BOARD_ID),
    async publish(i) {
      if (!i.imageUrl) throw new ValidationError("Pinterest requires an image — attach an image asset first");
      const e = env();
      const json = await postJson(
        "https://api.pinterest.com/v5/pins",
        { board_id: e.PINTEREST_BOARD_ID, title: i.title.slice(0, 100), description: i.text.slice(0, 500), link: i.link ?? undefined, media_source: { source_type: "image_url", url: i.imageUrl } },
        { Authorization: `Bearer ${e.PINTEREST_ACCESS_TOKEN}` },
      );
      return { externalId: String(json.id), url: `https://www.pinterest.com/pin/${json.id}/` };
    },
  },
  {
    platform: "FACEBOOK",
    label: "Facebook Page",
    api: "Pages API — POST /{page-id}/feed",
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
    mode: "direct",
    requirements: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN with pages_manage_posts"],
    notes: "Publishes a link post to your Page.",
    isConfigured: () => !!(env().FACEBOOK_PAGE_ID && env().FACEBOOK_PAGE_ACCESS_TOKEN),
    async publish(i) {
      const e = env();
      const json = await postJson(`${GRAPH}/${e.FACEBOOK_PAGE_ID}/feed`, { message: i.text, link: i.link ?? undefined, access_token: e.FACEBOOK_PAGE_ACCESS_TOKEN });
      return { externalId: String(json.id) };
    },
  },
  {
    platform: "X",
    label: "X",
    api: "X API v2 — POST /2/tweets",
    docsUrl: "https://docs.x.com/x-api/posts/creation-of-a-post",
    mode: "direct",
    requirements: ["X_USER_ACCESS_TOKEN — OAuth 2.0 user-context token with tweet.write (app-only bearer tokens cannot post)", "An X API plan that includes posting"],
    notes: "Publishes a text post with the tracked link.",
    isConfigured: () => !!env().X_USER_ACCESS_TOKEN,
    async publish(i) {
      const text = `${i.text}${i.link ? `\n${i.link}` : ""}`.slice(0, 280);
      const json = (await postJson("https://api.x.com/2/tweets", { text }, { Authorization: `Bearer ${env().X_USER_ACCESS_TOKEN}` })) as { data?: { id: string } };
      return { externalId: String(json.data?.id), url: json.data?.id ? `https://x.com/i/web/status/${json.data.id}` : undefined };
    },
  },
];

export function socialStatus() {
  return CHANNELS.map((c) => ({ platform: c.platform, label: c.label, api: c.api, docsUrl: c.docsUrl, mode: c.mode, configured: c.isConfigured(), requirements: c.requirements, notes: c.notes }));
}

export async function publishContent(ctx: ServiceContext, contentId: string) {
  assertCan(ctx, "content:publish");
  const [item] = await ctx.db.select().from(content).where(and(eq(content.id, contentId), eq(content.organizationId, ctx.orgId))).limit(1);
  if (!item) throw new ValidationError("Content not found");
  const channel = CHANNELS.find((c) => c.platform === item.platform);
  if (!channel || channel.mode === "package" || !channel.publish) {
    throw new IntegrationNotConfiguredError(`${channel?.label ?? item.platform} direct publishing`, [...(channel?.requirements ?? []), "Use “Export package” to publish manually."]);
  }
  if (!channel.isConfigured()) throw new IntegrationNotConfiguredError(channel.label, channel.requirements);
  assertOutboundAllowed(`social.publish.${item.platform}`);
  const link = await trackingUrlFor(ctx, item);
  const [asset] = await ctx.db.select({ url: contentAssets.url }).from(contentAssets).where(and(eq(contentAssets.contentId, contentId), eq(contentAssets.kind, "IMAGE"))).orderBy(desc(contentAssets.createdAt)).limit(1);
  const [p] = item.productId ? await ctx.db.select({ imageUrl: products.imageUrl }).from(products).where(eq(products.id, item.productId)).limit(1) : [];
  const disclosure = item.sponsoredDisclosure ? " #ad" : "";
  const result = await channel.publish({ text: `${item.caption ?? item.hook ?? item.title}${disclosure}`, link, title: item.title, imageUrl: asset?.url ?? p?.imageUrl ?? null });
  await ctx.db.update(content).set({ status: "PUBLISHED", publishedAt: new Date(), externalPostId: result.externalId, externalUrl: result.url ?? null }).where(eq(content.id, contentId));
  await audit(ctx, "content.publish", { type: "content", id: contentId }, { platform: item.platform, externalId: result.externalId });
  return result;
}
