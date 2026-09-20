import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createOperationsBridge, isOperationsAdminIdentity, isSafeOperationsPath, legacyOperationsLocation, legacyOperationsRedirects } from "../scripts/operations-bridge.mjs";

test("authoritative role, stable employee id, paths, and redirects fail closed", () => {
  assert.equal(isOperationsAdminIdentity(200, { user: { role: "admin", employee: { id: "e1" } } }), true);
  assert.equal(isOperationsAdminIdentity(200, { user: { role: "employee", employee: { id: "e1" } } }), false);
  assert.equal(isOperationsAdminIdentity(200, { user: { role: "admin", employee: {} } }), false);
  assert.equal(isOperationsAdminIdentity(403, { user: { role: "admin", employee: { id: "e1" } } }), false);
  assert.equal(isSafeOperationsPath("/operations/api/employees"), true);
  assert.equal(isSafeOperationsPath("/operations/%2e%2e/api/state"), false);
  assert.equal(isSafeOperationsPath("/operations/api/x\\y"), false);
  assert.deepEqual(Object.keys(legacyOperationsRedirects), ["operationsOverview", "operationsProjects", "operationsIssues", "operationsTeam", "operationsAcceptance", "operationsRules", "operationsAlerts", "operationsRuns", "operationsStatus"]);
  assert.equal(legacyOperationsLocation("operationsOverview"), "/?operations=overview&operationsPage=overview");
  assert.equal(legacyOperationsLocation("operationsAcceptance"), "/?operations=issues&operationsPage=acceptance");
  assert.equal(legacyOperationsLocation("operationsAlerts"), "/?operations=issues&operationsPage=alerts");
  assert.equal(legacyOperationsLocation("https://evil.example"), "");
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("bridge uses real OA auth/admin on every request and revokes session on logout", async (t) => {
  const calls = [];
  const oa = http.createServer((req, res) => {
    calls.push({ url: req.url, method: req.method, authorization: req.headers.authorization, origin: req.headers.origin, actor: req.headers["x-oa-actor-id"] });
    if (req.url === "/api/operations/identity") {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (token === "admin") return void res.end(JSON.stringify({ user: { role: "admin", email: "admin@geekforest.ai", employee: { id: "e-admin", status: "正式" } } }));
      if (token === "employee") return void res.end(JSON.stringify({ user: { role: "employee", email: "user@geekforest.ai", employee: { id: "e-user", status: "正式" } } }));
      if (token === "terminated") { res.statusCode = 403; return void res.end(JSON.stringify({ error: "business_entity_account_forbidden" })); }
      res.statusCode = 401; return void res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.url.startsWith("/operations")) {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ ok: true, path: req.url }));
    }
    res.statusCode = 404; res.end();
  });
  const oaPort = await listen(oa); t.after(() => { if (oa.listening) oa.close(); });
  const bridge = createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}`, publicOrigin: "https://analysis.geekforest.ai" });
  const server = http.createServer(bridge); const port = await listen(server); t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const open = (token, origin = "https://analysis.geekforest.ai") => request(`${base}/operations/session`, { method: "POST", headers: { authorization: `Bearer ${token}`, origin, host: "analysis.geekforest.ai" } });

  assert.equal((await open("employee")).status, 403);
  assert.equal((await open("terminated")).status, 403);
  assert.equal((await open("admin", "https://evil.example")).status, 403);
  const session = await open("admin"); assert.equal(session.status, 204);
  assert.match(session.headers["set-cookie"][0], /^jkcl_operations_bridge=/);
  assert.match(session.headers["set-cookie"][0], /HttpOnly/);
  assert.match(session.headers["set-cookie"][0], /Secure/);
  assert.match(session.headers["set-cookie"][0], /SameSite=Strict/);
  assert.match(session.headers["set-cookie"][0], /Path=\/operations/);
  const cookie = session.headers["set-cookie"][0].split(";")[0];

  assert.equal((await request(`${base}/operations/api/bootstrap`, { headers: { cookie, host: "analysis.geekforest.ai" } })).status, 200);
  assert.equal((await request(`${base}/operations/api/issues/i1`, { method: "PATCH", headers: { cookie, host: "analysis.geekforest.ai", origin: "https://evil.example", "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await request(`${base}/operations/%2e%2e/api/state`, { headers: { cookie, host: "analysis.geekforest.ai" } })).status, 404);
  assert.equal((await request(`${base}/operations/api/employees`, { headers: { cookie, host: "analysis.geekforest.ai" } })).status, 200);
  assert.equal((await request(`${base}/operations/session`, { method: "DELETE", headers: { cookie, host: "analysis.geekforest.ai", origin: "https://analysis.geekforest.ai" } })).status, 204);
  assert.equal((await request(`${base}/operations/api/bootstrap`, { headers: { cookie, host: "analysis.geekforest.ai" } })).status, 401);

  const proxied = calls.filter((call) => call.url.startsWith("/operations"));
  assert.ok(calls.filter((call) => call.url === "/api/operations/identity").length >= 5, "every authenticated bridge operation must revalidate OA");
  assert.ok(proxied.every((call) => call.authorization === "Bearer admin"));
  assert.ok(proxied.every((call) => call.origin === "https://oa.geekforest.ai"));
  assert.ok(proxied.every((call) => !call.actor), "client cannot forge actor headers");
});

test("bridge denies missing/cross-site write origin and does not expose bearer in redirects or responses", async (t) => {
  const oa = http.createServer((req, res) => req.url === "/api/operations/identity"
    ? res.end(JSON.stringify({ user: { role: "admin", email: "a@geekforest.ai", employee: { id: "e1", status: "正式" } } }))
    : res.end("ok"));
  const oaPort = await listen(oa); t.after(() => oa.close());
  const server = http.createServer(createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}`, publicOrigin: "https://analysis.geekforest.ai" }));
  const port = await listen(server); t.after(() => server.close()); const base = `http://127.0.0.1:${port}`;
  assert.equal((await request(`${base}/operations/session`, { method: "POST", headers: { authorization: "Bearer secret", host: "analysis.geekforest.ai" } })).status, 403);
  const opened = await request(`${base}/operations/session`, { method: "POST", headers: { authorization: "Bearer secret", origin: "https://analysis.geekforest.ai", host: "analysis.geekforest.ai" } });
  assert.equal(opened.status, 204); assert.doesNotMatch(opened.body, /secret/); assert.equal(opened.headers.location, undefined);
});

