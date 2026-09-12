import Link from "next/link";
import { and, eq, isNotNull } from "drizzle-orm";
import { ShoppingBag } from "lucide-react";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { env } from "@/server/env";
import { products } from "@/server/db/schema";
import { SHOPIFY_COMPLIANCE_TOPICS, SHOPIFY_WEBHOOK_TOPICS, shopifyStatus } from "@/server/integrations/shopify";
import { Badge, Callout, EmptyState, Field, Input, KeyValue, Mono, PageHeader, Panel, SetupState } from "@/components/admin/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/admin/forms";
import { enqueueJobAction } from "../../actions/products";
import { connectShopifyAction, shopifyOpAction } from "../../actions/system";

export const metadata = { title: "Shopify" };

/** ORDERS_CREATE → orders/create */
const topicLabel = (t: string) => t.toLowerCase().replace("_", "/");

export default async function ShopifyPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const ctx = await pageContext("settings:read");
  const sp = await searchParams;
  const status = await shopifyStatus(ctx);
  const published = await ctx.db.select({ id: products.id, title: products.title, gid: products.shopifyProductId }).from(products).where(and(eq(products.organizationId, ctx.orgId), isNotNull(products.shopifyProductId)));
  const canManage = can(ctx.role, "integrations:manage");
  const webhookUrl = new URL("/api/webhooks/shopify", env().APP_URL).toString();
  const hooks = status.webhooks;

  return (
    <>
      <PageHeader
        eyebrow="Money & data"
        title={
          <span className="flex items-center gap-3">
            Shopify <Badge tone={status.connected ? "good" : "neutral"}>{status.connected ? "connected" : "not connected"}</Badge>
          </span>
        }
        description="Admin GraphQL API integration: OAuth, product publishing (as drafts) with metafields, line-level order sync with refunds and UTM attribution, and verified webhooks. Secrets never reach the browser; tokens are encrypted at rest."
      />
      {sp.connected && (
        <Callout className="mb-6" title="Connected">
          {sp.connected} is now connected.
        </Callout>
      )}
      {sp.error && (
        <Callout tone="critical" className="mb-6" title="Connection failed">
          {sp.error}
        </Callout>
      )}
      {status.demoMode && (
        <Callout tone="warning" className="mb-6" title="DEMO_MODE">
          Shopify writes (product publishing, webhook registration) and order sync are disabled while DEMO_MODE is on.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Connection">
          {status.connected ? (
            <>
              <KeyValue
                items={[
                  { k: "Shop", v: <Mono>{status.shop}</Mono> },
                  { k: "Credential source", v: status.source === "env" ? "Custom-app token (env)" : "OAuth" },
                  { k: "API version", v: status.apiVersion },
                  { k: "Last order sync", v: status.lastSyncAt ? formatRelative(status.lastSyncAt) : "never" },
                ]}
              />
              {status.lastError && <p className="mt-3 text-xs text-[#ff9b9b]">{status.lastError}</p>}
              {canManage && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-edge pt-4">
                  <ActionForm action={enqueueJobAction} className="inline-block">
                    <input type="hidden" name="job" value="shopify_sync" />
                    <SubmitButton size="sm" pendingText="Queuing…">
                      Sync orders now
                    </SubmitButton>
                  </ActionForm>
                  {status.source === "oauth" && (
                    <ActionForm action={shopifyOpAction} className="inline-block">
                      <input type="hidden" name="op" value="disconnect" />
                      <SubmitButton size="sm" variant="danger" confirm="Disconnect Shopify? Stored tokens are deleted.">
                        Disconnect
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
            </>
          ) : (
            <SetupState title="Shopify" requirements={status.requirements} docsUrl="https://shopify.dev/docs/apps/build/authentication-authorization">
              {status.oauthAppConfigured && canManage && (
                <ActionForm action={connectShopifyAction} className="mt-4 flex items-end gap-2">
                  <Field label="Store domain" htmlFor="shop" className="flex-1">
                    <Input id="shop" name="shop" required placeholder="my-store.myshopify.com" />
                  </Field>
                  <SubmitButton>Connect via OAuth</SubmitButton>
                </ActionForm>
              )}
            </SetupState>
          )}
        </Panel>

        <Panel title="Webhooks" subtitle="Registered automatically when a store connects over OAuth">
          <div className="mb-3 flex items-center gap-2">
            <Mono className="min-w-0 flex-1 truncate">{webhookUrl}</Mono>
            <CopyButton value={webhookUrl} />
          </div>
          <ul className="grid grid-cols-2 gap-1.5 text-xs">
            {SHOPIFY_WEBHOOK_TOPICS.map((t) => (
              <li key={t}>
                <Mono>{topicLabel(t)}</Mono>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-dim">
            Compliance topics — declare them in your app configuration (shopify.app.toml or the Dev Dashboard): {SHOPIFY_COMPLIANCE_TOPICS.join(" · ")}
          </p>
          {hooks && (
            <div className="mt-4 border-t border-edge pt-4">
              <KeyValue
                items={[
                  { k: "Last registration", v: formatRelative(new Date(hooks.at)) },
                  { k: "Result", v: hooks.skipped ?? `${hooks.created.length} created · ${hooks.existing.length} already registered${hooks.errors.length ? ` · ${hooks.errors.length} failed` : ""}` },
                ]}
              />
              {hooks.errors.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[#ff9b9b]">
                  {hooks.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!status.webhookSecretConfigured && (
            <p className="mt-3 text-xs text-warning">No webhook secret is configured — set SHOPIFY_CLIENT_SECRET (app) or SHOPIFY_WEBHOOK_SECRET (store-level), otherwise every webhook is rejected.</p>
          )}
          {status.connected && canManage && (
            <ActionForm action={shopifyOpAction} className="mt-4">
              <input type="hidden" name="op" value="register_webhooks" />
              <SubmitButton size="sm" pendingText="Registering…">
                Register webhooks now
              </SubmitButton>
            </ActionForm>
          )}
          <p className="mt-4 text-xs text-dim">
            Every webhook is verified with HMAC-SHA256 of the raw body, routed to the organisation connected to the sending store, and de-duplicated by its webhook id. Orders are stored per line item and updated in place, so refunds and cancellations replace earlier state instead of adding to it.
          </p>
        </Panel>
      </div>

      <Panel className="mt-6" title="Products published to Shopify" bodyClassName={published.length ? "p-0" : undefined}>
        {published.length ? (
          <ul className="divide-y divide-edge">
            {published.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/admin/products/${p.id}`} className="text-fog hover:underline">
                  {p.title}
                </Link>
                <Mono>{p.gid}</Mono>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ShoppingBag} title="Nothing published yet">
            Owned-inventory products (dropshipping / Shopify models) get a “Publish to Shopify” button once a store is connected. Products are created as drafts for your review.
          </EmptyState>
        )}
      </Panel>
    </>
  );
}
