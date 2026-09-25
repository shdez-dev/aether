import { NextRequest } from "next/server";

const forwardedHeaders = [
  "content-type",
  "cookie",
  "idempotency-key",
  "origin",
  "x-correlation-id",
  "x-csrf-token",
];

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const requestUrl = new URL(request.url);
  const apiUrl = new URL(
    `/v1/${path.join("/")}${requestUrl.search}`,
    process.env.AETHER_API_URL ?? "http://127.0.0.1:4000",
  );
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (!["GET", "HEAD"].includes(request.method))
    init.body = await request.arrayBuffer();
  const response = await fetch(apiUrl, init);
  const responseHeaders = new Headers();
  for (const name of ["content-type", "x-correlation-id"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
