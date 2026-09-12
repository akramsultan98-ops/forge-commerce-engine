// Shopify orders → FORGE order lines. Each Shopify line item is stored as its own `orders` row
// (external_order_id + external_line_id), so revenue, cost and refunds are credited to the product
// actually sold. Webhooks (REST JSON) and the GraphQL sync normalise into one shape and share one
// idempotent upsert: replays, retries and out-of-order deliveries converge on Shopify's latest state.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { orders, products } from "../db/schema";

type Rec = Record<string, unknown>;
type Money = { shopMoney?: { amount?: string | number | null } | null } | null | undefined;

export interface ShopifyOrderLine {
  lineId: string;
  productGid: string | null;
  quantity: number;
  /** Quantity after refunds and removals, when Shopify reports it. */
  currentQuantity: number | null;
  refundedQuantity: number;
  /** Line total after every discount allocation (line- and order-level), before tax. */
  gross: number;
  /** Refunded subtotal for this line (after discounts, before tax). */
  refunded: number;
}

export interface ShopifyOrder {
  orderGid: string;
  createdAt: Date;
  updatedAt: Date | null;
  currency: string;
  financialStatus: string | null;
  cancelled: boolean;
  country: string | null;
  utm: { source: string | null; campaign: string | null; content: string | null };
  lines: ShopifyOrderLine[];
  /** False when Shopify's response truncated the line items — lines we did not see are never deleted. */
  complete: boolean;
}

export interface GraphqlOrderNode {
  id: string;
  createdAt: string;
  updatedAt?: string | null;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  currencyCode: string;
  customerJourneySummary?: { lastVisit?: { utmParameters?: { source?: string | null; campaign?: string | null; content?: string | null } | null } | null } | null;
  lineItems: {
    pageInfo?: { hasNextPage: boolean } | null;
    nodes: Array<{ id: string; quantity: number; currentQuantity?: number | null; product: { id: string } | null; originalTotalSet: Money; discountAllocations?: Array<{ allocatedAmountSet: Money }> | null }>;
  };
  refunds?: Array<{ refundLineItems: { nodes: Array<{ lineItem: { id: string } | null; quantity: number; subtotalSet: Money }> } }> | null;
}

export type OrderLineStatus = "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED" | "PENDING" | "VOIDED";

/** Statuses that are not (or no longer) money — excluded from revenue, profit and order counts. */
export const EXCLUDED_ORDER_STATUSES: readonly OrderLineStatus[] = ["REFUNDED", "CANCELLED", "PENDING", "VOIDED"];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const toDate = (v: unknown): Date | null => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
/** Accepts a GID or a numeric REST id. */
const toGid = (kind: string, id: unknown): string | null => {
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) return `gid://shopify/${kind}/${id}`;
  return null;
};
/** REST money: the shop-currency `*_set.shop_money.amount` when present, else the plain amount. */
const restMoney = (set: unknown, plain: unknown) => {
  const amount = rec(rec(set).shop_money).amount;
  return amount !== undefined && amount !== null ? num(amount) : num(plain);
};
const gqlMoney = (m: Money) => num(m?.shopMoney?.amount);

function utmFromLandingSite(landing: unknown): ShopifyOrder["utm"] {
  const none = { source: null, campaign: null, content: null };
  if (typeof landing !== "string" || !landing) return none;
  try {
    const q = new URL(landing, "https://shop.invalid").searchParams;
    return { source: text(q.get("utm_source"), 200), campaign: text(q.get("utm_campaign"), 200), content: text(q.get("utm_content"), 200) };
  } catch {
    return none;
  }
}

