import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  // In production, Caddy routes /auth/* directly to the API. Local Next.js
  // development has no gateway, so send this backend-only endpoint to the API.
  if (process.env.NODE_ENV === "production")
    return new Response(null, { status: 404 });

  const apiUrl = new URL(
    "/auth/register",
    process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
  );
  return NextResponse.redirect(apiUrl);
}
