const { chromium } = require("playwright"); const path = require("path"); const http = require("http"); const fs = require("fs");
const SITE = path.join(__dirname, "..", "site");
(async () => {
  const srv = http.createServer((q, s) => { let f = new URL(q.url, "http://x").pathname; if (f === "/") f = "/index.html"; const fp = path.join(SITE, f); if (!fs.existsSync(fp)) { s.statusCode = 404; return s.end(); } s.setHeader("content-type", { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2" }[path.extname(fp)] || "text/plain"); s.end(fs.readFileSync(fp)); }).listen(8789);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  const p = await ctx.newPage(); await ctx.route("https://uungxatdvelljmaugzuz.supabase.co/**", () => {}); // hang forever, so loading stays
  await p.goto("http://localhost:8789/"); await p.evaluate(() => localStorage.setItem("tagbook-auth", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 4102444800, user: { id: "x" } })));
  await p.reload(); await p.waitForSelector(".washing"); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(__dirname, "shots", "loading.png") });
  await b.close(); srv.close();
})();
