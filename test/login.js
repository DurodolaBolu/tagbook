const { chromium } = require("playwright"); const path = require("path"); const http = require("http"); const fs = require("fs");
const SITE = path.join(__dirname, "..", "site"); const out = path.join(__dirname, "shots");
(async () => {
  const srv = http.createServer((q, s) => { let f = new URL(q.url, "http://x").pathname; if (f === "/") f = "/index.html"; const fp = path.join(SITE, f); if (!fs.existsSync(fp)) { s.statusCode = 404; return s.end(); } s.setHeader("content-type", { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png" }[path.extname(fp)] || "text/plain"); s.end(fs.readFileSync(fp)); }).listen(8788);
  const b = await chromium.launch();
  for (const look of ["machine"]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
    const p = await ctx.newPage(); await ctx.route("https://uungxatdvelljmaugzuz.supabase.co/**", r => r.abort());
    await p.goto(`http://localhost:8788/?look=${look}`); await p.waitForSelector(".keypad"); await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/L-${look}-phone-new.png` });
    await p.evaluate(() => localStorage.setItem("tb-last", JSON.stringify({ phone: "09038368530", name: "Grace Adeyemi", shop: "BrightWash Laundry" })));
    await p.reload(); await p.waitForSelector(".keypad"); await p.click('[data-k="4"]'); await p.click('[data-k="8"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/L-${look}-phone-back.png` });
    await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/L-${look}-laptop.png` });
    await ctx.close();
  }
  await b.close(); srv.close();
})();
