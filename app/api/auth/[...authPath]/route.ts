const oaBaseUrl = (process.env.OA_API_BASE_URL ?? "https://oa.geekforest.ai").replace(/\/$/, "");

type AuthRouteContext = {
  params?: { authPath?: string[] } | Promise<{ authPath?: string[] }>;
};

function noStoreHeaders(contentType?: string | null) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType || "application/json; charset=utf-8",
  };
}

async function authPathFromContext(context: AuthRouteContext) {
  const params = await Promise.resolve(context.params ?? {});
  return (params.authPath ?? []).map(encodeURIComponent).join("/");
}

async function proxyAuthRequest(request: Request, context: AuthRouteContext) {
  const path = await authPathFromContext(context);
  if (!path) {
    return Response.json({ ok: false, error: "auth_path_required" }, { status: 400, headers: noStoreHeaders() });
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`${oaBaseUrl}/api/auth/${path}`);
  sourceUrl.searchParams.forEach((value, key) => targetUrl.searchParams.set(key, value));

  const headers: Record<string, string> = { Accept: "application/json" };
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (contentType) headers["Content-Type"] = contentType;
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      redirect: "manual",
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: noStoreHeaders(upstream.headers.get("content-type")),
    });
  } catch {
    return Response.json({ ok: false, error: "auth_proxy_unavailable" }, { status: 502, headers: noStoreHeaders() });
  }
}

export async function GET(request: Request, context: AuthRouteContext) {
  return proxyAuthRequest(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  return proxyAuthRequest(request, context);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
