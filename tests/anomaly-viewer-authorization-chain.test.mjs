import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createOperationsBridge } from "../scripts/operations-bridge.mjs";

const oaRoot = path.resolve(process.env.OA_REPO_ROOT || "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system");
if (!fs.existsSync(path.join(oaRoot, "server.js"))) throw new Error(`OA_REPO_ROOT is not an OA checkout: ${oaRoot}`);
const oaDependencyRoot = path.resolve(process.env.OA_DEPENDENCY_ROOT || "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system");
const oaRequire = createRequire(path.join(oaDependencyRoot, "package.json"));
const express = oaRequire("express");
const { isOperationsPersonnelScopeExempt, registerOperationsApi } = await import(pathToFileURL(path.join(oaRoot, "lib/operations-proxy.mjs")));
const { registerOperationsIdentityApi, registerOperationsAnomalyReaderIdentityApi } = await import(pathToFileURL(path.join(oaRoot, "lib/operations-identity.mjs")));
const { requirePersonnelScope } = await import(pathToFileURL(path.join(oaRoot, "lib/personnel-scope.mjs")));
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const call = (url, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const requestHeaders = body === undefined ? headers : { "content-length": Buffer.byteLength(body), ...headers };
  const req = http.request(url, { method, headers: requestHeaders }, res => { const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
  req.on("error", error => { error.message = `${method} ${url}: ${error.message}`; reject(error); }); req.end(body);
});
const rawCall = (port, pathValue, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const requestHeaders = body === undefined ? headers : { "content-length": Buffer.byteLength(body), ...headers };
  const req = http.request({ hostname: "127.0.0.1", port, path: pathValue, method, headers: requestHeaders }, res => { const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
  req.on("error", reject); req.end(body);
});

test("real root middleware, identity, bridge and proxy restrict anomaly reads to live Analysis employees", async t => {
  const rootSource = fs.readFileSync(path.join(oaRoot, "server.js"), "utf8");
  const start = rootSource.indexOf("async function requireOperationsAuth(");
  const end = rootSource.indexOf("\nasync function requireAuth(", start);
  assert.ok(start >= 0 && end > start, "actual selected root middleware must be present");

  const accounts = new Map([
    ["employee", { email: "employee@geekforest.ai", employee_id: "e-employee", role_code: "employee", name: "Employee" }],
    ["hr", { email: "hr@geekforest.ai", employee_id: "e-hr", role_code: "hr", name: "HR" }],
    ["admin", { email: "admin@geekforest.ai", employee_id: "e-admin", role_code: "admin", name: "Admin" }],
    ["disabled", { email: "disabled@geekforest.ai", employee_id: "e-disabled", role_code: "employee", name: "Disabled" }],
    ["rebound", { email: "rebound@geekforest.ai", employee_id: "old-id", role_code: "employee", name: "Rebound" }],
  ]);
  const liveSessions = new Set(accounts.keys());
  const sourceExpiry = new Map([...accounts.keys()].map(token => [token, Date.now() + 60_000]));
  let employees = [
    { id: "e-employee", feishuEmail: "employee@geekforest.ai", name: "Employee", status: "正式", entity: "OTHER" },
    { id: "e-hr", feishuEmail: "hr@geekforest.ai", name: "HR", status: "正式", entity: "GEEK" },
    { id: "e-admin", feishuEmail: "admin@geekforest.ai", name: "Admin", status: "正式", entity: "GEEK" },
    { id: "e-disabled", feishuEmail: "disabled@geekforest.ai", name: "Disabled", status: "不纳入管理", entity: "GEEK" },
    { id: "new-id", feishuEmail: "rebound@geekforest.ai", name: "Rebound", status: "正式", entity: "GEEK" },
  ];
  const state = () => ({ employees, businessGroups: [], businessEntities: [] });
  const employeeByEmail = (snapshot, email) => snapshot.employees.find(row => row.feishuEmail === email);
  const eligible = (_snapshot, employee) => Boolean(employee?.id && !["离职", "不纳入管理"].includes(employee.status));
  const deps = {
    pool: { query: async (_sql, [token]) => [liveSessions.has(token) && accounts.has(token) && sourceExpiry.get(token) > Date.now() ? [{ ...accounts.get(token), session_expires_at: new Date(sourceExpiry.get(token)) }] : []] },
    stateKey: "main", sessions: new Map(), cookieValue: () => "", authCookieName: "session",
    readOperationsSecurityState: async () => state(), isSystemAccountEmail: () => false,
    employeeByEmail, isOaAccountEmployee: eligible,
    adminManagement: { refreshAccount: async account => account }, templatePermissions: { capabilities: async () => ({ assessmentTemplateEdit: false }) },
    requirePersonnelScope, isOperationsPersonnelScopeExempt,
  };
  const requireOperationsAuth = new Function(...Object.keys(deps), `${rootSource.slice(start, end)}; return requireOperationsAuth`)(...Object.values(deps));
  const requireAdmin = (req, res, next) => req.account?.role_code === "admin" ? next() : res.status(403).json({ error: "forbidden" });

  const backendSeen = [];
  const backend = http.createServer((req, res) => { backendSeen.push({ method: req.method, url: req.url, actor: req.headers["x-oa-actor-id"] }); const body = req.url.startsWith("/api/anomalies/export") ? "date,count\n2026-09-21,1" : JSON.stringify({ ok: true, path: req.url }); res.writeHead(200, { "content-type": req.url.startsWith("/api/anomalies/export") ? "text/csv" : "application/json", "content-length": Buffer.byteLength(body), connection: "close" }); res.end(req.method === "HEAD" ? undefined : body); });
  const backendPort = await listen(backend); t.after(() => backend.close());
  const oa = express(); oa.use(express.json());
  registerOperationsApi(oa, { requireAuth: requireOperationsAuth, requireAdmin, port: backendPort, employeeDirectory: async () => employees });
  registerOperationsIdentityApi(oa, { requireAuth: requireOperationsAuth, requireAdmin, getRawStoredState: async () => state(), employeeByEmail, isGeekProductEmployee: (_snapshot, employee) => employee.entity === "GEEK" && eligible(null, employee) });
  registerOperationsAnomalyReaderIdentityApi(oa, { requireAuth: requireOperationsAuth, employeeByEmail });
  const oaServer = http.createServer(oa); const oaPort = await listen(oaServer); t.after(() => oaServer.close());
  assert.equal((await call(`http://127.0.0.1:${oaPort}/operations/api/anomalies/summary`, { headers: { authorization: "Bearer employee", origin: "https://oa.geekforest.ai", host: "oa.geekforest.ai" } })).status, 200, "root proxy direct read");
  assert.equal((await call(`http://127.0.0.1:${oaPort}/operations/api/anomalies/summary`, { headers: { authorization: "Bearer hr", origin: "https://oa.geekforest.ai", host: "oa.geekforest.ai" } })).status, 200, "HR root proxy direct read");
  const hrIdentity = await call(`http://127.0.0.1:${oaPort}/api/operations/anomaly-reader-identity`, { headers: { authorization: "Bearer hr" } });
  assert.equal(hrIdentity.status, 200); assert.equal(JSON.parse(hrIdentity.body).user.role, "hr"); assert.equal(JSON.parse(hrIdentity.body).user.capabilities.dailyAnomalyRead, true);
  const bridgeHandler = createOperationsBridge({ oaOrigin: `http://127.0.0.1:${oaPort}`, oaPublicOrigin: "https://oa.geekforest.ai", publicOrigin: "https://analysis.geekforest.ai", sessionTtlMs: 500 });
  const bridge = http.createServer(bridgeHandler); const bridgePort = await listen(bridge); t.after(() => { bridgeHandler.close(); bridge.close(); });
  const base = `http://127.0.0.1:${bridgePort}`;
  const issue = async token => call(base + "/operations/session", { method: "POST", headers: { authorization: `Bearer ${token}`, origin: "https://analysis.geekforest.ai" } });
  const cookieOf = response => String(response.headers["set-cookie"] || "").split(";")[0];
  const freshCookie = async () => { const response = await issue("employee"); assert.equal(response.status, 204, "fresh ordinary viewer session"); return cookieOf(response); };

  for (const token of ["employee", "hr", "admin"]) {
    const session = await issue(token); assert.equal(session.status, 204, token); const cookie = cookieOf(session);
    for (const method of ["GET", "HEAD"]) for (const path of ["summary", "details?date=2026-09-21", "export?date=2026-09-21"]) assert.equal((await call(`${base}/operations/api/anomalies/${path}`, { method, headers: { cookie } })).status, 200, `${token} ${method} ${path}`);
  }
  for (const token of ["missing", "disabled", "rebound"]) assert.ok([401, 403].includes((await issue(token)).status), token);

  const employeeSession = await issue("employee"); const employeeCookie = cookieOf(employeeSession);
  const forged = await call(base + "/operations/api/anomalies/summary", { headers: { cookie: employeeCookie, "x-oa-actor-id": "e-admin", "x-oa-actor-email": "admin@geekforest.ai" } });
  assert.equal(forged.status, 200); assert.equal(backendSeen.at(-1).actor, "e-employee");
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { authorization: "Bearer forged.jwt.value", "x-oa-role": "admin" } })).status, 401, "forged JWT and role cannot replace the bridge cookie");
  for (const [pathValue, expected] of [["/operations/api/bootstrap", 403], ["/operations/api/issues/i1", 403], ["/operations/api/anomalies/summary/extra", 403], ["/operations/api/anomalies/%73ummary", 404], ["/operations/api/anomalies/%73ummary/../bootstrap", 404], ["/operations/api/anomalies/%ZZsummary", 404]]) {
    const cookie = await freshCookie();
    assert.equal((await rawCall(bridgePort, pathValue, { headers: { cookie } })).status, expected, pathValue);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const cookie = await freshCookie();
    assert.equal((await rawCall(bridgePort, "/operations/api/anomalies/summary", { method, headers: { cookie, origin: "https://analysis.geekforest.ai" }, body: method === "OPTIONS" ? undefined : "{}" })).status, 403, method);
  }
  const expiringSession = await issue("employee"); const expiringCookie = cookieOf(expiringSession); await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { cookie: expiringCookie } })).status, 401, "bridge session expiry");
  const revokedSession = await issue("employee"); const revokedCookie = cookieOf(revokedSession); liveSessions.delete("employee");
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { cookie: revokedCookie } })).status, 401, "immediate source session revoke");

  const hrSourceExpirySession = await issue("hr"); const hrSourceExpiryCookie = cookieOf(hrSourceExpirySession); sourceExpiry.set("hr", Date.now() - 1);
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { cookie: hrSourceExpiryCookie } })).status, 401, "source SQL session expiry");

  const offboardSession = await issue("admin"); const offboardCookie = cookieOf(offboardSession); employees = employees.map(row => row.id === "e-admin" ? { ...row, status: "离职" } : row);
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { cookie: offboardCookie } })).status, 403, "immediate offboard revoke");
  liveSessions.add("employee"); sourceExpiry.set("employee", Date.now() + 60_000); const disabledSession = await issue("employee"); const disabledCookie = cookieOf(disabledSession); employees = employees.map(row => row.id === "e-employee" ? { ...row, status: "不纳入管理" } : row);
  assert.equal((await call(base + "/operations/api/anomalies/summary", { headers: { cookie: disabledCookie } })).status, 403, "immediate disabled revoke");
  employees = employees.map(row => row.id === "e-employee" ? { ...row, id: "e-employee-rebound", status: "正式" } : row); const reboundSession = await issue("employee");
  assert.equal(reboundSession.status, 403, "rebound binding cannot mint a session");
  const adminSession = await issue("admin"); assert.equal(adminSession.status, 403, "offboarded admin cannot mint bridge session");
});
