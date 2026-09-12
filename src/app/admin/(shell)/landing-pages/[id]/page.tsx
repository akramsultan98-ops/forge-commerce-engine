import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { LANDING_TEMPLATES, SECTION_TYPES, type SectionType } from "@/lib/constants";
import { SECTION_LABELS, TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { categories, productReviews, products } from "@/server/db/schema";
import { getLandingPage } from "@/server/services/landing-pages";
import { primaryLinkFor, trackedUrl } from "@/server/services/affiliate";
import { makeT } from "@/i18n";
import { Badge, ButtonLink, EngineBadge, Field, Input, Mono, PageHeader, Panel, Select, Textarea } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { LandingRenderer } from "@/components/store/LandingRenderer";
import { pageStatusAction, quickExperimentAction, sectionOpAction, updatePageMetaAction, updateSectionAction } from "../../../actions/growth";

export const metadata = { title: "Landing page builder" };

type Kind = "text" | "long" | "list" | "json" | "mode";
const FIELDS: Record<SectionType, Array<[string, Kind]>> = {
  HERO: [["eyebrow", "text"], ["headline", "text"], ["subheadline", "long"], ["ctaLabel", "text"], ["secondaryLabel", "text"], ["imageUrl", "text"], ["videoUrl", "text"], ["badges", "list"]],
  PROBLEM: [["title", "text"], ["body", "long"], ["points", "list"]],
  SOLUTION: [["title", "text"], ["body", "long"]],
  BENEFITS: [["title", "text"], ["items", "json"]],
  FEATURES: [["title", "text"], ["items", "json"]],
  HOW_IT_WORKS: [["title", "text"], ["steps", "json"]],
  DEMO: [["title", "text"], ["body", "long"], ["videoUrl", "text"], ["imageUrl", "text"], ["caption", "text"]],
  COMPARISON: [["title", "text"], ["ourLabel", "text"], ["altLabel", "text"], ["rows", "json"]],
  SOCIAL_PROOF: [["title", "text"], ["mode", "mode"], ["points", "list"]],
  FAQ: [["title", "text"], ["items", "json"]],
  CTA: [["title", "text"], ["body", "long"], ["ctaLabel", "text"], ["note", "text"]],
  TRUST: [["title", "text"], ["items", "json"]],
  SHIPPING: [["title", "text"], ["body", "long"]],
  RETURNS: [["title", "text"], ["body", "long"]],
  DISCLOSURE: [["body", "long"]],
};

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("products:read");
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getLandingPage>>;
  try {
    data = await getLandingPage(ctx, id);
  } catch {
    notFound();
  }
  const { page, sections } = data;
  const [[product], link] = await Promise.all([ctx.db.select({ p: products, cat: categories }).from(products).leftJoin(categories, eq(categories.id, products.categoryId)).where(eq(products.id, page.productId)).limit(1), primaryLinkFor(ctx.db, page.productId)]);
  const reviews = await ctx.db.select().from(productReviews).where(eq(productReviews.productId, page.productId)).limit(6);
  const canEdit = can(ctx.role, "landing:write");
  const t = makeT("en");
  const p = product.p;

  return (
    <>
      <div className="mb-4 text-xs text-dim">
        <Link href="/admin/landing-pages" className="hover:text-haze">
          Landing pages
        </Link>{" "}
        / <span className="text-haze">{page.slug}</span>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {page.headline} <Badge tone={page.status === "PUBLISHED" ? "good" : "info"}>{page.status.toLowerCase()}</Badge> <EngineBadge method={page.generationMethod} model={page.model} />
          </span>
        }
        description={
          <>
            {TEMPLATE_LAYOUTS[page.template].label} · for{" "}
            <Link href={`/admin/products/${page.productId}`} className="text-fog underline decoration-edge-2 underline-offset-2">
              {p.title}
            </Link>{" "}
            · <Mono>/lp/{page.slug}</Mono> · canonical <Mono>{page.canonicalPath}</Mono>
          </>
        }
        actions={
          <>
            {page.status === "PUBLISHED" && (
              <ButtonLink href={`/lp/${page.slug}`} external size="sm" variant="ghost">
                Live page <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </ButtonLink>
            )}
            {canEdit &&
              (page.status === "PUBLISHED" ? ["DRAFT", "ARCHIVED"] : ["PUBLISHED"]).map((s) => (
                <ActionForm key={s} action={pageStatusAction} className="inline-block">
                  <input type="hidden" name="id" value={page.id} />
                  <input type="hidden" name="status" value={s} />
                  <SubmitButton size="sm" variant={s === "PUBLISHED" ? "primary" : "secondary"}>
                    {s === "PUBLISHED" ? "Publish" : s === "DRAFT" ? "Unpublish" : "Archive"}
                  </SubmitButton>
                </ActionForm>
              ))}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {canEdit && (
            <Panel title="Page settings & SEO">
              <ActionForm action={updatePageMetaAction} className="space-y-3">
                <input type="hidden" name="id" value={page.id} />
                <Field label="Headline" htmlFor="headline">
                  <Input id="headline" name="headline" defaultValue={page.headline} maxLength={140} />
                </Field>
                <Field label="Subheadline" htmlFor="subheadline">
                  <Textarea id="subheadline" name="subheadline" rows={2} defaultValue={page.subheadline ?? ""} maxLength={300} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`SEO title (${page.seoTitle.length}/70)`} htmlFor="seoTitle">
                    <Input id="seoTitle" name="seoTitle" defaultValue={page.seoTitle} maxLength={70} />
                  </Field>
                  <Field label="CTA label" htmlFor="ctaLabel">
                    <Input id="ctaLabel" name="ctaLabel" defaultValue={page.ctaLabel} maxLength={40} />
                  </Field>
                </div>
                <Field label={`Meta description (${page.metaDescription.length}/160)`} htmlFor="metaDescription">
                  <Textarea id="metaDescription" name="metaDescription" rows={2} defaultValue={page.metaDescription} maxLength={160} />
                </Field>
                <Field label="OpenGraph image URL" htmlFor="ogImage">
                  <Input id="ogImage" name="ogImage" defaultValue={page.ogImage ?? ""} placeholder="https://…" />
                </Field>
                <SubmitButton size="sm">Save settings</SubmitButton>
              </ActionForm>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-edge pt-4">
                <ActionForm action={sectionOpAction} className="flex items-end gap-2">
                  <input type="hidden" name="op" value="template" />
                  <input type="hidden" name="pageId" value={page.id} />
                  <Field label="Apply template layout" htmlFor="template" className="flex-1">
                    <Select id="template" name="template" defaultValue={page.template} options={LANDING_TEMPLATES.map((k) => ({ value: k, label: TEMPLATE_LAYOUTS[k].label }))} />
                  </Field>
                  <SubmitButton size="md" variant="secondary">
                    Apply
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={sectionOpAction} className="flex items-end gap-2">
                  <input type="hidden" name="op" value="add" />
                  <input type="hidden" name="pageId" value={page.id} />
                  <Field label="Add section" htmlFor="type" className="flex-1">
                    <Select id="type" name="type" options={SECTION_TYPES.map((s) => ({ value: s, label: SECTION_LABELS[s] }))} />
                  </Field>
                  <SubmitButton size="md" variant="secondary">
                    Add
                  </SubmitButton>
                </ActionForm>
              </div>
            </Panel>
          )}
          {sections.map((s, i) => (
            <Panel
              key={s.id}
              className={s.enabled ? "" : "opacity-60"}
              title={
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-dim">{String(i + 1).padStart(2, "0")}</span> {SECTION_LABELS[s.type]}
                  {!s.enabled && <Badge>hidden</Badge>}
                </span>
              }
              actions={
                canEdit && (
                  <div className="flex items-center gap-0.5">
                    {(
                      [
                        ["up", <ArrowUp key="u" aria-label="Move up" className="h-3.5 w-3.5" />],
                        ["down", <ArrowDown key="d" aria-label="Move down" className="h-3.5 w-3.5" />],
                        [s.enabled ? "disable" : "enable", s.enabled ? "Hide" : "Show"],
                        ["remove", "Remove"],
                      ] as const
                    ).map(([op, label]) => (
                      <ActionForm key={op} action={sectionOpAction}>
                        <input type="hidden" name="op" value={op} />
                        <input type="hidden" name="sectionId" value={s.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={op === "remove" ? "Remove this section?" : undefined}>
                          {label}
                        </SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                )
              }
            >
              {canEdit ? (
                <details>
                  <summary className="text-xs text-dim hover:text-haze">Edit content</summary>
                  <ActionForm action={updateSectionAction} className="mt-3 space-y-3">
                    <input type="hidden" name="sectionId" value={s.id} />
                    <input type="hidden" name="enabled" value={s.enabled ? "on" : "off"} />
                    {FIELDS[s.type].filter(([, k]) => k !== "json").map(([key, kind]) => {
                      const v = (s.content as Record<string, unknown>)[key];
                      const fid = `${s.id}-${key}`;
                      return (
                        <Field key={key} label={key} htmlFor={fid}>
                          {kind === "long" ? (
                            <Textarea id={fid} name={`f:${key}`} rows={3} defaultValue={String(v ?? "")} />
                          ) : kind === "list" ? (
                            <Textarea id={fid} name={`l:${key}`} rows={3} defaultValue={Array.isArray(v) ? v.join("\n") : ""} placeholder="One per line" />
                          ) : kind === "mode" ? (
                            <Select id={fid} name={`f:${key}`} defaultValue={String(v ?? "interest")} options={[{ value: "interest", label: "Why people are interested (default)" }, { value: "reviews", label: "Imported reviews (real, attributed only)" }]} />
                          ) : (
                            <Input id={fid} name={`f:${key}`} defaultValue={String(v ?? "")} />
                          )}
                        </Field>
                      );
                    })}
                    {FIELDS[s.type].some(([, k]) => k === "json") && (
                      <Field label="Structured items (JSON)" htmlFor={`${s.id}-json`} hint="Arrays of { title, body } / { q, a } / { label, ours, theirs }.">
                        <Textarea
                          id={`${s.id}-json`}
                          name="json"
                          rows={8}
                          className="font-mono text-[11px]"
                          defaultValue={JSON.stringify(Object.fromEntries(FIELDS[s.type].filter(([, k]) => k === "json").map(([key]) => [key, (s.content as Record<string, unknown>)[key] ?? []])), null, 2)}
                        />
                      </Field>
                    )}
                    <SubmitButton size="sm">Save section</SubmitButton>
                  </ActionForm>
                </details>
              ) : (
                <p className="text-xs text-dim">Read-only</p>
              )}
            </Panel>
          ))}
          {canEdit && (
            <Panel title="A/B test this page">
              <ActionForm action={quickExperimentAction} className="grid gap-3">
                <input type="hidden" name="pageId" value={page.id} />
                <Select name="type" aria-label="Test type" options={[{ value: "HEADLINE", label: "Headline" }, { value: "CTA", label: "CTA label" }, { value: "STRUCTURE", label: "Demo above the fold + shorter hero" }]} />
                <Input name="challenger" placeholder="Challenger text" maxLength={140} />
                <label className="flex items-center gap-2 text-sm text-haze">
                  <input type="checkbox" name="start" defaultChecked className="accent-s1" /> Start immediately
                </label>
                <SubmitButton size="sm">Create experiment</SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </div>
        <div className="2xl:sticky 2xl:top-20 2xl:self-start">
          <p className="eyebrow mb-2 text-dim">Preview</p>
          <div className="store max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border border-edge bg-paper text-ink [color-scheme:light] scrollbar-thin">
            <LandingRenderer
              sections={sections.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled, content: s.content as Record<string, unknown> }))}
              ctx={{
                title: p.title,
                slug: p.slug,
                imageUrl: p.imageUrl,
                categoryName: product.cat?.name ?? null,
                categoryIcon: product.cat?.icon ?? null,
                ctaHref: link ? trackedUrl(link.code) : null,
                ctaLabel: page.ctaLabel,
                unavailableLabel: "Not available yet",
                priceText: p.sellingPrice !== null ? formatMoney(p.sellingPrice, p.currency) : null,
                merchantNote: t("product.merchantNote"),
                sponsored: p.businessModel === "AFFILIATE",
                reviews,
                preview: true,
                labels: { problem: t("home.problemLabel"), howItWorks: t("product.howItWorks"), faq: t("product.faq"), shipping: t("product.shipping"), returns: t("product.returns"), disclosure: t("product.disclosure"), whyInterested: t("product.whyInterested") },
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
