import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { isDemoMode } from "@/server/env";
import { Badge, DemoTag, EmptyState, Mono, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";

export const metadata = { title: "Campaigns" };

type Row = {
  id: string;
  name: string;
  product_id: string | null;
  product_title: string | null;
  platform: string;
  status: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  budget: number | null;
  spend: number;
  is_demo: boolean;
  content_items: number;
  visits: number;
  clicks: number;
  conversions: number;
  commission: number;
};

export default async function CampaignsPage() {
  const ctx = await pageContext("analytics:read");
  const res = await ctx.db.execute(sql`
    select c.id, c.name, c.product_id, p.title as product_title, c.platform, c.status, c.utm_source, c.utm_medium, c.utm_campaign,
           c.budget::float8 as budget, c.spend::float8 as spend, c.is_demo,
           (select count(*) from content ct where ct.campaign_id = c.id)::int as content_items,
           (select count(*) from click_events e where e.campaign_id = c.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false)::int as visits,
           (select count(*) from click_events e where e.campaign_id = c.id and e.event_type in ('AFFILIATE_CLICK','PRODUCT_CLICK') and e.is_bot = false)::int as clicks,
           (select count(*) from conversion_events cv where cv.campaign_id = c.id)::int as conversions,
           (select coalesce(sum(commission), 0) from conversion_events cv where cv.campaign_id = c.id)::float8 as commission
    from campaigns c left join products p on p.id = c.product_id
    where c.organization_id = ${ctx.orgId} ${isDemoMode() ? sql`` : sql`and c.is_demo = false`}
    order by c.created_at desc`);
  const rows = res.rows as unknown as Row[];
  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Campaigns"
        description="One campaign per product × platform, created automatically with content. UTM parameters (source / medium / campaign) attribute every visit; utm_content identifies the exact post."
      />
      <Panel bodyClassName="p-0">
        {rows.length ? (
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Status</Th>
                <Th>UTM</Th>
                <Th align="end">Content</Th>
                <Th align="end">Visits</Th>
                <Th align="end">Clicks</Th>
                <Th align="end">CTR</Th>
                <Th align="end">Conv.</Th>
                <Th align="end">Spend</Th>
                <Th align="end">Commission</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <p className="text-fog">{r.name}</p>
                    {r.product_id && (
                      <Link href={`/admin/products/${r.product_id}`} className="text-xs text-dim hover:text-haze">
                        {r.product_title}
                      </Link>
                    )}{" "}
                    {r.is_demo && <DemoTag />}
                  </Td>
                  <Td>
                    <Badge tone={r.status === "ACTIVE" ? "good" : r.status === "PAUSED" ? "warning" : "neutral"}>{r.status.toLowerCase()}</Badge>
                  </Td>
                  <Td>
                    <Mono>
                      {r.utm_source}/{r.utm_medium}/{r.utm_campaign}
                    </Mono>
                  </Td>
                  <Td align="end">{r.content_items}</Td>
                  <Td align="end">{formatNumber(r.visits)}</Td>
                  <Td align="end">{formatNumber(r.clicks)}</Td>
                  <Td align="end">{formatPercent(r.visits ? r.clicks / r.visits : 0)}</Td>
                  <Td align="end">{formatNumber(r.conversions)}</Td>
                  <Td align="end">{formatMoney(r.spend, "USD")}</Td>
                  <Td align="end">{formatMoney(r.commission, "USD")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={Megaphone} title="No campaigns yet">
              Campaigns are created when content is generated for a product.
            </EmptyState>
          </div>
        )}
      </Panel>
    </>
  );
}
