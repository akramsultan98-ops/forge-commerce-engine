import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { BUSINESS_MODELS, PRODUCT_STATUSES, type ProductStatus } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatPercent, round } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { listProducts, statusCounts } from "@/server/services/products";
import { listCategories } from "@/server/services/catalog";
import { Badge, ButtonLink, DemoTag, EmptyState, Input, PageHeader, ProvenanceBadge, Select, StatusBadge, Table, Tabs, Td, Th, btn } from "@/components/admin/ui";
import { ProductVisual } from "@/components/ProductVisual";
import { ScoreMeter } from "@/components/charts/marks";

export const metadata = { title: "Products" };
const PAGE = 25;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext("products:read");
  const sp = await searchParams;
  const status = (PRODUCT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ProductStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [{ items, total }, counts, cats] = await Promise.all([
    listProducts(ctx, {
      status,
      q: sp.q?.slice(0, 100) || undefined,
      categoryId: sp.category || undefined,
      businessModel: sp.model || undefined,
      sort: (["score", "recent", "price", "title"].includes(sp.sort ?? "") ? sp.sort : "score") as "score",
      limit: PAGE,
      offset: (page - 1) * PAGE,
    }),
    statusCounts(ctx),
    listCategories(ctx),
  ]);
  const all = Object.values(counts).reduce((s, n) => s + n, 0);
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/admin/products${u.toString() ? `?${u}` : ""}`;
  };
  const catIcon = new Map(cats.map((c) => [c.id, c.icon]));

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Product database"
        description="Every product FORGE knows about, ranked by its explainable score. Each metric carries its provenance — live, estimate, AI inference, operator input or demo."
        actions={
          can(ctx.role, "products:write") && (
            <>
              <ButtonLink href="/admin/products/discover">Import / discover</ButtonLink>
              <ButtonLink href="/admin/products/new" variant="primary">
                <Plus aria-hidden className="h-4 w-4" /> Add product
              </ButtonLink>
            </>
          )
        }
      />
      <Tabs
        items={[
          { href: qs({ status: undefined, page: undefined }), label: "All", active: !status, count: all },
          ...PRODUCT_STATUSES.filter((s) => s !== "ARCHIVED" || counts.ARCHIVED > 0).map((s) => ({ href: qs({ status: s, page: undefined }), label: s[0] + s.slice(1).toLowerCase(), active: status === s, count: counts[s] })),
        ]}
      />
      <form method="get" className="my-5 flex flex-wrap items-end gap-3" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-dim" />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search title, description, brand…" className="ps-9" aria-label="Search products" />
        </div>
        <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className="w-44" options={[{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select name="model" defaultValue={sp.model ?? ""} aria-label="Business model" className="w-40" options={[{ value: "", label: "All models" }, ...BUSINESS_MODELS.map((m) => ({ value: m, label: m.replace("_", " ").toLowerCase() }))]} />
        <Select name="sort" defaultValue={sp.sort ?? "score"} aria-label="Sort" className="w-36" options={[{ value: "score", label: "Top scored" }, { value: "recent", label: "Newest" }, { value: "price", label: "Price" }, { value: "title", label: "A–Z" }]} />
        <button type="submit" className={btn("secondary")}>
          Apply
        </button>
      </form>

      {items.length ? (
        <Table minWidth={1100}>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Status</Th>
              <Th>Score</Th>
              <Th>Model</Th>
              <Th align="end">Price</Th>
              <Th align="end">Margin</Th>
              <Th>Trend</Th>
              <Th>Risk</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-panel-2/50">
                <Td>
                  <div className="flex items-center gap-3">
                    <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} categoryIcon={p.categoryId ? catIcon.get(p.categoryId) : null} size="sm" className="h-10 w-10 shrink-0 rounded" />
                    <div className="min-w-0">
                      <Link href={`/admin/products/${p.id}`} className="block max-w-[22rem] truncate font-medium text-fog hover:underline">
                        {p.title}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
                        {p.categoryName ?? "Uncategorised"} · {p.source.toLowerCase().replace(/_/g, " ")}
                        {p.isDemo && <DemoTag />}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
                <Td className="w-44">
                  <div className="flex items-center gap-2">
                    <span className="tabular w-8 font-semibold text-fog">{p.overallScore === null ? "—" : Math.round(p.overallScore)}</span>
                    <ScoreMeter value={p.overallScore} className="w-20" />
                  </div>
                  <div className="mt-1 text-[11px] text-dim">conf. {p.scoreConfidence === null ? "—" : round(p.scoreConfidence, 2)}</div>
                </Td>
                <Td className="text-xs">{p.businessModel.replace("_", " ").toLowerCase()}</Td>
                <Td align="end">{p.sellingPrice === null ? "—" : formatMoney(p.sellingPrice, p.currency)}</Td>
                <Td align="end">{p.estimatedMargin === null ? "—" : formatPercent(p.estimatedMargin / 100, 0)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-fog">{p.trendScore === null ? "—" : Math.round(p.trendScore)}</span>
                    {p.trendScore !== null && <ProvenanceBadge p={p.fieldProvenance?.trendScore?.p} compact />}
                  </div>
                </Td>
                <Td>{p.riskLevel ? <Badge tone={p.riskLevel === "HIGH" ? "critical" : p.riskLevel === "MEDIUM" ? "warning" : "neutral"}>{p.riskLevel.toLowerCase()}</Badge> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No products match" action={<ButtonLink href="/admin/products/discover">Import or discover products</ButtonLink>}>
          Try clearing filters, importing a CSV feed or running discovery.
        </EmptyState>
      )}
      {total > PAGE && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-xs text-dim">
          <span>
            {(page - 1) * PAGE + 1}–{Math.min(total, page * PAGE)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className={btn("secondary", "sm")} href={qs({ page: String(page - 1) })}>
                Previous
              </Link>
            )}
            {page * PAGE < total && (
              <Link className={btn("secondary", "sm")} href={qs({ page: String(page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