test("normalized traversal cannot hang a standalone bridge", async (t) => {
  const bridge = createOperationsBridge(); t.after(() => bridge.close());
  const server = http.createServer(bridge); const port = await listen(server); t.after(() => server.close());
  const result = await request(`http://127.0.0.1:${port}/operations/%2e%2e/api/state`);
  assert.equal(result.status, 404);
  assert.deepEqual(JSON.parse(result.body), { error: "NOT_FOUND" });
});

test("sessions rotate, remain bounded, expire by sweep, and logout always clears", async (t) => {
  const oa = http.createServer((req, res) => res.end(JSON.stringify({ user: { role: "admin", employee: { id: "admin-1" } } })));
  const oaPort = await listen(oa); t.after(() => oa.close());
  const bridge = createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}`, sessionTtlMs: 40, sweepIntervalMs: 10, maxSessions: 2 });
  t.after(() => bridge.close());
  const server = http.createServer(bridge); const port = await listen(server); t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`, headers = { authorization: "Bearer admin", origin: "https://analysis.geekforest.ai" };
  const first = await request(`${base}/operations/session`, { method: "POST", headers });
  const firstCookie = first.headers["set-cookie"][0].split(";")[0];
  const rotated = await request(`${base}/operations/session`, { method: "POST", headers: { ...headers, cookie: firstCookie } });
  assert.equal(bridge.sessionCount(), 1); assert.notEqual(rotated.headers["set-cookie"][0].split(";")[0], firstCookie);
  await request(`${base}/operations/session`, { method: "POST", headers }); await request(`${base}/operations/session`, { method: "POST", headers });
  assert.equal(bridge.sessionCount(), 2);
  await new Promise((resolve) => setTimeout(resolve, 70)); assert.equal(bridge.sessionCount(), 0);
  const logout = await request(`${base}/operations/session`, { method: "DELETE", headers: { origin: "https://analysis.geekforest.ai" } });
  assert.equal(logout.status, 204); assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
  oa.close();
  const unavailableLogout = await request(`${base}/operations/session`, { method: "DELETE", headers: { origin: "https://analysis.geekforest.ai", cookie: firstCookie } });
  assert.equal(unavailableLogout.status, 204); assert.match(unavailableLogout.headers["set-cookie"][0], /Max-Age=0/);
});

