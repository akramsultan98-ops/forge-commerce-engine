import { pageContext } from "@/server/auth/session";
import { resolveEngine } from "@/server/ai/service";
import { COMMAND_EXAMPLES } from "@/server/command/parser";
import { Callout, PageHeader, Panel } from "@/components/admin/ui";
import { CommandConsole } from "@/components/admin/CommandConsole";
import { runCommandAction } from "../../actions/growth";

export const metadata = { title: "Command center" };

export default async function CommandPage() {
  const ctx = await pageContext("dashboard:read");
  const engine = await resolveEngine(ctx, "command");
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Command center"
        description="Ask in plain language. FORGE translates each request into database queries or background agent jobs — nothing long-running happens inside the request."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <CommandConsole action={runCommandAction} examples={COMMAND_EXAMPLES} />
        </Panel>
        <div className="space-y-4">
          <Panel title="How commands run">
            <ol className="list-decimal space-y-2 ps-4 text-xs leading-relaxed text-haze">
              <li>A deterministic rule parser recognises the intent (free, instant).</li>
              <li>If it can’t, an AI intent model classifies it — only when an AI provider is configured.</li>
              <li>Queries answer immediately; generation (pages, content, launch kits) is queued as a job you can watch.</li>
              <li>Viewers can ask questions; only operators and admins can start agents.</li>
            </ol>
          </Panel>
          <Callout tone={engine.engine === "AI" ? "info" : "warning"} title={engine.engine === "AI" ? `AI fallback: ${engine.provider} · ${engine.model}` : "AI fallback unavailable"}>
            {engine.engine === "AI" ? "Unrecognised commands are classified by the fast-tier model." : `${engine.reason}. The rule parser still handles every example command.`}
          </Callout>
        </div>
      </div>
    </>
  );
}
