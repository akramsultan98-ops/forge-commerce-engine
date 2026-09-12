"use server";

import { actionContext } from "@/server/auth/session";
import { act, formObject, str, type ActionState } from "@/server/actions/util";
import { discoverAffiliateProducts, refreshAffiliateProducts, transitionAffiliateProduct, updateAffiliateProduct } from "@/server/services/affiliate-products";

const DONE: Record<string, string> = {
  submit: "Submitted for review.",
  approve: "Approved.",
  reject: "Rejected.",
  publish: "Published — the product is on the storefront.",
  unpublish: "Unpublished — the product is off the storefront.",
  archive: "Archived.",
  restore: "Restored to review.",
};

/** Lifecycle buttons post `action` (the clicked button) with the listing's id and the revision the page showed. */
export async function listingTransitionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("affiliate:read");
    const action = str(fd, "action");
    await transitionAffiliateProduct(ctx, str(fd, "id"), action, str(fd, "note") || null, { expectedRevision: Number(str(fd, "revision")) || undefined });
    return DONE[action] ?? "Updated.";
  });
}

/** FORGE-owned fields only; the service refuses network fields and stale revisions. */
export async function listingEditAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("affiliate:review");
    const { id, revision, ...fields } = formObject(fd);
    await updateAffiliateProduct(ctx, id ?? "", fields, Number(revision));
    return "Saved. A published listing's storefront page updates right away.";
  });
}

export async function listingDiscoverAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("affiliate:ingest");
    const r = await discoverAffiliateProducts(ctx, {
      network: str(fd, "network") || undefined,
      marketplace: str(fd, "marketplace") || undefined,
      keywords: str(fd, "keywords"),
      category: str(fd, "category") || undefined,
      limit: Number(str(fd, "limit")) || 10,
    });
    return `${r.found} found on ${r.marketplace} · ${r.created} new · ${r.updated} updated${r.errors.length ? ` · ${r.errors.length} skipped` : ""}.`;
  });
}

export async function listingRefreshAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("affiliate:ingest");
    const r = await refreshAffiliateProducts(ctx, { olderThanHours: str(fd, "all") === "on" ? 0 : 20, limit: 200 });
    const skipped = r.skipped.length ? ` · skipped ${r.skipped.map((s) => `${s.network}: ${s.reason}`).join("; ")}` : "";
    return `${r.checked} checked · ${r.refreshed} refreshed · ${r.synced} storefront pages updated · ${r.failed.length} failed${skipped}.`;
  });
}
