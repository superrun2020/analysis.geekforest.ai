import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { forwardHttpRequest } from "../scripts/http-forward.mjs";

function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }
function until(register, timeout = 1000) { return Promise.race([new Promise(register), new Promise((_, reject) => setTimeout(() => reject(new Error("event timeout")), timeout))]); }

test("preview forwarding destroys its upstream socket when the browser disconnects", async (t) => {
  let upstreamSocket; let client;
  const upstreamConnected = until((resolve) => {
    const upstream = http.createServer((req) => { upstreamSocket = req.socket; resolve(); });
    listen(upstream).then((port) => {
      t.after(() => { if (upstream.listening) upstream.close(); });
      const proxy = http.createServer((req, res) => forwardHttpRequest(req, res, { hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers }));
      listen(proxy).then((proxyPort) => {
        t.after(() => { if (proxy.listening) proxy.close(); });
        client = http.get(`http://127.0.0.1:${proxyPort}/slow`); client.on("error", () => {});
        t.after(() => client.destroy());
      });
    });
  });
  await upstreamConnected;
  const closed = until((resolve) => upstreamSocket.once("close", resolve));
  client.destroy();
  await closed; assert.equal(upstreamSocket.destroyed, true);
});
