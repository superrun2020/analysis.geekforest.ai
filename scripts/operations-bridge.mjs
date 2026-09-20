import crypto from "node:crypto";
import http from "node:http";

export const legacyOperationsRedirects = Object.freeze({
  operationsOverview: "overview",
  operationsProjects: "projects",
  operationsIssues: "issues",
  operationsTeam: "team",
  operationsAcceptance: "acceptance",
  operationsRules: "rules",
  operationsAlerts: "alerts",
  operationsRuns: "runs",
  operationsStatus: "status",
});
const legacyEntry = Object.freeze({ overview: "overview", projects: "projects", issues: "issues", team: "overview", acceptance: "issues", rules: "monitoring", alerts: "issues", runs: "monitoring", status: "monitoring" });
export function legacyOperationsLocation(view) {
  const page = legacyOperationsRedirects[view];
  return page ? `/?operations=${legacyEntry[page]}&operationsPage=${page}` : "";
}

const cookieName = "jkcl_operations_bridge";
const safePath = /^(?:\/operations)(?:\/|\/index\.html|\/assets\/[a-zA-Z0-9_.-]+|\/api\/[a-zA-Z0-9_/-]+)?(?:\?[^\s]*)?$/;
export const isOperationsAdminIdentity = (status, payload) => status === 200 && payload?.user?.role === "admin" && Boolean(payload?.user?.employee?.id);
export function isSafeOperationsPath(value) {
  let decoded; try { decoded = decodeURIComponent(String(value || "").split("?")[0]); } catch { return false; }
  return !decoded.includes("..") && !decoded.includes("\\") && safePath.test(String(value || ""));
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(value));
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value));
}

function collect(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let settled = false;
    const finish = (callback, value) => { if (!settled) { settled = true; callback(value); } };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish(reject, Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 }));
        req.resume();
      } else chunks.push(chunk);
    });
    req.on("end", () => finish(resolve, Buffer.concat(chunks)));
    req.on("aborted", () => finish(reject, Object.assign(new Error("REQUEST_ABORTED"), { status: 499 })));
    req.on("error", (error) => finish(reject, error));
  });
}

function originAllowed(req, publicOrigin) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  return origin === publicOrigin && req.headers["sec-fetch-site"] !== "cross-site";
}

function readOriginAllowed(req, publicOrigin) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  return req.headers["sec-fetch-site"] !== "cross-site" && (!origin || origin === publicOrigin);
}

async function oaIdentity(oaOrigin, token, downstreamReq, downstreamRes) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; cleanup(); resolve(value); } };
    const url = new URL("/api/operations/identity", oaOrigin);
    const request = http.request(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 8000 }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => {
        let payload = {}; try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
        finish({ status: response.statusCode || 503, payload });
      });
      response.on("error", () => finish({ status: 503, payload: { error: "AUTH_UNAVAILABLE" } }));
    });
    const abort = () => { if (!settled) request.destroy(new Error("DOWNSTREAM_ABORTED")); };
    const close = () => { if (!downstreamRes?.writableEnded) abort(); };
    const cleanup = () => { downstreamReq?.off("aborted", abort); downstreamRes?.off("close", close); };
    downstreamReq?.once("aborted", abort); downstreamRes?.once("close", close);
    request.on("timeout", () => request.destroy());
    request.on("error", () => finish({ status: 503, payload: { error: "AUTH_UNAVAILABLE" } }));
    request.end();
  });
}

