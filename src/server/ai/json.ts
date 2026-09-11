import { z } from "zod";

/** Extracts the first JSON object from model text (tolerates code fences and prose around it). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
}

/** Instruction appended to prompts for providers without native schema-constrained output. */
export function schemaInstruction(schema: z.ZodType): string {
  return `Respond with ONLY a JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}`;
}
