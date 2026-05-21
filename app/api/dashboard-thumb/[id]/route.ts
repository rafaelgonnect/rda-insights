// Thumbnail proxy for Superset dashboard images.
//
// Strategy: accept ?path=<urlencoded-superset-path> and forward the request to
// Superset with Bearer auth. Using the path as a query param (rather than
// round-tripping to fetch the digest) keeps the proxy simple and cacheable.
// A strict allowlist prevents open-proxy abuse.
//
// Next.js 16 App Router: `params` is a Promise and must be awaited.

import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only proxy Superset dashboard thumbnail paths.
const ALLOWED_PATH = /^\/api\/v1\/dashboard\/\d+\/thumbnail\/[a-f0-9]+\/?$/;

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  // id is unused at runtime but keeps the route file in the right directory.
  await props.params;

  const { searchParams } = new URL(req.url);
  const rawPath = searchParams.get("path");

  if (!rawPath) {
    return NextResponse.json({ error: "missing path param" }, { status: 400 });
  }

  // Security: only allow Superset thumbnail paths.
  if (!ALLOWED_PATH.test(rawPath)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  // We need a valid Bearer token. Re-use McpClient's auth machinery via a
  // small trick: fetchJson is private, so we use the public executeSql surface
  // as a warm-up is wasteful — instead, we call the Superset URL directly
  // after obtaining a token via the internal login helper exposed via a one-off
  // fetch, mirroring what fetchJson does.
  //
  // Simpler: just fetch the thumbnail URL directly with credentials from env.
  const baseUrl = env.SUPERSET_INTERNAL_URL ?? env.SUPERSET_URL;

  // Login to get a Bearer token.
  let accessToken: string;
  try {
    const loginRes = await fetch(`${baseUrl}/api/v1/security/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: env.SUPERSET_USERNAME,
        password: env.SUPERSET_PASSWORD,
        provider: "db",
        refresh: true,
      }),
    });
    if (!loginRes.ok) {
      return NextResponse.json({ error: "superset auth failed" }, { status: 502 });
    }
    const loginJson = (await loginRes.json()) as { access_token: string };
    accessToken = loginJson.access_token;
  } catch {
    return NextResponse.json({ error: "superset unreachable" }, { status: 502 });
  }

  // Fetch the thumbnail binary.
  try {
    const thumbRes = await fetch(`${baseUrl}${rawPath}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        referer: baseUrl,
      },
    });

    if (!thumbRes.ok) {
      return NextResponse.json({ error: `superset ${thumbRes.status}` }, { status: thumbRes.status });
    }

    const contentType = thumbRes.headers.get("content-type") ?? "image/png";
    const data = await thumbRes.arrayBuffer();

    return new Response(data, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "failed to fetch thumbnail" }, { status: 502 });
  }
}