test("every GET rejects explicit foreign Origin and cross-site fetch metadata", async (t) => {
  const oa = http.createServer((req, res) => res.end(JSON.stringify(req.url === "/api/operations/identity" ? { user: { role: "admin", employee: { id: "admin-1" } } } : { ok: true })));
  const oaPort = await listen(oa); t.after(() => oa.close());
  const bridge = createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}` }); t.after(() => bridge.close());
  const server = http.createServer(bridge); const port = await listen(server); t.after(() => server.close()); const base = `http://127.0.0.1:${port}`;
  const opened = await request(`${base}/operations/session`, { method: "POST", headers: { authorization: "Bearer admin", origin: "https://analysis.geekforest.ai" } });
  const cookie = opened.headers["set-cookie"][0].split(";")[0];
  assert.equal((await request(`${base}/operations/api/bootstrap`, { headers: { cookie, origin: "https://evil.example" } })).status, 403);
  assert.equal((await request(`${base}/operations/api/bootstrap`, { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await request(`${base}/operations/legacy/operationsOverview`, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await request(`${base}/operations/api/bootstrap`, { headers: { cookie } })).status, 200);
});

test("identity and operations upstream sockets close when the downstream request aborts", async (t) => {
  let holdIdentity = true; let identitySocket; let operationsSocket;
  let identityReceivedResolve; const identityReceived = new Promise((resolve) => { identityReceivedResolve = resolve; });
  let operationReceivedResolve; const operationReceived = new Promise((resolve) => { operationReceivedResolve = resolve; });
  const oa = http.createServer((req, res) => {
    if (req.url === "/api/operations/identity") {
      if (holdIdentity) { identitySocket = req.socket; identityReceivedResolve(); return; }
      return void res.end(JSON.stringify({ user: { role: "admin", employee: { id: "admin-1" } } }));
    }
    operationsSocket = req.socket; operationReceivedResolve();
  });
  const oaPort = await listen(oa); t.after(() => { if (oa.listening) oa.close(); });
  const bridge = createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}` }); t.after(() => bridge.close());
  const server = http.createServer(bridge); const port = await listen(server); t.after(() => server.close());

  const identityClient = http.request({ hostname: "127.0.0.1", port, path: "/operations/session", method: "POST", headers: { authorization: "Bearer admin", origin: "https://analysis.geekforest.ai" } });
  identityClient.on("error", () => {}); identityClient.end(); await identityReceived;
  const identityClosed = new Promise((resolve) => identitySocket.once("close", resolve)); identityClient.destroy(); await identityClosed;
  assert.equal(identitySocket.destroyed, true);

  holdIdentity = false;
  const opened = await request(`http://127.0.0.1:${port}/operations/session`, { method: "POST", headers: { authorization: "Bearer admin", origin: "https://analysis.geekforest.ai" } });
  const cookie = opened.headers["set-cookie"][0].split(";")[0];
  const operationClient = http.get({ hostname: "127.0.0.1", port, path: "/operations/api/bootstrap", headers: { cookie } });
  operationClient.on("error", () => {}); await operationReceived;
  const operationClosed = new Promise((resolve) => operationsSocket.once("close", resolve)); operationClient.destroy(); await operationClosed;
  assert.equal(operationsSocket.destroyed, true);
});
