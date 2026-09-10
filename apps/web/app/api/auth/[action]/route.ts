import { NextRequest } from "next/server";

const forwardedHeaders = ["content-type", "cookie", "origin", "x-csrf-token"];

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!["session", "logout"].includes(action))
    return new Response(null, { status: 404 });
  const url = new URL(
    `/auth/${action}`,
    process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
  );
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(url, { method: request.method, headers });
  const responseHeaders = new Headers();
  for (const name of ["content-type", "x-correlation-id", "set-cookie"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
