import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { revokeSession } from "@/server/auth/core";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("forge_session")?.value;
  if (token) await revokeSession(getDb(), token);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.delete("forge_session");
  return res;
}
