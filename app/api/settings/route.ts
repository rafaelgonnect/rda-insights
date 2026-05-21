import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, setSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  model: z.string().min(1).optional(),
  maxTokens: z.number().int().min(50).max(4000).optional(),
  maxUsdMonth: z.number().positive().max(10000).optional(),
});

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const updated = await setSettings(parsed.data);
  return NextResponse.json(updated);
}
