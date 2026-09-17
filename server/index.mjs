import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  readMarket,
  writeMarket,
  refreshMarket,
  marketDir,
} from "./market.mjs";
import { day } from "../shared/finance.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || 3000);
const universe = JSON.parse(
  await readFile(path.join(root, "public/data/universe.json"), "utf8"),
);
let lastAttempt = null,
  job = null,
  refreshTask = null;
// symbols: optional subset (the user's own stocks); otherwise the full universe.
async function startRefresh(symbols = null) {
  if (refreshTask) return;
  const stocks = symbols
    ? universe.stocks.filter((s) => symbols.includes(s.id))
    : universe.stocks;
  if (!stocks.length) return;
  lastAttempt = Date.now();
  job = {
    running: true,
    completed: 0,
    total: stocks.length,
    scope: symbols ? "portfolio" : "all",
    stage: "Connecting",
  };
  refreshTask = (async () => {
    try {
      // Re-read so a CLI refresh that ran meanwhile is not overwritten.
      const market = await refreshMarket(
        stocks,
        await readMarket(),
        (p) => (job = { ...job, ...p }),
      );
      await writeMarket(market);
    } catch (e) {
      job = { ...job, error: e.message };
    } finally {
      job = { ...job, running: false, finishedAt: new Date().toISOString() };
      refreshTask = null;
    }
  })();
}
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      root,
      configLoader: "native",
      server: { middlewareMode: true },
      appType: "spa",
    });
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (req, res) => {
  const json = (value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/status" && req.method === "GET")
      return json({ mode: "server", job });
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return json({ error: "Origin not allowed" }, 403);
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000) return json({ error: "Request too large" }, 413);
      }
      const symbols = body ? JSON.parse(body).symbols : null;
      if (
        symbols !== null &&
        symbols !== undefined &&
        (!Array.isArray(symbols) || symbols.some((x) => typeof x !== "string"))
      )
        return json({ error: "symbols must be a list of listing symbols" }, 400);
      if (refreshTask) return json({ error: "A refresh is already running." }, 409);
      if (lastAttempt && Date.now() - lastAttempt < 30000)
        return json(
          { error: "Please wait 30 seconds before refreshing again." },
          429,
        );
      void startRefresh(symbols || null);
      return json({ started: true }, 202);
    }
    if (url.pathname.startsWith("/api/"))
      return json({ error: "Endpoint not found" }, 404);
    if (vite) return vite.middlewares(req, res);
    const dist = path.resolve(root, "dist");
    const live = url.pathname.startsWith("/data/market/");
    const base = live ? path.resolve(fileURLToPath(marketDir)) : dist;
    let target = path.resolve(
      base,
      "." + decodeURIComponent(live ? url.pathname.slice("/data/market".length) : url.pathname),
    );
    if (target !== base && !target.startsWith(base + path.sep))
      return json({ error: "Not found" }, 404);
    try {
      if ((await stat(target)).isDirectory())
        target = path.join(target, "index.html");
    } catch {
      if (path.extname(target)) return json({ error: "Not found" }, 404);
      target = path.join(dist, "index.html");
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "Cache-Control":
        !live && target.includes(`${path.sep}assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    });
    res.end(body);
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) json({ error: "Unable to complete request" }, 500);
    else res.end();
  }
});
const market = await readMarket();
let lastAttemptDate = market.lastAttempt ? day(new Date(market.lastAttempt)) : null;
server.listen(port, "127.0.0.1", () => {
  console.log(`The Challenge → http://localhost:${port}`);
  if (process.env.AUTO_REFRESH !== "0" && lastAttemptDate !== day()) {
    lastAttemptDate = day();
    void startRefresh();
  }
});
// Once daily after 22:15 UTC (after the US close). Startup also catches up after the host was offline.
let nightlyDone = null;
const timer = setInterval(() => {
  const now = new Date();
  if (
    process.env.AUTO_REFRESH !== "0" &&
    (now.getUTCHours() > 22 ||
      (now.getUTCHours() === 22 && now.getUTCMinutes() >= 15)) &&
    nightlyDone !== day(now)
  ) {
    nightlyDone = day(now);
    void startRefresh();
  }
}, 60000);
timer.unref();