export function createOperationsBridge({ oaOrigin = "http://127.0.0.1:3000", oaPublicOrigin = "https://oa.geekforest.ai", publicOrigin = "https://analysis.geekforest.ai", sessionTtlMs = 8 * 60 * 60 * 1000, maxSessions = 512, sweepIntervalMs = Math.min(sessionTtlMs, 60_000) } = {}) {
  const sessions = new Map();
  const clearCookie = `${cookieName}=; Path=/operations; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  const sweep = () => { const now = Date.now(); for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id); };
  const sweepTimer = setInterval(sweep, Math.max(10, sweepIntervalMs)); sweepTimer.unref?.();
  async function authenticate(req, res) {
    const id = cookies(req)[cookieName]; const session = id && sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) { if (id) sessions.delete(id); json(res, 401, { error: "OPERATIONS_SESSION_REQUIRED" }); return null; }
    const identity = await oaIdentity(oaOrigin, session.token, req, res);
      if (!isOperationsAdminIdentity(identity.status, identity.payload)) {
      sessions.delete(id); res.setHeader("set-cookie", clearCookie);
      json(res, identity.status === 401 ? 401 : 403, { error: identity.status === 503 ? "AUTH_UNAVAILABLE" : "OPERATIONS_ADMIN_REQUIRED" }); return null;
    }
    return { id, session, user: identity.payload.user };
  }

  async function operationsBridge(req, res, next) {
    if (!String(req.url || "").startsWith("/operations")) {
      if (next) return next();
      return json(res, 404, { error: "NOT_FOUND" });
    }
    res.setHeader("cache-control", "no-store"); res.setHeader("x-content-type-options", "nosniff"); res.setHeader("referrer-policy", "same-origin");
    if (["GET", "HEAD"].includes(req.method) && !readOriginAllowed(req, publicOrigin)) return json(res, 403, { error: "FORBIDDEN_ORIGIN" });
    const legacyMatch = req.method === "GET" && String(req.url || "").match(/^\/operations\/legacy\/(operations[A-Za-z]+)$/);
    if (legacyMatch) {
      const location = legacyOperationsLocation(legacyMatch[1]);
      if (!location) return json(res, 404, { error: "NOT_FOUND" });
      res.statusCode = 302; res.setHeader("location", location); return res.end();
    }
    if (req.url === "/operations/session" && req.method === "POST") {
      if (!originAllowed(req, publicOrigin)) return json(res, 403, { error: "FORBIDDEN_ORIGIN" });
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { error: "UNAUTHENTICATED" });
      const identity = await oaIdentity(oaOrigin, token, req, res);
      if (!isOperationsAdminIdentity(identity.status, identity.payload)) return json(res, identity.status === 401 ? 401 : 403, { error: "OPERATIONS_ADMIN_REQUIRED" });
      const priorId = cookies(req)[cookieName]; if (priorId) sessions.delete(priorId);
      sweep();
      while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
      const id = crypto.randomBytes(32).toString("base64url"); sessions.set(id, { token, expiresAt: Date.now() + sessionTtlMs });
      res.statusCode = 204; res.setHeader("set-cookie", `${cookieName}=${id}; Path=/operations; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs / 1000)}`); return res.end();
    }
    if (req.url === "/operations/session" && req.method === "DELETE") {
      if (!originAllowed(req, publicOrigin)) return json(res, 403, { error: "FORBIDDEN_ORIGIN" });
      const id = cookies(req)[cookieName]; if (id) sessions.delete(id);
      res.statusCode = 204; res.setHeader("set-cookie", clearCookie); return res.end();
    }
    if (!isSafeOperationsPath(req.url)) return json(res, 404, { error: "NOT_FOUND" });
    if (!["GET", "HEAD"].includes(req.method) && !originAllowed(req, publicOrigin)) return json(res, 403, { error: "FORBIDDEN_ORIGIN" });
    const authenticated = await authenticate(req, res); if (!authenticated) return;
    let body; try { body = ["GET", "HEAD"].includes(req.method) ? undefined : await collect(req); } catch (error) { return json(res, error.status || 400, { error: error.message }); }
    const upstreamUrl = new URL(req.url, oaOrigin);
    const headers = { authorization: `Bearer ${authenticated.session.token}`, origin: oaPublicOrigin, host: new URL(oaPublicOrigin).host, accept: req.headers.accept || "*/*" };
    if (body?.length) { headers["content-type"] = req.headers["content-type"] || "application/json"; headers["content-length"] = String(body.length); }
    const upstream = http.request(upstreamUrl, { method: req.method, headers, timeout: 20000 }, (response) => {
      res.statusCode = response.statusCode || 502;
      for (const key of ["content-type", "content-encoding", "etag"]) if (response.headers[key]) res.setHeader(key, response.headers[key]);
      response.pipe(res);
    });
    let completed = false;
    const abortUpstream = () => { if (!completed) upstream.destroy(new Error("DOWNSTREAM_ABORTED")); };
    const closeUpstream = () => { if (!res.writableEnded) abortUpstream(); };
    req.once("aborted", abortUpstream); res.once("close", closeUpstream);
    upstream.once("close", () => { completed = true; req.off("aborted", abortUpstream); res.off("close", closeUpstream); });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) json(res, 502, { error: "OPERATIONS_UNAVAILABLE" }); else res.destroy(); });
    if (body) upstream.end(body); else upstream.end();
  }
  operationsBridge.close = () => clearInterval(sweepTimer);
  operationsBridge.sessionCount = () => sessions.size;
  return operationsBridge;
}
