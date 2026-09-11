import { analyticsAgent, contentAgent, copywritingAgent, landingPageAgent, optimizationAgent, reportingAgent, researchAgent, scoringAgent, trendAgent } from "./agents";
import { orchestrator } from "./orchestrator";
import type { AgentDef } from "./runtime";

/** The agent roster. Adding an agent = implement AgentDef + register it here. */
export const AGENTS: AgentDef<never, unknown>[] = [
  orchestrator,
  researchAgent,
  trendAgent,
  scoringAgent,
  copywritingAgent,
  landingPageAgent,
  contentAgent,
  analyticsAgent,
  optimizationAgent,
  reportingAgent,
] as unknown as AgentDef<never, unknown>[];

export function agentByName(name: string) {
  return AGENTS.find((a) => a.name === name);
}
