import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.redirect(
    new URL(
      "/auth/register",
      process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
    ),
  );
}
