import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  // El gateway de producción entrega /auth/* directamente a la API.
  if (process.env.NODE_ENV === "production")
    return new Response(null, { status: 404 });

  const apiUrl = new URL(
    "/auth/identity-logout",
    process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
  );
  return NextResponse.redirect(apiUrl);
}
