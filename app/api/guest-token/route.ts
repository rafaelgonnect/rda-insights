import { NextResponse } from "next/server";
import { z } from "zod";
import { McpClient } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ dashboard_id: z.number().int().positive() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const { token, uuid } = await new McpClient().createGuestToken(parsed.data.dashboard_id);
    return NextResponse.json({ token, uuid });
  } catch (e) {
    console.error(JSON.stringify({ event: "guest_token.fail", err: String(e) }));
    return NextResponse.json({ error: "Failed to mint guest token" }, { status: 502 });
  }
}
