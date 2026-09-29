import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const loginUrl =
    process.env.NODE_ENV === "production"
      ? new URL("/auth/login", request.url)
      : new URL(
          "/auth/login",
          process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
        );

  return NextResponse.redirect(loginUrl);
}
