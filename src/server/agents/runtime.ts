// Agent runtime: every agent execution is recorded in agent_runs with input, output, logs,
// duration and the tokens/cost of any AI calls it made (joined from ai_usage by run id).

import { eq, sql } from "drizzle-orm";
import type { ServiceContext } from "../context";
import { agentRuns, aiUsage } from "../db/schema";
import { captureException } from "../errors";

export type AgentName =
  | "orchestrator"
  | "research"
  | "trend"
  | "scoring"
  | "copywriting"
  | "landing_page"
  | "content"
  | "analytics"
  | "optimization"
  | "reporting";

export interface AgentContext extends ServiceContext {
  runId: string;
  parentRunId: string | null;
  step: (msg: string, level?: "info" | "warn") => void;
}

export interface AgentDef<I, O> {
  name: AgentName;
  title: string;
  description: string;
  /** Model tier this agent uses when AI is available ("none" = deterministic). */
  tier: "fast" | "strong" | "none";
  run(ctx: AgentContext, input: I): Promise<O>;
}

export interface RunOptions {
  parentRunId?: string | null;
  productId?: string | null;
}

function compact(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  return json.length > 200_000 ? { truncated: true, preview: json.slice(0, 2000) } : value;
}

export async function runAgent<I, O>(ctx: ServiceContext, agent: AgentDef<I, O>, input: I, opts: RunOptions = {}): Promise<{ runId: string; output: O }> {
  const started = Date.now();
  const [run] = await ctx.db
    .insert(agentRuns)
    .values({ organizationId: ctx.orgId, agent: agent.name, parentRunId: opts.parentRunId ?? null, productId: opts.productId ?? null, triggeredBy: ctx.userId, input: compact(input) })
    .returning({ id: agentRuns.id });
  const logs: Array<{ at: string; level: string; msg: string }> = [];
  const actx: AgentContext = {
    ...ctx,
    actor: ctx.actor === "user" ? "user" : "agent",
    runId: run.id,
    parentRunId: opts.parentRunId ?? null,
    step: (msg, level = "info") => {
      logs.push({ at: new Date().toISOString(), level, msg });
      ctx.log[level](`[${agent.name}] ${msg}`);
    },
  };
  const usage = async () => {
    const [u] = await ctx.db
      .select({
        inTok: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outTok: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        cost: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)::float8`,
        provider: sql<string | null>`max(${aiUsage.provider})`,
        model: sql<string | null>`max(${aiUsage.model})`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.agentRunId, run.id));
    return u;
  };
  try {
    const output = await agent.run(actx, input);
    const u = await usage();
    await ctx.db
      .update(agentRuns)
      .set({
        status: "succeeded",
        output: compact(output),
        logs,
        durationMs: Date.now() - started,
        finishedAt: new Date(),
        inputTokens: Number(u?.inTok ?? 0),
        outputTokens: Number(u?.outTok ?? 0),
        costUsd: Number(u?.cost ?? 0),
        provider: u?.provider ?? null,
        model: u?.model ?? null,
        generationMethod: u?.provider ? (u.provider === "template" ? "TEMPLATE" : "AI") : null,
      })
      .where(eq(agentRuns.id, run.id));
    return { runId: run.id, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push({ at: new Date().toISOString(), level: "error", msg: message });
    await ctx.db.update(agentRuns).set({ status: "failed", error: message.slice(0, 4000), logs, durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(agentRuns.id, run.id));
    captureException(err, { agent: agent.name, runId: run.id });
    throw err;
  }
}
