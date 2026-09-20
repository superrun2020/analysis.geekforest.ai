#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { createOperationsBridge } from "./operations-bridge.mjs";
import { forwardHttpRequest } from "./http-forward.mjs";

const args = process.argv.slice(2);
const normalized = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--hostname") {
    normalized.push("--host", args[index + 1] ?? "127.0.0.1");
    index += 1;
  } else if (arg.startsWith("--hostname=")) {
    normalized.push(`--host=${arg.slice("--hostname=".length)}`);
  } else {
    normalized.push(arg);
  }
}
if (!normalized.some((arg) => arg === "--host" || arg.startsWith("--host="))) normalized.push("--host", "127.0.0.1");
const requestedPortIndex = normalized.findIndex((arg) => arg === "--port");
const requestedPortArg = normalized.find((arg) => arg.startsWith("--port="));
const publicPort = Number(requestedPortIndex >= 0 ? normalized[requestedPortIndex + 1] : requestedPortArg?.slice(7) || "3020");
const previewPort = Number(process.env.ANALYSIS_VITE_PREVIEW_PORT || 3022);
const validPort = (value) => Number.isInteger(value) && value > 0 && value < 65536;
if (!validPort(publicPort) || !validPort(previewPort) || publicPort === previewPort) {
  console.error("Analysis public and preview ports must be distinct integers from 1 to 65535");
  process.exit(2);
}
if (requestedPortIndex >= 0) normalized[requestedPortIndex + 1] = String(previewPort);
else if (requestedPortArg) normalized[normalized.indexOf(requestedPortArg)] = `--port=${previewPort}`;
else normalized.push("--port", String(previewPort));

const child = spawn("npx", ["vite", "preview", ...normalized], { stdio: "inherit", shell: false, detached: true });
const bridge = createOperationsBridge({
  oaOrigin: process.env.OA_INTERNAL_ORIGIN || "http://127.0.0.1:3000",
  oaPublicOrigin: process.env.OA_PUBLIC_ORIGIN || "https://oa.geekforest.ai",
  publicOrigin: process.env.ANALYSIS_PUBLIC_ORIGIN || "https://analysis.geekforest.ai",
});
const server = http.createServer((req, res) => bridge(req, res, () => {
  forwardHttpRequest(req, res, { hostname: "127.0.0.1", port: previewPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${previewPort}` } }, "Analysis preview unavailable");
}));
server.listen(publicPort, "127.0.0.1");
let stopping = false;
const closeServer = () => new Promise((resolve) => server.listening ? server.close(resolve) : resolve());
const waitChild = () => new Promise((resolve) => child.exitCode !== null || child.signalCode ? resolve() : child.once("exit", resolve));
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  bridge.close?.();
  await closeServer();
  if (child.exitCode === null && !child.signalCode) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 3000);
    timer.unref?.();
    await waitChild();
    clearTimeout(timer);
  }
  process.exit(code);
}
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(130));
child.once("error", (error) => { console.error("Unable to start Analysis preview", error.message); void shutdown(1); });
child.once("exit", (code) => { if (!stopping) void shutdown(code ?? 1); });
server.once("error", (error) => { console.error("Unable to start Analysis wrapper", error.message); void shutdown(1); });
