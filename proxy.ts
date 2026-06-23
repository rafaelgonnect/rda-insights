import { NextResponse, type NextRequest } from "next/server";
import { validateBasicAuth } from "@/lib/auth";

// Next.js 16: `middleware.ts` is deprecated and renamed to `proxy.ts`.
// Runs on the Edge runtime — use Web APIs only (atob, btoa, TextEncoder).

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };

export function proxy(req: NextRequest) {
  if (!validateBasicAuth(req.headers.get("authorization"))) {
    return new NextResponse("Auth required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Colab Insights"' },
    });
  }
  return NextResponse.next();
}
