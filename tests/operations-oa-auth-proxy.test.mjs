import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const oaRoot = path.resolve(process.env.OA_REPO_ROOT || "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system");
if (!fs.existsSync(path.join(oaRoot, "server.js"))) throw new Error(`OA_REPO_ROOT is not an OA checkout: ${oaRoot}`);
const oaDependencyRoot = path.resolve(process.env.OA_DEPENDENCY_ROOT || "/Users/oliver/Documents/Codex/2026-06-22/dev-performance-system-ip-43-98/dev-performance-system");
const express = createRequire(path.join(oaDependencyRoot, "package.json"))("express");
const { registerOperationsApi } = await import(pathToFileURL(path.join(oaRoot, "lib/operations-proxy.mjs")));
const { registerOperationsIdentityApi } = await import(pathToFileURL(path.join(oaRoot, "lib/operations-identity.mjs")));

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const request = (url, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const req = http.request(url, { method, headers }, (res) => { const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); }); req.on("error", reject); req.end(body); });

test("registered identity handler enforces persisted session, GEEK entity, admin, stable id, revoke and logout", async (t) => {
  const accounts = new Map(Object.entries({ admin: ["admin@geekforest.ai", "e-admin", "admin"], other: ["admin@other.test", "e-other", "admin"], ordinary: ["user@geekforest.ai", "e-user", "employee"], departed: ["departed@geekforest.ai", "e-departed", "admin"], ignored: ["ignored@geekforest.ai", "e-ignored", "admin"], mismatch: ["mismatch@geekforest.ai", "wrong", "admin"] }).map(([token, [email, employee_id, role_code]]) => [token, { email, employee_id, role_code, name: token }]));
  const employees = [{ id: "e-admin", email: "admin@geekforest.ai", name: "Admin", status: "在职", entity: "GEEK" }, { id: "e-other", email: "admin@other.test", name: "Other", status: "在职", entity: "OTHER" }, { id: "e-user", email: "user@geekforest.ai", name: "User", status: "在职", entity: "GEEK" }, { id: "e-departed", email: "departed@geekforest.ai", name: "Departed", status: "离职", entity: "GEEK" }, { id: "e-ignored", email: "ignored@geekforest.ai", name: "Ignored", status: "不纳入管理", entity: "GEEK" }, { id: "e-real", email: "mismatch@geekforest.ai", name: "Mismatch", status: "在职", entity: "GEEK" }];
  const sessions = new Set(accounts.keys());
  const requireAuth = (req, res, next) => { const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); const account = sessions.has(token) && accounts.get(token); if (!account) return res.status(401).json({ error: "unauthorized" }); req.account = account; req.authToken = token; next(); };
  const requireAdmin = (req, res, next) => req.account.role_code === "admin" ? next() : res.status(403).json({ error: "forbidden" });
  const app = express(); app.use(express.json()); registerOperationsIdentityApi(app, { requireAuth, requireAdmin, getRawStoredState: async () => ({ employees }), employeeByEmail: (state, email) => state.employees.find((e) => e.email === email), isGeekProductEmployee: (_state, employee) => employee.entity === "GEEK" && employee.status === "在职" }); app.post("/test/logout", requireAuth, (req, res) => { sessions.delete(req.authToken); res.status(204).end(); });
  const server = http.createServer(app); const port = await listen(server); t.after(() => server.close()); const base = `http://127.0.0.1:${port}`;
  for (const [token, expected] of [["admin", 200], ["ordinary", 403], ["other", 403], ["departed", 403], ["ignored", 403], ["mismatch", 403], ["missing", 401]]) assert.equal((await request(`${base}/api/operations/identity`, { headers: { authorization: `Bearer ${token}` } })).status, expected, token);
  assert.deepEqual(JSON.parse((await request(`${base}/api/operations/identity`, { headers: { authorization: "Bearer admin" } })).body), { ok: true, user: { role: "admin", employee: { id: "e-admin", name: "Admin", email: "admin@geekforest.ai" } } });
  await request(`${base}/test/logout`, { method: "POST", headers: { authorization: "Bearer admin" } }); assert.equal((await request(`${base}/api/operations/identity`, { headers: { authorization: "Bearer admin" } })).status, 401);
});

test("operations proxy overwrites actor and filters directory", async (t) => {
  const seen = []; const upstream = http.createServer((req, res) => { seen.push(req.headers); res.end('{"ok":true}'); }); const upstreamPort = await listen(upstream); t.after(() => upstream.close());
  const requireAuth = (req, _res, next) => { req.account = { employee_id: "e-admin", email: "admin@geekforest.ai", name: "Admin", role_code: "admin" }; next(); }; const requireAdmin = (_req, _res, next) => next();
  const app = express(); app.use(express.json()); registerOperationsApi(app, { requireAuth, requireAdmin, port: upstreamPort, employeeDirectory: async () => [{ id: "e-admin", name: "Admin", status: "在职" }, { id: "gone", name: "Gone", status: "离职" }] }); const server = http.createServer(app); const port = await listen(server); t.after(() => server.close()); const base = `http://127.0.0.1:${port}`;
  assert.equal(JSON.parse((await request(`${base}/operations/api/employees`, { headers: { authorization: "Bearer x" } })).body).employees.length, 1);
  assert.equal((await request(`${base}/operations/api/issues/i1`, { method: "PATCH", headers: { authorization: "Bearer x", origin: "https://oa.geekforest.ai", host: "oa.geekforest.ai", "content-type": "application/json", "x-oa-actor-id": "spoof" }, body: "{}" })).status, 200); assert.equal(seen[0]["x-oa-actor-id"], "e-admin");
});