/** Order JSON as delivered by orders/create, orders/updated, orders/paid and orders/cancelled webhooks. */
export function normalizeRestOrder(p: Rec): ShopifyOrder {
  const orderGid = toGid("Order", p.admin_graphql_api_id ?? p.id);
  if (!orderGid) throw new Error("Shopify order payload has no id");
  const refunds = new Map<string, { qty: number; amount: number }>();
  for (const refund of recs(p.refunds)) {
    for (const rl of recs(refund.refund_line_items)) {
      const lineId = toGid("LineItem", rl.line_item_id);
      if (!lineId) continue;
      const acc = refunds.get(lineId) ?? { qty: 0, amount: 0 };
      acc.qty += num(rl.quantity);
      acc.amount += restMoney(rl.subtotal_set, rl.subtotal);
      refunds.set(lineId, acc);
    }
  }
  const lines = recs(p.line_items).flatMap((li): ShopifyOrderLine[] => {
    const lineId = toGid("LineItem", li.admin_graphql_api_id ?? li.id);
    if (!lineId) return [];
    const quantity = Math.max(0, Math.trunc(num(li.quantity)));
    const discounts = recs(li.discount_allocations).reduce((s, d) => s + restMoney(d.amount_set, d.amount), 0);
    const r = refunds.get(lineId);
    return [
      {
        lineId,
        productGid: toGid("Product", li.product_id),
        quantity,
        currentQuantity: li.current_quantity === undefined || li.current_quantity === null ? null : Math.trunc(num(li.current_quantity)),
        refundedQuantity: r?.qty ?? 0,
        gross: round2(restMoney(li.price_set, li.price) * quantity - discounts),
        refunded: round2(r?.amount ?? 0),
      },
    ];
  });
  return {
    orderGid,
    createdAt: toDate(p.created_at) ?? new Date(),
    updatedAt: toDate(p.updated_at),
    currency: (text(p.currency, 3) ?? "USD").toUpperCase(),
    financialStatus: text(p.financial_status, 40)?.toLowerCase() ?? null,
    cancelled: !!p.cancelled_at,
    country: text(rec(p.shipping_address).country_code, 2)?.toUpperCase() ?? null,
    utm: utmFromLandingSite(p.landing_site),
    lines,
    complete: true,
  };
}

/** Order node from the Admin GraphQL API (sync and refund re-reads). */
export function normalizeGraphqlOrder(o: GraphqlOrderNode): ShopifyOrder {
  const refunds = new Map<string, { qty: number; amount: number }>();
  for (const refund of o.refunds ?? []) {
    for (const rl of refund.refundLineItems?.nodes ?? []) {
      if (!rl.lineItem?.id) continue;
      const acc = refunds.get(rl.lineItem.id) ?? { qty: 0, amount: 0 };
      acc.qty += num(rl.quantity);
      acc.amount += gqlMoney(rl.subtotalSet);
      refunds.set(rl.lineItem.id, acc);
    }
  }
  const utm = o.customerJourneySummary?.lastVisit?.utmParameters;
  return {
    orderGid: o.id,
    createdAt: toDate(o.createdAt) ?? new Date(),
    updatedAt: toDate(o.updatedAt),
    currency: (o.currencyCode || "USD").toUpperCase(),
    financialStatus: o.displayFinancialStatus ? o.displayFinancialStatus.toLowerCase() : null,
    cancelled: !!o.cancelledAt,
    country: null, // shipping address is protected customer data — not requested
    utm: { source: text(utm?.source, 200), campaign: text(utm?.campaign, 200), content: text(utm?.content, 200) },
    lines: o.lineItems.nodes.map((li) => {
      const r = refunds.get(li.id);
      const discounts = (li.discountAllocations ?? []).reduce((s, d) => s + gqlMoney(d.allocatedAmountSet), 0);
      return {
        lineId: li.id,
        productGid: li.product?.id ?? null,
        quantity: Math.max(0, Math.trunc(num(li.quantity))),
        currentQuantity: li.currentQuantity === undefined || li.currentQuantity === null ? null : Math.trunc(num(li.currentQuantity)),
        refundedQuantity: r?.qty ?? 0,
        gross: round2(gqlMoney(li.originalTotalSet) - discounts),
        refunded: round2(r?.amount ?? 0),
      };
    }),
    complete: !o.lineItems.pageInfo?.hasNextPage,
  };
}

export interface LineOutcome {
  status: OrderLineStatus;
  quantity: number;
  revenue: number;
  refunded: number;
}

/** Net quantity, net revenue and status of one line given the order's current state. */
export function lineOutcome(order: Pick<ShopifyOrder, "cancelled" | "financialStatus">, line: ShopifyOrderLine): LineOutcome {
  const refundedQty = Math.min(line.quantity, Math.max(0, line.refundedQuantity));
  let quantity = line.quantity - refundedQty;
  if (line.currentQuantity !== null) quantity = Math.min(quantity, Math.max(0, line.currentQuantity));
  const removedQty = line.quantity - refundedQty - quantity; // removed by an order edit without a refund
  const unit = line.quantity > 0 ? line.gross / line.quantity : 0;
  const revenue = round2(Math.max(0, line.gross - line.refunded - removedQty * unit));
  const fin = order.financialStatus;
  let status: OrderLineStatus;
  if (order.cancelled) status = "CANCELLED";
  else if (fin === "voided") status = "VOIDED";
  else if (fin === "pending" || fin === "authorized" || fin === "expired") status = "PENDING";
  else if (fin === "refunded" || (line.quantity > 0 && quantity === 0)) status = "REFUNDED";
  else if (refundedQty > 0 || line.refunded > 0) status = "PARTIALLY_REFUNDED";
  else status = "PAID";
  return { status, quantity, revenue, refunded: round2(line.refunded) };
}

