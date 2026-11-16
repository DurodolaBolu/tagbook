// Makes the iPhone launch screens in splash/ from the real loader in site/index.html.
// Run after ./build.sh whenever the loader changes:  node scripts/splash.js && ./build.sh
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "site"), out = path.join(__dirname, "..", "splash");
const types = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(root, p);
  if (p.endsWith(".js") || !f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } // no app.js: only the loader shows
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const line of fs.readFileSync(path.join(out, "sizes.txt"), "utf8").trim().split("\n")) {
    const [w, h, r] = line.split(/\s+/).map(Number);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r, reducedMotion: "reduce" });
    await page.goto(url); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `${w}x${h}@${r}.png`) });
    await page.close(); process.stdout.write(`made ${w}x${h}@${r}.png\n`);
  }
  await browser.close(); server.close();
})();
