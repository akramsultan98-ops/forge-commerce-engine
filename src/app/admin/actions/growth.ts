"use server";

import { redirect } from "next/navigation";
import { LANDING_TEMPLATES, SECTION_TYPES, type LandingTemplate, type SectionType } from "@/lib/constants";
import { actionContext } from "@/server/auth/session";
import { act, formObject, str, type ActionState } from "@/server/actions/util";
import { addSection, applyTemplateLayout, moveSection, removeSection, setLandingPageStatus, updateLandingPageMeta, updateSection } from "@/server/services/landing-pages";
import { recordContentMetrics, updateContent } from "@/server/services/content";
import { publishContent } from "@/server/integrations/social";
import { createExperiment, createQuickExperiment, setExperimentStatus } from "@/server/services/experiments";
import { generateArticleIdeas, setArticleStatus, writeArticle } from "@/server/services/articles";
import { markRead } from "@/server/services/notifications";
import { executeCommand } from "@/server/command/executor";
import { cancelJob, retryJob } from "@/server/jobs/queue";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { ValidationError } from "@/server/errors";

// ── Landing page builder ─────────────────────────────────────────────────────
export async function updatePageMetaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("landing:write");
    await updateLandingPageMeta(ctx, str(fd, "id"), formObject(fd, ["id"]));
    return "Page settings saved.";
  });
}

/** Section editor: simple fields are submitted as `f:<name>`; list fields one item per line;
 *  structured lists (items/steps/rows/faq) as JSON in `json`. */
export async function updateSectionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("landing:write");
    const content: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("f:")) content[k.slice(2)] = v.trim();
      if (k.startsWith("l:")) content[k.slice(2)] = v.split("\n").map((s) => s.trim()).filter(Boolean);
    }
    const json = str(fd, "json");
    if (json) {
      try {
        Object.assign(content, JSON.parse(json));
      } catch {
        throw new ValidationError("Structured content must be valid JSON");
      }
    }
    await updateSection(ctx, str(fd, "sectionId"), { content, enabled: str(fd, "enabled") !== "off" });
    return "Section saved.";
  });
}

export async function sectionOpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("landing:write");
    const op = str(fd, "op");
    const id = str(fd, "sectionId");
    if (op === "up" || op === "down") await moveSection(ctx, id, op);
    else if (op === "remove") await removeSection(ctx, id);
    else if (op === "enable" || op === "disable") await updateSection(ctx, id, { enabled: op === "enable" });
    else if (op === "add") {
      const type = str(fd, "type") as SectionType;
      if (!(SECTION_TYPES as readonly string[]).includes(type)) throw new ValidationError("Unknown section type");
      await addSection(ctx, str(fd, "pageId"), type);
    } else if (op === "template") {
      const t = str(fd, "template") as LandingTemplate;
      if (!(LANDING_TEMPLATES as readonly string[]).includes(t)) throw new ValidationError("Unknown template");
      await applyTemplateLayout(ctx, str(fd, "pageId"), t);
    }
    return "Updated.";
  });
}

export async function pageStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("landing:write");
    const status = str(fd, "status") as "DRAFT" | "PUBLISHED" | "ARCHIVED";
    await setLandingPageStatus(ctx, str(fd, "id"), status);
    return status === "PUBLISHED" ? "Published — the page is live." : `Page set to ${status.toLowerCase()}.`;
  });
}

// ── Content ──────────────────────────────────────────────────────────────────
export async function updateContentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("content:write");
    const patch = formObject(fd, ["id"]);
    await updateContent(ctx, str(fd, "id"), patch);
    return "Content updated.";
  });
}

export async function recordMetricsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("content:write");
    await recordContentMetrics(ctx, str(fd, "id"), formObject(fd, ["id"]), "MANUAL", "manual");
    return "Metrics recorded (provenance: MANUAL).";
  });
}

export async function publishContentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("content:publish");
    const r = await publishContent(ctx, str(fd, "id"));
    return `Published (${r.externalId}).`;
  });
}

// ── Experiments ──────────────────────────────────────────────────────────────
export async function quickExperimentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("experiments:write");
    const type = str(fd, "type") as "HEADLINE" | "CTA" | "STRUCTURE";
    const challenger = str(fd, "challenger");
    if (type !== "STRUCTURE" && challenger.length < 2) throw new ValidationError("Enter the challenger text");
    const exp = await createQuickExperiment(ctx, str(fd, "pageId"), type, challenger);
    if (str(fd, "start") === "on") await setExperimentStatus(ctx, exp.id, "RUNNING");
    return "Experiment created.";
  });
}

export async function createExperimentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("experiments:write");
    let variants: unknown;
    try {
      variants = JSON.parse(str(fd, "variants"));
    } catch {
      throw new ValidationError("Variants must be valid JSON");
    }
    await createExperiment(ctx, { landingPageId: str(fd, "landingPageId"), name: str(fd, "name"), type: str(fd, "type"), hypothesis: str(fd, "hypothesis") || undefined, primaryMetric: str(fd, "primaryMetric") || "AFFILIATE_CTR", variants });
    return "Experiment created.";
  });
}

export async function experimentStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("experiments:write");
    await setExperimentStatus(ctx, str(fd, "id"), str(fd, "status") as "RUNNING" | "STOPPED" | "COMPLETED", str(fd, "winner") || undefined);
    return "Experiment updated.";
  });
}

// ── Editorial ────────────────────────────────────────────────────────────────
export async function articleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("content:write");
    const op = str(fd, "op");
    if (op === "ideas") {
      const r = await generateArticleIdeas(ctx);
      return `${r.created} new article ideas.`;
    }
    if (op === "write") {
      const r = await writeArticle(ctx, str(fd, "id"));
      return `Draft written via ${r.method === "AI" ? `AI (${r.model})` : "template engine"}.`;
    }
    if (op === "publish" || op === "unpublish") {
      await setArticleStatus(ctx, str(fd, "id"), op === "publish" ? "PUBLISHED" : "DRAFT");
      return op === "publish" ? "Published." : "Unpublished.";
    }
    throw new ValidationError("Unknown operation");
  });
}

// ── Notifications, jobs, command center ─────────────────────────────────────
export async function markReadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext();
    await markRead(ctx, str(fd, "id") || undefined);
    return "Marked as read.";
  });
}

export async function jobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("jobs:run");
    const id = Number(str(fd, "id"));
    if (str(fd, "op") === "retry") await retryJob(ctx.db, id);
    else await cancelJob(ctx.db, id);
    return "Job updated.";
  });
}

export async function runCommandAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("dashboard:read");
    const rl = rateLimit(`command:${ctx.userId}`, LIMITS.command.limit, LIMITS.command.windowMs);
    if (!rl.ok) throw new ValidationError("Slow down — too many commands in a minute.");
    const input = str(fd, "q").slice(0, 500);
    if (!input) throw new ValidationError("Type a command");
    const result = await executeCommand(ctx, input);
    return { message: result.reply, data: { result: result as unknown as Record<string, unknown>, jobId: result.job?.id ?? undefined } as Record<string, unknown> };
  });
}

export async function goToProduct(fd: FormData) {
  redirect(`/admin/products/${str(fd, "id")}`);
}
