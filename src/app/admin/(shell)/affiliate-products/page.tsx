import Link from "next/link";
import { PackageSearch, RefreshCw, Search } from "lucide-react";
import { AFFILIATE_PRODUCT_STATUSES, type AffiliateProductStatus } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { affiliateProviderStatus, affiliateStatusCounts, listAffiliateProducts } from "@/server/services/affiliate-products";
import { Badge, EmptyState, Field, Input, Mono, PageHeader, Panel, Select, Table, Tabs, Td, Th, btn } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { AvailabilityBadge, FreshnessBadge, LISTING_STATUS_LABEL, ListingStatusBadge } from "@/components/admin/listings";
import { ProductVisual } from "@/components/ProductVisual";
import { listingDiscoverAction, listingRefreshAction } from "../../actions/affiliate";

export const metadata = { title: "Network listings" };
const PAGE = 25;

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext("affiliate:read");
  const sp = await searchParams;
  const status = (AFFILIATE_PRODUCT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as AffiliateProductStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const sort = sp.sort === "score" || sp.sort === "fetched" ? sp.sort : "updated";
  const [{ items, total }, counts] = await Promise.all([
    listAffiliateProducts(ctx, {
      status,
      stale: sp.stale === "true" ? true : sp.stale === "false" ? false : undefined,
      hasError: sp.errors === "1" ? true : undefined,
      q: sp.q?.slice(0, 100) || undefined,
      sort,
      limit: PAGE,
      offset: (page - 1) * PAGE,
    }),
    affiliateStatusCounts(ctx),
  ]);
  const providers = affiliateProviderStatus();
  const canIngest = can(ctx.role, "affiliate:ingest");
  const all = Object.values(counts).reduce((s, n) => s + n, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/admin/affiliate-products${u.toString() ? `?${u}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Network listings"
        description="Products from affiliate networks arrive through the networks' official APIs (or n8n), are reviewed here, and reach the storefront only when a person publishes them. Network data is read-only and refreshed from the API; FORGE fields are yours to edit."
        actions={
          canIngest && (
            <ActionForm action={listingRefreshAction} className="inline-block">
              <SubmitButton variant="secondary" pendingText="Refreshing…">
                <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Refresh data older than 20 h
              </SubmitButton>
            </ActionForm>
          )
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {providers.map((p) => (
          <Panel
            key={p.network}
            title={p.label}
            subtitle={`${p.marketplaces.map((m) => m.name).join(", ")} · data may be shown for ${p.maxDataAgeHours === null ? "any time" : `${p.maxDataAgeHours} h`} after fetching`}
            actions={<Badge tone={p.configured ? "good" : "warning"}>{p.configured ? "configured" : "not configured"}</Badge>}
          >
            {p.configured ? (
              <p className="text-sm text-haze">
                Connected for <Mono>{p.marketplace}</Mono>. Credentials are read from the server environment only — never stored in the database or sent to the browser.
              </p>
            ) : (
              <div className="space-y-2 text-sm text-haze">
                <p>Set these server environment variables (values are never shown here):</p>
                <ul className="flex flex-wrap gap-1.5">
                  {p.missing.map((k) => (
                    <li key={k}>
                      <Mono>{k}</Mono>
                    </li>
                  ))}
                </ul>
                {p.problems.length > 0 && (
                  <ul className="list-disc space-y-1 ps-5 text-xs text-[#ff9b9b]">
                    {p.problems.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {p.warnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-warning">
                {p.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-fog underline decoration-edge-2 underline-offset-4 hover:decoration-fog">
              Official documentation ↗
            </a>
          </Panel>
        ))}
        {canIngest && (
          <Panel title="Discover through the official API" subtitle="Search results arrive as DISCOVERED listings for review">
            {providers.some((p) => p.configured) ? (
              <ActionForm action={listingDiscoverAction} className="grid grid-cols-2 gap-3">
                <Field label="Network" htmlFor="dnet">
                  <Select id="dnet" name="network" options={providers.filter((p) => p.configured).map((p) => ({ value: p.network, label: p.label }))} />
                </Field>
                <Field label="Category" htmlFor="dcat">
                  <Select id="dcat" name="category" options={(providers.find((p) => p.configured)?.marketplaces[0]?.categories ?? ["All"]).map((c) => ({ value: c, label: c }))} />
                </Field>
                <Field label="Keywords" htmlFor="dkw" className="col-span-2">
                  <Input id="dkw" name="keywords" required minLength={2} maxLength={200} placeholder="e.g. silicone food storage lids" />
                </Field>
                <div className="col-span-2">
                  <SubmitButton pendingText="Searching…">Search</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-dim">Configure a provider first. Listings can also be sent in by n8n through POST /api/v1/affiliate/products.</p>
            )}
          </Panel>
        )}
      </div>

      <Tabs
        items={[
          { href: qs({ status: undefined, page: undefined }), label: "All", active: !status, count: all },
          ...AFFILIATE_PRODUCT_STATUSES.map((s) => ({ href: qs({ status: s, page: undefined }), label: LISTING_STATUS_LABEL[s], active: status === s, count: counts[s] })),
        ]}
      />
      <form action="/admin/affiliate-products" className="my-5 flex flex-wrap items-end gap-3">
        {status && <input type="hidden" name="status" value={status} />}
        <Field label="Search" htmlFor="q" className="w-64">
          <Input id="q" name="q" defaultValue={sp.q ?? ""} maxLength={100} placeholder="Title, ASIN or brand" />
        </Field>
        <Field label="Data" htmlFor="stale" className="w-36">
          <Select
            id="stale"
            name="stale"
            defaultValue={sp.stale ?? ""}
            options={[
              { value: "", label: "Any age" },
              { value: "false", label: "Fresh" },
              { value: "true", label: "Stale" },
            ]}
          />
        </Field>
        <Field label="Problems" htmlFor="errors" className="w-44">
          <Select
            id="errors"
            name="errors"
            defaultValue={sp.errors ?? ""}
            options={[
              { value: "", label: "All listings" },
              { value: "1", label: "Refresh / check errors" },
            ]}
          />
        </Field>
        <Field label="Sort" htmlFor="sort" className="w-40">
          <Select
            id="sort"
            name="sort"
            defaultValue={sort}
            options={[
              { value: "updated", label: "Recently updated" },
              { value: "score", label: "Score" },
              { value: "fetched", label: "Oldest data first" },
            ]}
          />
        </Field>
        <button type="submit" className={btn("secondary")}>
          <Search aria-hidden className="h-3.5 w-3.5" /> Apply
        </button>
      </form>

      {items.length ? (
        <Table minWidth={1100}>
          <thead>
            <tr>
              <Th>Listing</Th>
              <Th>Marketplace</Th>
              <Th align="end">Price</Th>
              <Th>Availability</Th>
              <Th>Data</Th>
              <Th align="end">Score</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <ProductVisual title={l.title} slug={l.id} imageUrl={l.imageUrls[0] ?? null} categoryName={l.category} size="sm" className="h-10 w-10 shrink-0 rounded" />
                    <div className="min-w-0">
                      <Link href={`/admin/affiliate-products/${l.id}`} className="line-clamp-1 text-fog hover:underline">
                        {l.title}
                      </Link>
                      <p className="text-[11px] text-dim">
                        {l.externalIdType} <Mono>{l.externalId}</Mono>
                        {l.lastSyncError && <span className="ms-2 text-[#ff9b9b]">refresh error</span>}
                      </p>
                    </div>
                  </div>
                </Td>
                <Td className="text-xs">{l.marketplace}</Td>
                <Td align="end">{l.price !== null && l.currency ? formatMoney(l.price, l.currency) : "—"}</Td>
                <Td>
                  <AvailabilityBadge availability={l.availability} />
                </Td>
                <Td>
                  <FreshnessBadge fresh={l.fresh} ageHours={l.dataAgeHours} maxHours={l.maxDataAgeHours} />
                </Td>
                <Td align="end">{l.score !== null ? Math.round(l.score) : "—"}</Td>
                <Td>
                  <ListingStatusBadge status={l.status} />
                </Td>
                <Td className="text-xs">{formatRelative(l.updatedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState icon={PackageSearch} title={all ? "No listings match these filters" : "No network listings yet"}>
          {all ? "Clear the filters to see every listing." : "Search a configured network above, or send listings in from n8n with POST /api/v1/affiliate/products."}
        </EmptyState>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-xs text-dim">
          <span>
            {total} listings · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={qs({ page: String(page - 1) })} className={btn("ghost", "sm")}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={qs({ page: String(page + 1) })} className={btn("ghost", "sm")}>
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
