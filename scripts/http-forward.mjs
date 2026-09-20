import http from "node:http";

export function forwardHttpRequest(req, res, options, errorMessage = "Upstream unavailable") {
  const upstream = http.request(options, (response) => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  let completed = false;
  const abortUpstream = () => { if (!completed) upstream.destroy(new Error("DOWNSTREAM_ABORTED")); };
  const closeUpstream = () => { if (!res.writableEnded) abortUpstream(); };
  req.once("aborted", abortUpstream); res.once("close", closeUpstream);
  upstream.once("close", () => { completed = true; req.off("aborted", abortUpstream); res.off("close", closeUpstream); });
  upstream.on("error", () => { if (!res.headersSent && !res.destroyed) { res.statusCode = 502; res.end(errorMessage); } });
  req.pipe(upstream);
  return upstream;
}
