import { BUSINESS_MODELS, CURRENCIES } from "@/lib/constants";
import type { Category, Product } from "@/server/db/schema";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select, Textarea } from "./ui";

type Action = (prev: { ok: boolean; message?: string; error?: string } | null, fd: FormData) => Promise<{ ok: boolean; message?: string; error?: string } | null>;

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const LOCKED_HINT = "From the network listing — edit it on the listing";

/**
 * Product facts editor. Every changed metric is stored with MANUAL provenance and triggers a re-score.
 * `locked` fields (a product published from a network listing) are shown disabled and not submitted.
 */
export function ProductForm({ action, product, categories, submitLabel, locked = [] }: { action: Action; product?: Product; categories: Category[]; submitLabel: string; locked?: readonly string[] }) {
  const p = product;
  const lock = (k: string) => locked.includes(k);
  const hint = (k: string, h?: string) => (lock(k) ? LOCKED_HINT : h);
  return (
    <ActionForm action={action} className="space-y-8">
      {p && <input type="hidden" name="id" value={p.id} />}
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="eyebrow mb-3 text-dim">Basics</legend>
        <Field label="Title" htmlFor="title" className="md:col-span-2" hint={hint("title")}>
          <Input id="title" name="title" required minLength={3} maxLength={200} defaultValue={p?.title} disabled={lock("title")} />
        </Field>
        <Field label="Problem it solves" htmlFor="problemSolved" hint={hint("problemSolved", "Phrase it so it reads after “fixes …”, e.g. “charging cables falling behind the desk”.")}>
          <Input id="problemSolved" name="problemSolved" maxLength={300} defaultValue={p?.problemSolved ?? ""} disabled={lock("problemSolved")} />
        </Field>
        <Field label="Target audience" htmlFor="targetAudience" hint={hint("targetAudience")}>
          <Input id="targetAudience" name="targetAudience" maxLength={300} defaultValue={p?.targetAudience ?? ""} disabled={lock("targetAudience")} />
        </Field>
        <Field label="Description" htmlFor="description" className="md:col-span-2" hint={hint("description")}>
          <Textarea id="description" name="description" rows={3} maxLength={5000} defaultValue={p?.description ?? ""} disabled={lock("description")} />
        </Field>
        <Field label="Verified highlights (one per line)" htmlFor="highlights" hint={hint("highlights", "Only facts you can back up — copy generation uses these.")} className="md:col-span-2">
          <Textarea id="highlights" name="highlights" rows={3} defaultValue={p?.highlights.join("\n") ?? ""} disabled={lock("highlights")} />
        </Field>
        <Field label="Category" htmlFor="categoryId" hint={hint("categoryId")}>
          <Select id="categoryId" name="categoryId" defaultValue={p?.categoryId ?? ""} disabled={lock("categoryId")} options={[{ value: "", label: "—" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>
        <Field label="Brand" htmlFor="brand" hint={hint("brand")}>
          <Input id="brand" name="brand" maxLength={120} defaultValue={p?.brand ?? ""} disabled={lock("brand")} />
        </Field>
        <Field label="Business model" htmlFor="businessModel">
          <Select id="businessModel" name="businessModel" defaultValue={p?.businessModel ?? "AFFILIATE"} options={BUSINESS_MODELS.map((m) => ({ value: m, label: m.replace("_", " ").toLowerCase() }))} />
        </Field>
        <Field label="Tags (one per line)" htmlFor="tags" hint={hint("tags")}>
          <Textarea id="tags" name="tags" rows={2} defaultValue={p?.tags.join("\n") ?? ""} disabled={lock("tags")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="eyebrow mb-3 text-dim">Economics</legend>
        <Field label="Currency" htmlFor="currency" hint={hint("currency")}>
          <Select id="currency" name="currency" defaultValue={p?.currency ?? "USD"} disabled={lock("currency")} options={(p && !(CURRENCIES as readonly string[]).includes(p.currency) ? [p.currency, ...CURRENCIES] : CURRENCIES).map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Selling price" htmlFor="sellingPrice" hint={hint("sellingPrice")}>
          <Input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={num(p?.sellingPrice)} disabled={lock("sellingPrice")} />
        </Field>
        <Field label="Supplier cost" htmlFor="cost">
          <Input id="cost" name="cost" inputMode="decimal" defaultValue={num(p?.cost)} />
        </Field>
        <Field label="Shipping cost" htmlFor="shippingCost">
          <Input id="shippingCost" name="shippingCost" inputMode="decimal" defaultValue={num(p?.shippingCost)} />
        </Field>
        <Field label="Commission %" htmlFor="commissionPercentage" hint={hint("commissionPercentage")}>
          <Input id="commissionPercentage" name="commissionPercentage" inputMode="decimal" defaultValue={num(p?.commissionPercentage)} disabled={lock("commissionPercentage")} />
        </Field>
        <Field label="Flat commission" htmlFor="affiliateCommission">
          <Input id="affiliateCommission" name="affiliateCommission" inputMode="decimal" defaultValue={num(p?.affiliateCommission)} />
        </Field>
        <Field label="Shipping days (min)" htmlFor="shippingDaysMin">
          <Input id="shippingDaysMin" name="shippingDaysMin" inputMode="numeric" defaultValue={num(p?.shippingDaysMin)} />
        </Field>
        <Field label="Shipping days (max)" htmlFor="shippingDaysMax">
          <Input id="shippingDaysMax" name="shippingDaysMax" inputMode="numeric" defaultValue={num(p?.shippingDaysMax)} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="eyebrow mb-3 text-dim">Links</legend>
        <Field label="Affiliate URL" htmlFor="affiliateUrl" hint={hint("affiliateUrl")}>
          <Input id="affiliateUrl" name="affiliateUrl" type="url" defaultValue={p?.affiliateUrl ?? ""} placeholder="https://…" disabled={lock("affiliateUrl")} />
        </Field>
        <Field label="Product / store URL" htmlFor="productUrl" hint={hint("productUrl")}>
          <Input id="productUrl" name="productUrl" type="url" defaultValue={p?.productUrl ?? ""} placeholder="https://…" disabled={lock("productUrl")} />
        </Field>
        <Field label="Supplier URL" htmlFor="supplierUrl">
          <Input id="supplierUrl" name="supplierUrl" type="url" defaultValue={p?.supplierUrl ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Image URL" htmlFor="imageUrl" hint={hint("imageUrl", "Use the supplier's or merchant's real product image.")}>
          <Input id="imageUrl" name="imageUrl" type="url" defaultValue={p?.imageUrl ?? ""} placeholder="https://…" disabled={lock("imageUrl")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="eyebrow mb-1 text-dim">Market signals</legend>
        <p className="mb-2 text-xs text-dim md:col-span-4">Enter only what you have. Missing signals are held neutral and reduce confidence — never guess sales numbers.</p>
        <Field label="Rating (0–5)" htmlFor="rating" hint={hint("rating")}>
          <Input id="rating" name="rating" inputMode="decimal" defaultValue={num(p?.rating)} disabled={lock("rating")} />
        </Field>
        <Field label="Review count" htmlFor="reviewCount" hint={hint("reviewCount")}>
          <Input id="reviewCount" name="reviewCount" inputMode="numeric" defaultValue={num(p?.reviewCount)} disabled={lock("reviewCount")} />
        </Field>
        <Field label="Est. monthly sales" htmlFor="estimatedSales">
          <Input id="estimatedSales" name="estimatedSales" inputMode="numeric" defaultValue={num(p?.estimatedSales)} />
        </Field>
        <Field label="Sellers competing" htmlFor="sellerCount">
          <Input id="sellerCount" name="sellerCount" inputMode="numeric" defaultValue={num(p?.sellerCount)} />
        </Field>
        <Field label="Trend keyword (Wikipedia article)" htmlFor="trendKeyword" className="md:col-span-2" hint="Enables REAL interest signals from the Wikimedia Pageviews API.">
          <Input id="trendKeyword" name="trendKeyword" maxLength={200} defaultValue={p?.trendKeyword ?? ""} placeholder="e.g. Cable management" />
        </Field>
        <Field label="Countries (one per line, ISO codes)" htmlFor="countriesAvailable" className="md:col-span-2" hint={hint("countriesAvailable")}>
          <Textarea id="countriesAvailable" name="countriesAvailable" rows={2} defaultValue={p?.countriesAvailable.join("\n") ?? ""} disabled={lock("countriesAvailable")} />
        </Field>
        {(
          [
            ["trendScore", "Trend (0–100)"],
            ["competitionScore", "Competition (0–100)"],
            ["contentScore", "Content potential"],
            ["problemScore", "Problem strength"],
            ["impulseScore", "Impulse appeal"],
            ["noveltyScore", "Novelty"],
            ["saturationScore", "Ad saturation"],
            ["adActivity", "Ad activity"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label} htmlFor={k}>
            <Input id={k} name={k} inputMode="decimal" defaultValue={num(p?.[k] as number | null | undefined)} />
          </Field>
        ))}
      </fieldset>
      <div className="flex items-center gap-3 border-t border-edge pt-5">
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        <p className="text-xs text-dim">Changed metrics are recorded as MANUAL provenance and the product is re-scored.</p>
      </div>
    </ActionForm>
  );
}
