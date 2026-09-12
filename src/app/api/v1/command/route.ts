import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { executeCommand } from "@/server/command/executor";
import { ValidationError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** POST /api/v1/command — { "input": "Which product should I scale?" } */
export const POST = apiRoute({ permission: "dashboard:read", limit: "command" }, async (req, ctx) => {
  const parsed = z.object({ input: z.string().trim().min(1).max(500) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("`input` is required (max 500 chars)");
  return executeCommand(ctx, parsed.data.input);
});