export interface UpsertResult {
  lines: number;
  created: number;
  updated: number;
  removed: number;
  /** True when a newer version of this order was already stored — nothing changed. */
  stale?: boolean;
}

/**
 * Writes an order as one row per line item. Serialised per order (advisory lock), ignores deliveries
 * older than what is stored, updates existing lines in place, and removes rows for lines that no
 * longer exist (including legacy whole-order rows written before line-level crediting).
 */
export async function upsertShopifyOrder(db: Database, orgId: string, order: ShopifyOrder): Promise<UpsertResult> {
  if (!order.lines.length) return { lines: 0, created: 0, updated: 0, removed: 0 };
  const gids = [...new Set(order.lines.map((l) => l.productGid).filter((g): g is string => !!g))];
  const mapped = gids.length
    ? await db
        .select({ id: products.id, gid: products.shopifyProductId, cost: products.cost, ship: products.shippingCost })
        .from(products)
        .where(and(eq(products.organizationId, orgId), inArray(products.shopifyProductId, gids)))
    : [];
  const byGid = new Map(mapped.map((m) => [m.gid!, m]));

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shopify-order:${orgId}:${order.orderGid}`}))`);
    const existing = await tx
      .select({ id: orders.id, lineId: orders.externalLineId, sourceUpdatedAt: orders.sourceUpdatedAt })
      .from(orders)
      .where(and(eq(orders.organizationId, orgId), eq(orders.source, "SHOPIFY"), eq(orders.externalOrderId, order.orderGid)));
    const newest = existing.reduce<Date | null>((m, e) => (e.sourceUpdatedAt && (!m || e.sourceUpdatedAt > m) ? e.sourceUpdatedAt : m), null);
    if (newest && order.updatedAt && order.updatedAt < newest) return { lines: order.lines.length, created: 0, updated: 0, removed: 0, stale: true };

    const seen = new Set(order.lines.map((l) => l.lineId));
    // Legacy whole-order rows ('' line id) are always replaced; other unseen lines only when the payload is complete.
    const removedIds = existing.filter((e) => !seen.has(e.lineId) && (order.complete || e.lineId === "")).map((e) => e.id);
    if (removedIds.length) await tx.delete(orders).where(inArray(orders.id, removedIds));

    const had = new Set(existing.map((e) => e.lineId));
    let created = 0;
    let updated = 0;
    for (const line of order.lines) {
      const outcome = lineOutcome(order, line);
      const p = line.productGid ? byGid.get(line.productGid) : undefined;
      const values = {
        productId: p?.id ?? null,
        status: outcome.status,
        quantity: outcome.quantity,
        revenue: outcome.revenue,
        refundedAmount: outcome.refunded,
        cost: round2((p?.cost ?? 0) * outcome.quantity),
        shippingCost: round2((p?.ship ?? 0) * outcome.quantity),
        currency: order.currency,
        occurredAt: order.createdAt,
        sourceUpdatedAt: order.updatedAt,
      };
      // Attribution fields are only overwritten when this delivery carries them.
      const attribution = {
        ...(order.country ? { country: order.country } : {}),
        ...(order.utm.source ? { utmSource: order.utm.source } : {}),
        ...(order.utm.campaign ? { utmCampaign: order.utm.campaign } : {}),
        ...(order.utm.content ? { utmContent: order.utm.content } : {}),
      };
      await tx
        .insert(orders)
        .values({ organizationId: orgId, source: "SHOPIFY", externalOrderId: order.orderGid, externalLineId: line.lineId, ...values, ...attribution })
        .onConflictDoUpdate({
          target: [orders.organizationId, orders.source, orders.externalOrderId, orders.externalLineId],
          targetWhere: sql`external_order_id is not null`,
          set: { ...values, ...attribution, updatedAt: new Date() },
        });
      if (had.has(line.lineId)) updated++;
      else created++;
    }
    return { lines: order.lines.length, created, updated, removed: removedIds.length };
  });
}
