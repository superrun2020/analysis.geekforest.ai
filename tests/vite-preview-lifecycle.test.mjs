import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import test from "node:test";

const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const waitClosed = async (port) => { for (let i = 0; i < 40; i += 1) { const closed = await new Promise((resolve) => { const req = http.get(`http://127.0.0.1:${port}/`, () => resolve(false)); req.on("error", () => resolve(true)); req.setTimeout(100, () => { req.destroy(); resolve(true); }); }); if (closed) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(`port ${port} remained open`); };

test("preview wrapper rejects equal ports and closes wrapper plus Vite descendants", { timeout: 15000 }, async () => {
  const publicPort = await freePort();
  const invalid = spawn(process.execPath, ["scripts/vite-preview.mjs", "--host", "127.0.0.1", "--port", String(publicPort)], { env: { ...process.env, ANALYSIS_VITE_PREVIEW_PORT: String(publicPort) } });
  assert.notEqual(await new Promise((resolve) => invalid.on("exit", resolve)), 0);
  const previewPort = await freePort();
  const child = spawn(process.execPath, ["scripts/vite-preview.mjs", "--host", "127.0.0.1", "--port", String(publicPort)], { env: { ...process.env, ANALYSIS_VITE_PREVIEW_PORT: String(previewPort) }, detached: true, stdio: "ignore" });
  try { await new Promise((resolve, reject) => { const start = Date.now(); const probe = () => { const req = http.get(`http://127.0.0.1:${publicPort}/`, () => resolve()); req.on("error", () => Date.now() - start > 8000 ? reject(new Error("wrapper did not start")) : setTimeout(probe, 100)); }; probe(); }); child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); await waitClosed(publicPort); await waitClosed(previewPort); }
  finally { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
});
