// Drives the built app in a phone-sized browser against a stand-in Supabase, owner and secretary.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const SB = "https://uungxatdvelljmaugzuz.supabase.co";
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

// ---- in-memory database ----
const shopId = "shop1", ownerId = "u-owner", secId = "u-sec";
const db = {
  shops: [{ id: shopId, name: "Sparkling Garment Laundry & Dry Cleaning", trial_ends: "2026-12-10", is_test: false, created_at: new Date(Date.now() - 86400e3 * 3).toISOString(), next_no: 1 }],
  branches: [{ id: "b1", shop_id: shopId, name: "Main branch", sort: 0, active: true }],
  staff: [{ user_id: ownerId, shop_id: shopId, role: "owner", name: "Bolu", phone: "08120756325", active: true, created_at: "2026-11-01" },
          { user_id: secId, shop_id: shopId, role: "secretary", name: "Grace", phone: "08000000091", active: true, created_at: "2026-11-02" }],
  shop_private: [{ shop_id: shopId, express_type: "manual", express_value: 0, bank_name: "", acct_no: "", acct_name: "Sparkling Garment Laundry & Dry Cleaning", setup: { installed: true } }],
  items: [], item_prices: [], customers: [], customer_phones: [], orders: [], order_money: [],
};
const P = [["Shirt", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Trouser", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Native (2 piece)", { wi: 1500, wo: 1000, io: 600, wsi: 2000 }], ["Special item", null]];
P.forEach(([n, p], i) => { const id = "it" + i; db.items.push({ id, shop_id: shopId, name: n, custom: !p, services: p ? Object.keys(p) : ["wi", "wo", "io", "wsi"], sort: i, hidden: false }); if (p) db.item_prices.push({ item_id: id, shop_id: shopId, prices: p }); });
let current = null; // logged-in user id
const ownerOnly = new Set(["shop_private", "item_prices", "customer_phones", "order_money"]);
const rowsFor = t => { const me = db.staff.find(s => s.user_id === current); if (ownerOnly.has(t) && me.role !== "owner") return []; return db[t]; };
function filterRows(rows, params) {
  for (const [k, v] of params) { if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") rows = rows.filter(r => String(r[k]) === val);
    if (op === "in") { const set = val.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/"/g, "")); rows = rows.filter(r => set.includes(String(r[k]))); } }
  return rows;
}
const pk = { orders: "id", order_money: "order_id", items: "id", item_prices: "item_id", shops: "id", shop_private: "shop_id", branches: "id", customers: "id", customer_phones: "customer_id", staff: "user_id" };
const errors = [];
async function handle(route) {
  const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const send = (status, obj, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: obj === undefined ? "" : JSON.stringify(obj) });
  if (method === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (p === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token") {
    const user = { id: current, aud: "authenticated", role: "authenticated" };
    return send(200, { access_token: "h.eyJzdWIiOiJ4IiwiZXhwIjo0MTAyNDQ0ODAwfQ.s", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r2", user });
  }
  if (p === "/auth/v1/token") {
    const phone = (body.email || "").match(/^p(\d+)@/)?.[1]; const pin = (body.password || "").match(/^tb-(\d{6})-tagbook$/)?.[1];
    const s = db.staff.find(x => x.phone === phone);
    if (!s || pin !== "482915") return send(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    current = s.user_id;
    const user = { id: s.user_id, aud: "authenticated", role: "authenticated", email: body.email };
    return send(200, { access_token: "h.eyJzdWIiOiJ4IiwiZXhwIjo0MTAyNDQ0ODAwfQ.s", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
  }
  if (p === "/auth/v1/user") { if (method === "PUT") return send(200, { id: current }); return send(200, { id: current, aud: "authenticated" }); }
  if (p === "/auth/v1/logout") { current = null; return send(204); }
  if (p === "/functions/v1/admin") {
    if (body.action === "create_shop") { if (current !== ownerId) return send(403, { error: "NOT_ALLOWED" }); db.shops.push({ id: uid(), name: body.shop, created_at: new Date().toISOString(), trial_ends: body.trial_ends, referred_by: body.referred_by }); global.lastCreate = body; return send(200, { ok: true }); }
    if (body.action === "add_staff") { if (db.staff.some(s => s.phone === body.phone)) return send(409, { error: "PHONE_IN_USE" }); db.staff.push({ user_id: uid(), shop_id: shopId, role: "secretary", name: body.name, phone: body.phone, active: true, created_at: new Date().toISOString() }); }
    return send(200, { ok: true });
  }
  if (p === "/rest/v1/rpc/is_platform_admin") return send(200, false);
  if (p === "/rest/v1/rpc/my_plan") return send(200, { state: "trial", until: "2026-12-10", grace_until: "2026-12-12", days_left: 29, prices: { m1: 3000, m6: 15000, m12: 30000 } });
  if (p === "/rest/v1/rpc/admin_shops") return send(200, db.shops.map(s => ({ id: s.id, name: s.name, created_at: s.created_at, trial_ends: s.trial_ends || null, owner_name: "Bolu", owner_phone: "08120756325", staff: db.staff.length, orders: db.orders.length, last_order: new Date().toISOString(), referred_by: s.referred_by || null, referred_by_name: (db.shops.find(k => k.id === s.referred_by) || {}).name || null, referrals: db.shops.filter(k => k.referred_by === s.id).length })));
  if (p === "/rest/v1/rpc/agent_ref_options") return send(200, db.shops.map(s => ({ id: s.id, name: s.name })));
  if (p === "/rest/v1/rpc/team_options") return send(200, [{ id: "11111111-1111-1111-1111-111111111111", name: "Louis" }]);
  if (p === "/rest/v1/rpc/is_agent") return send(200, false);
  if (p === "/rest/v1/tutorials" && method === "GET") return send(200, [{ id: "t1", title: "How to install Tagbook on iPhone", youtube_id: "chuV8thnvrE", section: "start", audience: "all", step_key: "install", sort: 10 }, { id: "t2", title: "How to log a customer's clothes", youtube_id: "SiUDE8sCSQ4", section: "daily", audience: "all", step_key: "order", sort: 20 }, { id: "t3", title: "How to send the list of clothes to your customer", youtube_id: "hinlU63w8ck", section: "daily", audience: "owner", step_key: null, sort: 30 }]);
  if (p === "/rest/v1/rpc/record_payment") {
    const me = db.staff.find(s => s.user_id === current); const m = db.order_money.find(q => q.order_id === body.p_order); const o = db.orders.find(q => q.id === body.p_order);
    const nw = m.billed_at ? Math.min(m.total, m.paid + body.p_amount) : m.paid + body.p_amount; const added = nw - m.paid;
    if (added <= 0) return send(400, { message: "ALREADY_PAID" });
    m.paid = nw; m.payments.push({ amt: added, at: Date.now(), method: body.p_method, by: me.name }); o.settled = !!m.billed_at && m.paid >= m.total; global.lastPay = { by: me.role, added, method: body.p_method };
    return send(200, me.role === "owner" ? { added, paid: nw, total: m.total, billed: !!m.billed_at } : { added, settled: o.settled });
  }
  if (p === "/rest/v1/rpc/find_customer") {
    const ph = db.customer_phones.find(x => x.phone === body.p_phone); const c = ph && db.customers.find(x => x.id === ph.customer_id);
    return send(200, c ? [{ id: c.id, name: c.name, mark: c.mark }] : []);
  }
  if (p === "/rest/v1/rpc/log_order") {
    const x = body.p; const me = db.staff.find(s => s.user_id === current);
    let ph = db.customer_phones.find(c => c.phone === x.phone), c;
    if (x.customer_id) c = db.customers.find(cc => cc.id === x.customer_id);
    else if (ph) c = db.customers.find(cc => cc.id === ph.customer_id);
    else { const clash = db.customers.find(cc => cc.mark === x.mark); if (clash) return send(400, { message: "MARK_TAKEN:" + clash.name, code: "P0001" });
      c = { id: uid(), shop_id: shopId, name: x.name, mark: x.mark, created_at: new Date().toISOString() }; db.customers.push(c); db.customer_phones.push({ customer_id: c.id, shop_id: shopId, phone: x.phone }); }
    const no = db.shops[0].next_no++; const id = uid();
    db.orders.push({ id, shop_id: shopId, no, customer_id: c.id, branch_id: x.branch_id, items: x.items, express: x.express, pickup: x.pickup, status: "new", list_sent: false, checking: false, checked: {}, notified: me.role === "owner", billed: false, settled: false, created_at: new Date().toISOString() });
    let auto = !x.express && !x.pickup, unit = [], total = 0;
    for (const it of x.items) { const item = db.items.find(i => i.id === it.id); const pr = db.item_prices.find(p => p.item_id === it.id); const v = pr && pr.prices[it.svc]; if (!item || item.custom || v == null) { auto = false; unit.push(null); } else { unit.push(v); total += v * it.qty; } }
    let paid = x.paid || 0; if (auto && paid > total) paid = total;
    db.order_money.push({ order_id: id, shop_id: shopId, unit: auto ? unit : null, custom: {}, delivery: 0, discount: 0, total: auto ? total : 0, billed_at: auto ? new Date().toISOString() : null, paid, payments: paid ? [{ amt: paid, at: Date.now(), method: x.method, by: me.name }] : [], express_amt: 0 });
    const oo = db.orders.find(q => q.id === id); oo.billed = auto; oo.settled = auto && paid >= total;
    return send(200, { id, no, customer_id: c.id, name: c.name, mark: c.mark });
  }
  const m = p.match(/^\/rest\/v1\/(\w+)$/);
  if (m) {
    const t = m[1]; if (!db[t]) return send(404, { message: "no table " + t });
    const params = [...u.searchParams];
    if (method === "GET") {
      let rows = filterRows(rowsFor(t), params);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows[0] ? send(200, rows[0]) : send(406, { message: "no rows" });
      const range = req.headers()["range"]; if (range) { const [a, b] = range.split("-").map(Number); rows = rows.slice(a, b + 1); }
      return send(200, rows);
    }
    if (ownerOnly.has(t) && db.staff.find(s => s.user_id === current).role !== "owner") return send(403, { message: "rls" });
    if (method === "PATCH") {
      const rows = filterRows(db[t], params);
      if (t === "orders" && db.staff.find(s => s.user_id === current).role !== "owner" && ("billed" in body || "list_sent" in body || (body.status && ["listed", "told"].includes(body.status)))) return send(400, { message: "OWNER_ONLY" });
      rows.forEach(r => Object.assign(r, body)); return send(204);
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body]; const out = [];
      for (const r of list) { const k = pk[t]; const ex = r[k] && db[t].find(x => x[k] === r[k]);
        if (ex) { Object.assign(ex, r); out.push(ex); } else { const nr = { [k]: r[k] || uid(), ...r }; db[t].push(nr); out.push(nr); } }
      if (t === "order_money") out.forEach(mm => { const o = db.orders.find(x => x.id === mm.order_id); o.billed = !!mm.billed_at; o.settled = o.billed && mm.paid >= mm.total; });
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      return send(201, single ? out[0] : out);
    }
  }
  errors.push("unhandled " + method + " " + p); return send(404, { message: "unhandled" });
}

(async () => {
  const srv = http.createServer((q, s) => { let f = decodeURIComponent(new URL(q.url, "http://x").pathname); if (f === "/") f = "/index.html"; const fp = path.join(SITE, f);
    if (!fs.existsSync(fp)) { s.statusCode = 404; return s.end(); } s.setHeader("content-type", { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" }[path.extname(fp)] || "text/plain"); s.end(fs.readFileSync(fp)); }).listen(8788);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_16 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 844 }, serviceWorkers: "block", colorScheme: "dark" });
  const page = await ctx.newPage();
  const MODE = process.argv[3] || "";
  await ctx.addInitScript(mode => {
    if (mode.includes("nonotif")) { try { delete window.Notification; } catch (_) {} try { Object.defineProperty(window, "Notification", { value: undefined, configurable: true }); delete window.Notification; } catch (_) {} try { delete window.PushManager; } catch (_) {} }
    if (mode.includes("standalone")) { Object.defineProperty(navigator, "standalone", { get: () => true }); const mm = window.matchMedia.bind(window); window.matchMedia = q => q.includes("standalone") ? { matches: true, media: q, addEventListener(){}, addListener(){}, removeEventListener(){} } : mm(q); }
  }, MODE);
  page.on("pageerror", e => errors.push("pageerror: " + e.message + "\n" + e.stack));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await ctx.route(SB + "/**", handle);
  await ctx.routeWebSocket(/realtime/, ws => {});
  await page.goto("http://localhost:8788/"); await page.waitForSelector(".keypad");
  await page.keyboard.type("08120756325"); await page.keyboard.press("Enter"); await page.keyboard.type("482915");
  await page.waitForTimeout(2500);
  console.log("VIEW:", (await page.textContent("#view")).slice(0, 300));
  await page.screenshot({ path: process.argv[2] });
  console.log(errors.join("\n"));
  await browser.close(); srv.close();
})();
