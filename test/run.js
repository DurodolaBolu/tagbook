// Drives the built app in a phone-sized browser against a stand-in Supabase, owner and secretary.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const SB = "https://uungxatdvelljmaugzuz.supabase.co";
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

// ---- in-memory database ----
const shopId = "shop1", ownerId = "u-owner", secId = "u-sec";
const db = {
  shops: [{ id: shopId, name: "BrightWash Test", created_at: new Date(Date.now() - 86400e3 * 3).toISOString(), next_no: 1, staff_prices: true }],
  branches: [{ id: "b1", shop_id: shopId, name: "Main branch", sort: 0, active: true }, { id: "b2", shop_id: shopId, name: "Second point", sort: 1, active: true }],
  staff: [{ user_id: ownerId, shop_id: shopId, role: "owner", name: "Bolu", phone: "08120756325", active: true, created_at: "2026-11-01" },
          { user_id: secId, shop_id: shopId, role: "secretary", name: "Grace", phone: "08000000091", active: true, created_at: "2026-11-02" }],
  shop_private: [{ shop_id: shopId, express_type: "percent", express_value: 50, bank_name: "GTBank", acct_no: "0123456789", acct_name: "BrightWash" }],
  items: [], item_prices: [], customers: [], customer_phones: [], orders: [], order_money: [],
};
const P = [["Shirt", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Trouser", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Native (2 piece)", { wi: 1500, wo: 1000, io: 600, wsi: 2000 }], ["Special item", null]];
P.forEach(([n, p], i) => { const id = "it" + i; db.items.push({ id, shop_id: shopId, name: n, custom: !p, services: p ? Object.keys(p) : ["wi", "wo", "io", "wsi"], sort: i, hidden: false }); if (p) db.item_prices.push({ item_id: id, shop_id: shopId, prices: p }); });
let current = null; // logged-in user id
const ownerOnly = new Set(["shop_private", "item_prices", "customer_phones", "order_money"]);
const staffMay = t => t === "item_prices" && db.shops[0].staff_prices;
const rowsFor = t => { const me = db.staff.find(s => s.user_id === current); if (ownerOnly.has(t) && me.role !== "owner" && !staffMay(t)) return []; return db[t]; };
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
  if (p === "/auth/v1/user") { if (method === "PUT") return send(200, { id: current }); global.unswitched = global.unswitched || new Set(); return send(200, { id: current, aud: "authenticated", app_metadata: global.unswitched.has(current) ? {} : { pin_v2: true } }); }
  if (p === "/auth/v1/logout") { current = null; return send(204); }
  if (p === "/functions/v1/login") {
    // stand-in for the login function: 5 wrong PINs on a phone = locked 15 minutes
    global.fails = global.fails || {};
    const s = db.staff.find(x => x.phone === body.phone);
    if ((global.fails[body.phone] || 0) >= 5) return send(429, { error: "LOCKED", wait: 900 });
    if (!s || body.pin !== "482915") { global.fails[body.phone] = (global.fails[body.phone] || 0) + 1; return global.fails[body.phone] >= 5 ? send(429, { error: "LOCKED", wait: 900 }) : send(401, { error: "BAD_LOGIN" }); }
    global.fails[body.phone] = 0; current = s.user_id; if (global.unswitched) global.unswitched.delete(s.user_id);
    return send(200, { access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.sig", refresh_token: "r" });
  }
  if (p === "/functions/v1/admin") {
    if (body.action === "create_shop") { if (current !== ownerId) return send(403, { error: "NOT_ALLOWED" }); db.shops.push({ id: uid(), name: body.shop, created_at: new Date().toISOString(), trial_ends: body.trial_ends, referred_by: body.referred_by }); global.lastCreate = body; return send(200, { ok: true }); }
    if (body.action === "add_staff") { if (db.staff.some(s => s.phone === body.phone)) return send(409, { error: "PHONE_IN_USE" }); db.staff.push({ user_id: uid(), shop_id: shopId, role: "secretary", name: body.name, phone: body.phone, active: true, created_at: new Date().toISOString() }); }
    return send(200, { ok: true });
  }
  if (/^\/rest\/v1\/rpc\/(admin_dashboard|admin_agents|admin_shops|team_options|admin_team_pay)$/.test(p)) return send(200, []);
  if (p === "/rest/v1/rpc/is_platform_admin") return send(200, current === ownerId);
  if (p === "/rest/v1/rpc/my_plan") { global.planCalls = (global.planCalls || 0) + 1; if (global.planFail) return send(500, { message: "down" }); }
  if (p === "/rest/v1/rpc/my_plan") return send(200, { state: "trial", until: "2099-01-01", grace_until: "2099-01-03", days_left: 9999, prices: { m1: 3000, m6: 15000, m12: 30000 } });
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
  if (p === "/rest/v1/rpc/owner_set_greet") { const cc = db.customers.find(c => c.id === body.p_customer); cc.greet = body.p_greet; cc.greet_asked = true; return send(200, { ok: true, greet: body.p_greet }); }
  if (p === "/rest/v1/rpc/owner_cancel_order") { const o = db.orders.find(x => x.id === body.p_order); if (body.p_cancel && o.status === "picked") return send(400, { message: "PICKED_UP" }); o.cancelled_at = body.p_cancel ? new Date().toISOString() : null; o.cancelled_by = body.p_cancel ? "Bolu" : null; return send(200, { ok: true }); }
  if (p === "/rest/v1/rpc/owner_edit_customer") { const taken = db.customer_phones.find(x => x.phone === body.p_phone && x.customer_id !== body.p_customer); if (taken) return send(400, { message: "PHONE_TAKEN:" + db.customers.find(c => c.id === taken.customer_id).name });
    db.customers.find(c => c.id === body.p_customer).name = body.p_name; const ph = db.customer_phones.find(x => x.customer_id === body.p_customer); ph.phone = body.p_phone; return send(200, { ok: true, name: body.p_name, phone: body.p_phone }); }
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
      c = { id: uid(), shop_id: shopId, name: x.name, mark: x.mark, greet: (current === ownerId && x.greet) || null, greet_asked: current === ownerId && "greet" in x, created_at: new Date().toISOString() }; db.customers.push(c); db.customer_phones.push({ customer_id: c.id, shop_id: shopId, phone: x.phone }); }
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
  const srv = http.createServer((q, s) => { let f = decodeURIComponent(new URL(q.url, "http://x").pathname); if (f === "/") f = "/index.html"; if (!path.extname(f) && fs.existsSync(path.join(SITE, f + ".html"))) f += ".html"; const fp = path.join(SITE, f);
    if (!fs.existsSync(fp)) { s.statusCode = 404; return s.end(); } s.setHeader("content-type", { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" }[path.extname(fp)] || "text/plain"); s.end(fs.readFileSync(fp)); }).listen(8787);
  const browser = await chromium.launch();
  const out = path.join(__dirname, "shots"); fs.mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/websocket|realtime|ERR_|404/i.test(m.text())) errors.push("console: " + m.text()); });
  await ctx.route(SB + "/**", handle);
  await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (_) {} });
  await ctx.routeWebSocket(/realtime/, ws => {});
  const shot = async n => page.screenshot({ path: path.join(out, n + ".png"), fullPage: true });
  const login = async (phone, pin = "482915") => { await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad"); if (await page.$(".lhi")) { await page.click("#lhelp"); await page.click("#lswitch"); } await page.keyboard.type(phone); await page.keyboard.press("Enter"); await page.waitForTimeout(100); await page.keyboard.type(pin); try { await page.waitForSelector("#tabs button", { timeout: 8000 }); } catch (e) { console.log("LOGIN STUCK:", await page.textContent(".lerr").catch(() => "?"), await page.evaluate(() => document.body.innerText.slice(0, 300))); throw e; } };
  const T = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };

  // bad login
  await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad"); await shot("01-login");
  await page.keyboard.type("08120756325"); await page.keyboard.press("Enter"); await page.keyboard.type("111111"); await page.waitForTimeout(600);
  console.log("bad login message:", await page.textContent(".lerr"));
  for (let i = 0; i < 4; i++) { await page.keyboard.type("111111"); await page.waitForTimeout(400); }
  console.log("locked message:", await page.textContent(".lerr")); await shot("01b-locked");
  console.log("privacy link on login:", await page.isVisible('.lpriv a[href="/privacy"]'));
  await T('.lpriv a'); await page.waitForSelector("[data-back]"); await shot("01c-privacy");
  await page.click("a.back"); await page.waitForSelector(".lpriv a", { timeout: 8000 });
  console.log("back from privacy lands on login:", await page.isVisible(".lpriv a"));
  global.confirmTest = true;
  global.fails["08120756325"] = 0;

  // SECRETARY logs an order for a new customer
  await login("08000000091"); await shot("02-sec-empty");
  console.log("push banner for staff:", await page.isVisible("#pushon"));
  await T("#tabs button.new"); await shot("02b-log-empty"); await T("#cnew");
  await page.fill("#ph", "08011112222"); await page.waitForTimeout(400);
  await page.fill("#nm", "Ade Bello"); console.log("staff sees greeting question (expect false):", await page.isVisible(".gchips")); await T('[data-hm="no"]');
  await T('[data-add="it0"]'); await T('[data-add="it0"]'); await T('[data-svc="wo"]'); await T('[data-add="it1"]');
  await T('[data-add="it3"]'); await page.fill("#sp", "Wedding gown"); await T("#spa");
  await page.selectOption("#br", "b2");
  await shot("03-sec-log");
  console.log("staff sees paid-now field:", await page.isVisible("#pd"));
  await page.fill("#pd", "1000"); await page.waitForTimeout(150);
  await T("#save"); await page.waitForTimeout(500); await shot("04-sec-orders");
  console.log("drop-off payment saved:", JSON.stringify(db.order_money[0].payments), "auto billed (has special item, expect false):", !!db.order_money[0].billed_at);
  console.log("order saved:", JSON.stringify(db.orders.map(o => [o.no, o.status, o.branch_id, o.items.length])));
  console.log("customer:", JSON.stringify(db.customers.map(c => [c.name, c.mark, c.greet])));
  // secretary opens it, washed, check, ready
  await T(".order"); await shot("05-sec-order");
  console.log("sec order sheet has ₦:", (await page.textContent("#sheet")).includes("₦"));
  await page.fill("#pay", "500"); await T("#pp"); await T('.cfm [data-c="1"]'); await page.waitForTimeout(400);
  await page.evaluate(() => { const s = document.querySelector("#sheet"); s.scrollTop = 300; }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, "05b-staff-pay.png") });
  console.log("staff payment:", JSON.stringify(global.lastPay), "| staff sheet shows amounts:", /₦\s?\d/.test(await page.textContent("#sheet")));
  await T("#washed"); const n = (await page.$$("[data-ck]")).length; for (let i = 0; i < n; i++) { await page.check(`[data-ck="${i}"]`); await page.waitForTimeout(150); }
  await T("#rd"); console.log("status after sec ready:", db.orders[0].status);
  await T("#sheet [data-back]");
  // log out
  await T("#gear"); await shot("06-sec-settings");
  console.log("staff sees price list (expect true):", await page.isVisible(".pli.ro"), "| shirt price shown:", (await page.textContent("#view")).includes("₦800"), "| no edit inputs:", !(await page.isVisible("[data-pp]"))); await T("#out"); await T("#out"); await page.waitForTimeout(500);

  // OWNER
  global.planFail = true;
  await login("08120756325"); await shot("07-owner-orders");
  { // a far-right filter stays visible after tapping it (the row used to jump back to the start)
    await page.click('[data-f="picked"]'); await page.waitForTimeout(300);
    const vis = await page.evaluate(() => { const c = document.querySelector('[data-f="picked"]'), row = c.parentElement, a = c.getBoundingClientRect(), b = row.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1; });
    console.log("tapped filter stays in view:", vis); await shot("07b-filter-in-view");
    await page.click('[data-f="all"]'); await page.waitForTimeout(300);
  }
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(300); await T('[data-st="plan"]'); global.planCalls = 0; await page.waitForTimeout(2500);
  console.log("plan down: calls in 2.5s (expect <=1):", global.planCalls, "| try again shown:", await page.isVisible("#planretry"));
  global.planFail = false; await T("#planretry"); await page.waitForTimeout(600);
  console.log("plan after Try again shows plans:", await page.isVisible("[data-plan]"));
  await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(400);
  if (process.env.CAPTURE_LEADS) { // design review: leads page with the call script
    db.outreach_leads = [
      { id: "l1", name: "K-kleen Laundry", area: "NDDC Rd, Oba Ile", city: "Akure", phone: "08036661786", status: "replied", notes: "Said he'd reach out. Price question answered.", created_at: new Date().toISOString() },
      { id: "l2", name: "Washmenn Laundry", area: "Oda Rd", city: "Akure", phone: "08031112222", status: "new", notes: null, created_at: new Date().toISOString() }];
    db.outreach_log = [];
    await page.setViewportSize({ width: 390, height: 1700 });
    await page.goto("http://localhost:8787/#admin"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-av="leads"]').catch(() => {}); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.CAPTURE_LEADS, "leads-closed.png") });
    await page.evaluate(() => { const a = document.querySelector('[data-call="l2"]'); a.removeAttribute("href"); a.click(); }); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.CAPTURE_LEADS, "leads-open.png") });
    process.exit(0);
  }
  if (process.env.CAPTURE_ORDERS) { // design review: order list under each filter, on a phone
    await page.setViewportSize({ width: 390, height: 1400 });
    // sample orders in every state, like a real shop's day
    const t0 = db.orders[0];
    const add = (no, name, mark, status, billed, total, paid) => {
      const cid = "c" + no, id = "s" + no;
      db.customers.push({ id: cid, shop_id: t0.shop_id, name, mark, created_at: new Date().toISOString(), greet: null, greet_asked: true });
      db.customer_phones.push({ customer_id: cid, shop_id: t0.shop_id, phone: "0803000" + String(1000 + no).slice(-4) });
      db.orders.push({ ...JSON.parse(JSON.stringify(t0)), id, no, customer_id: cid, branch_id: "b1", status, list_sent: status !== "new", notified: true, billed, settled: billed && paid >= total, created_at: new Date().toISOString() });
      db.order_money.push({ order_id: id, shop_id: t0.shop_id, unit: null, custom: {}, delivery: 0, discount: 0, total: billed ? total : 0, billed_at: billed ? new Date().toISOString() : null, paid, payments: paid ? [{ amt: paid, at: Date.now(), method: "transfer", by: "Bolu" }] : [], express_amt: 0 });
    };
    add(2, "Collins Okoro", "CO", "told", true, 10000, 2500);
    add(3, "Funmi Adeyemi", "FA", "new", false, 0, 0);
    add(4, "Tunde Bakare", "TB", "listed", false, 0, 2000);
    add(5, "Grace Ojo", "GO", "listed", true, 6500, 0);
    add(6, "Kemi Alade", "KA", "picked", true, 4800, 4800);
    add(7, "Musa Ibrahim", "MI", "told", true, 3000, 3000);
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForSelector(".order", { timeout: 8000 });
    for (const f of ["all", "new", "work", "ready", "owed", "picked"]) {
      await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(400);
      await page.click(`[data-f="${f}"]`, { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(process.env.CAPTURE_ORDERS, `orders-${f}.png`) });
    }
    process.exit(0);
  }
  if (process.env.CAPTURE_INVOICE) { // design review: invoice settings, the send block on an order, and the PDFs
    const out = process.env.CAPTURE_INVOICE, t0 = db.orders[0];
    db.customers.push({ id: "ci", shop_id: t0.shop_id, name: "Adaeze Okafor", mark: "AO", created_at: new Date().toISOString(), greet: "ma", greet_asked: true });
    db.customer_phones.push({ customer_id: "ci", shop_id: t0.shop_id, phone: "08031234567" });
    db.orders.push({ ...JSON.parse(JSON.stringify(t0)), id: "oi", no: 41, customer_id: "ci", branch_id: "b1", status: "ready", list_sent: true, notified: true, billed: true, settled: false, created_at: new Date(Date.now() - 2 * 864e5).toISOString() });
    const its = db.orders.find(o => o.id === "oi").items;
    const unit = its.map(() => 800), total = its.reduce((s, it) => s + 800 * it.qty, 0);
    db.order_money.push({ order_id: "oi", shop_id: t0.shop_id, unit, custom: {}, delivery: 500, discount: 0, total: total + 500, billed_at: new Date().toISOString(), paid: 1000, payments: [{ amt: 1000, at: Date.now(), method: "cash" }], express_amt: 0 });
    Object.assign(db.shop_private[0], { inv_tagline: "Laundry and dry cleaning", inv_address: "12 Oba Adesida Road, Akure", inv_phone: "08120756325", inv_email: "hello@brightwash.ng", inv_terms: "Clothes not collected within 30 days may be given away. Please check your pockets before drop-off." });
    await page.setViewportSize({ width: 390, height: 2400 });
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-st="invoice"]'); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "settings-before-logo.png"), fullPage: true });
    await page.setInputFiles("#ilf", process.env.LOGO); await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, "settings-with-logo.png"), fullPage: true });
    console.log("swatches:", await page.$$eval("[data-ic]", b => b.map(x => x.dataset.ic + (x.getAttribute("aria-pressed") === "true" ? "*" : ""))));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#isample")]); await dl.saveAs(path.join(out, "sample.pdf"));
    await page.click("[data-ic]:nth-child(4)"); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "settings-navy.png"), fullPage: true });
    await page.click("[data-ic]:nth-child(1)"); await page.waitForTimeout(600);
    await page.setViewportSize({ width: 390, height: 1500 });
    await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(500);
    await page.click('.order:has-text("Adaeze")'); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "order-send.png") });
    await page.screenshot({ path: path.join(out, "order-name-check.png") });
    await page.click("[data-bt]"); await page.waitForTimeout(300); await page.fill("#btn-in", "Mrs. Adaeze Okafor");
    await page.screenshot({ path: path.join(out, "order-billto-edit.png") });
    await page.click("#btn-save"); await page.waitForTimeout(500);
    console.log("invoice name saved:", db.customers.find(c => c.id === "ci").inv_name, "| saved name kept:", db.customers.find(c => c.id === "ci").name);
    await page.screenshot({ path: path.join(out, "order-send.png") });
    await page.click("details.wtext summary"); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "order-send-text-open.png") });
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('[data-pdf="ready"]')]); await dl2.saveAs(path.join(out, "order.pdf"));
    process.exit(0);
  }
  if (process.env.CAPTURE) { // design review: every Settings section, phone and laptop, optional extra CSS
    const css = process.env.EXTRA_CSS ? fs.readFileSync(process.env.EXTRA_CSS, "utf8") : "";
    for (const [w, h, tag] of [[390, 2600, "phone"], [1280, 1800, "laptop"]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const t of ["business", "prices", "branches", "staff", "account", "plan"]) {
        await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(400);
        if (css) await page.addStyleTag({ content: css });
        await page.click(`[data-st="${t}"]`, { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(process.env.CAPTURE, `${tag}-${t}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); process.exit(0);
  }
  // an owner still on the old password is asked once to confirm their PIN
  global.unswitched.add(db.staff.find(x => x.phone === "08120756325").user_id);
  await page.reload(); await page.waitForSelector("#llater", { timeout: 8000 }); await shot("07a-confirm-pin");
  console.log("confirm screen:", (await page.textContent(".lask")).slice(0, 60), "| not now button:", await page.isVisible("#llater"));
  await page.keyboard.type("482915"); await page.waitForSelector("#tabs button", { timeout: 8000 });
  console.log("after confirming PIN, app opens and no prompt again:", await page.isVisible("#tabs button") && !(await page.isVisible("#llater")));
  console.log("push banner for owner:", await page.isVisible("#pushon"), "(permission:", await page.evaluate(() => Notification.permission) + ")");
  if (await page.isVisible("#pushon")) { await page.click("#pushlater"); await page.waitForTimeout(200); console.log("banner gone after Not now:", !(await page.isVisible("#pushon"))); }
  await page.reload(); await page.waitForTimeout(800); console.log("still logged in after reload:", await page.isVisible("#tabs button"));
  await ctx.unroute(SB + "/**"); await ctx.route(SB + "/**", r => r.abort());
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem("tagbook-auth")); k.expires_at = 1; localStorage.setItem("tagbook-auth", JSON.stringify(k)); });
  await page.reload(); await page.waitForTimeout(10500); console.log("no internet shows:", (await page.textContent("#view")).slice(0, 60), "| login shown:", await page.isVisible("#lf"));
  await ctx.unroute(SB + "/**"); await ctx.route(SB + "/**", handle);
  await page.click("#retry"); await page.waitForTimeout(10000); console.log("after retry logged in:", await page.isVisible("#tabs button"));
  await T(".order"); await page.evaluate(() => { const g = document.querySelector(".gask"); if (g) g.scrollIntoView({ block: "center" }); }); await shot("08-owner-order");
  await T('[data-done="list"]').catch(() => {});
  console.log("status after list sent attempt:", db.orders[0].status);
  await page.fill('[data-cp="2"]', "6000"); await page.fill("#dl", "1500"); await T("#ex"); await T("#bill"); await page.waitForTimeout(400);
  { const wg = db.items.find(x => x.name === "Wedding gown"); console.log("bill special item added to price list:", !!wg, wg && JSON.stringify(db.item_prices.find(x => x.item_id === wg.id).prices)); }
  const mm = db.order_money[0]; console.log("bill:", JSON.stringify({ total: mm.total, unit: mm.unit, exp: mm.express_amt, billed: db.orders[0].billed }));
  await shot("09-owner-billed");
  // message
  console.log("owner asked to pick greeting before sending:", await page.isVisible(".gask"), "| send hidden:", !(await page.isVisible("#wamsg-ready")));
  await page.evaluate(() => document.querySelector(".gask").scrollIntoView({ block: "center" })); await shot("08b-ask-greeting");
  await T('#sheet [data-og="__other"]'); await page.fill("#data-og-txt", "Alhaji"); await T("#og-save"); await page.waitForTimeout(300); console.log("greet saved:", db.customers[0].greet, db.customers[0].greet_asked);
  const waText = await page.textContent("#sheet");
  console.log("ready msg has invoice:", waText.includes("INVOICE INV-1"), "greets Alhaji:", waText.includes("Hello Alhaji,"), "no name line:", !waText.includes("Customer: Ade"), "has bank:", waText.includes("0123456789"));
  await T('[data-done="ready"]'); console.log("status:", db.orders[0].status);
  await page.fill("#pay", "5000"); await T("#pp"); await T('.cfm [data-c="1"]'); await page.waitForTimeout(300);
  console.log("money after part pay:", db.order_money[0].paid, "settled:", db.orders[0].settled);
  await page.$eval("#ppall", e => e.scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(out, "09b-pay-form.png") });
  await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  console.log("print button:", await page.textContent("#prt")); await T("#prt"); await page.waitForTimeout(200);
  console.log("print called:", await page.evaluate(() => window.__printed), "| receipt has total:", (await page.textContent("#receipt")).includes("TOTAL"));
  await page.emulateMedia({ media: "print" }); await page.evaluate(() => document.body.classList.add("printing"));
  await page.locator("#receipt").screenshot({ path: path.join(out, "30-receipt-80.png") });
  await page.evaluate(() => { document.querySelector("#receipt").className = "p58"; }); await page.locator("#receipt").screenshot({ path: path.join(out, "31-receipt-58.png") });
  await page.evaluate(() => document.body.classList.remove("printing")); await page.emulateMedia({ media: "screen" });
  console.log("pay-all label:", await page.textContent("#ppall")); await T("#ppall"); await T('.cfm [data-c="1"]'); await page.waitForTimeout(400); console.log("after pay-all:", db.order_money[0].paid, "of", db.order_money[0].total, "settled:", db.orders[0].settled);
  await T("#pick"); await shot("10a-confirm-picked"); await T('.cfm [data-c="0"]'); console.log("go back keeps status:", db.orders[0].status); await T("#pick"); await T('.cfm [data-c="1"]'); console.log("status:", db.orders[0].status); await shot("10-owner-picked");
  await T("#sheet [data-back]");
  // owner logs a returning customer with early payment
  await T("#tabs button.new"); await shot("11a-log-recent"); await page.fill("#cq", "ade"); await page.waitForTimeout(300); await shot("11b-log-search");
  await T("[data-pick]"); console.log("returning picked:", (await page.textContent("#view")).includes("Regular customer")); await shot("11c-log-picked");
  await T('[data-add="it2"]'); await page.fill("#pd", "2000"); await T("#save"); await page.waitForTimeout(500);
  console.log("orders:", JSON.stringify(db.orders.map(o => [o.no, o.status, o.notified])), "paid #2:", db.order_money[1].paid);
  await shot("11-owner-order2");
  await page.evaluate(() => { const s = document.querySelector("#sheet"); s.scrollTop = 520; }); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, "11d-owner-order2-bill.png") });
  console.log("auto-billed order shows:", (await page.textContent("#bill")).trim());
  await T("#sheet [data-back]");
  // owner logs a special item with a price: it lands on the price list
  {
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(500);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(400); await T("[data-pick]"); await page.waitForTimeout(200);
    const sp = db.items.find(x => x.custom); await T(`[data-add="${sp.id}"]`); await page.fill("#sp", "Curtain big"); await page.fill("#spp", "4500"); await shot("29-special-price"); await T("#spa"); await page.waitForTimeout(500);
    const ni = db.items.find(x => x.name === "Curtain big"); const np = ni && db.item_prices.find(x => x.item_id === ni.id);
    console.log("special item added to price list:", !!ni, np && JSON.stringify(np.prices), "| on order as normal item:", await page.isVisible(`[data-add="${ni && ni.id}"]`));
  }
  // owner edits clothes, edits customer, cancels and restores an order
  {
    const o = db.orders.find(x => x.status !== "picked") || db.orders[0]; console.log("edit test order:", o.no, o.status); await page.goto("http://localhost:8787/#order-" + o.no); await page.waitForTimeout(500);
    await T("#omore"); await shot("30a-more-menu"); await T('[data-om="items"]');
    const before = JSON.stringify(o.items); await T('[data-qp="0"]'); await T("#fxaddopen"); await T("#fxaddgo"); await shot("30b-edit-clothes");
    console.log("edit preview:", (await page.textContent("#sheet")).match(/New total₦[\d,]+/)?.[0]);
    await T("#fxsave"); await page.waitForTimeout(400);
    const m = db.order_money.find(x => x.order_id === o.id);
    console.log("items saved:", before, "->", JSON.stringify(o.items), "| total now", m.total, "billed", !!m.billed_at);
    await T("#omore"); await T('[data-om="cust"]'); await page.fill("#fxn", db.customers.find(c => c.id === o.customer_id).name + " Jr"); await T("#fxcsave"); await page.waitForTimeout(300);
    console.log("customer renamed:", db.customers.find(c => c.id === o.customer_id).name);
    await T("#omore"); await T('[data-om="cancel"]'); await shot("30c-cancel"); await T("#fxcancel"); await page.waitForTimeout(500);
    console.log("cancelled in db:", !!o.cancelled_at, "| hash", await page.evaluate(() => location.hash), "| cancelled chip:", !!(await page.$('[data-f="cx"]')));
    await T('[data-f="cx"]'); await shot("30d-cancelled-list"); console.log("cancelled list rows:", (await page.$$(".order")).length);
    await T(".order"); await page.waitForTimeout(300); await shot("30e-cancelled-order"); await T("#fxrestore"); await page.waitForTimeout(400);
    console.log("restored:", !o.cancelled_at); await T("#sheet [data-back]");
  }
  // reports
  await T('#tabs button[data-tab="reports"]'); await shot("12-reports");
  console.log("reports received:", await page.textContent(".rhero b"));
  // settings: add staff, price edit, branch add
  await T("#gear"); await shot("13a-settings-business");
  await T('[data-st="account"]'); await page.waitForTimeout(400); console.log("account notifications box:", (await page.textContent("#pushbox")).trim().slice(0, 40)); await shot("13x-account");
  await T('[data-st="shops"]'); await page.waitForTimeout(300);
  await page.fill("#as-n", "Saheed Dry Cleaners"); await page.fill("#as-b", "Main branch, Awule point, Oke-Ijebu point"); await page.fill("#as-on", "Saheed Bello"); await page.fill("#as-op", "08055556666"); await page.fill("#as-pin", "246810"); await page.selectOption("#as-r", { index: 1 });
  await T("#as-go"); await page.waitForTimeout(500); console.log("create_shop sent:", JSON.stringify(global.lastCreate)); await shot("16-admin-created");
  console.log("shops listed:", (await page.textContent("#view")).includes("Saheed Dry Cleaners"), "| referral shown:", (await page.textContent("#view")).includes("Referred by BrightWash Test"), (await page.textContent("#view")).includes("Brought 1 shop"));
  await T('[data-st="business"]');
  await T('[data-st="staff"]');
  await page.fill("#sfn", "Tolu"); await page.fill("#sfp", "08033334444"); await page.fill("#sfk", "123456"); await T("#sfa"); await page.waitForTimeout(400);
  console.log("staff share card:", !!(await page.$("#nsfwa")), (await page.getAttribute("#nsfwa", "href") || "").slice(0, 60)); await page.$eval("#nsfwa", e => e.scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(out, "15b-staff-share.png") }); await T("#nsfdone");
  console.log("staff now:", db.staff.map(s => s.name).join(", "));
  await T('[data-st="prices"]'); await shot("13b-prices-phone"); await T('[data-popen="it0"]'); await shot("13c-price-open");
  await page.fill('#pp-it0-wi', "900"); await page.press('#pp-it0-wi', "Tab"); await page.waitForTimeout(300);
  console.log("shirt price:", JSON.stringify(db.item_prices[0].prices));
  await T('[data-st="branches"]'); await page.fill("#nb", "Third point"); await T("#nbb"); await page.waitForTimeout(300);
  console.log("branches:", db.branches.map(b => b.name).join(", "));
  await shot("13-owner-settings");
  // dark mode
  await T("#themebtn"); await T("[data-back]"); await shot("14-dark"); await T("#themebtn");
  // owner hides prices from staff
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(300); await T('[data-st="staff"]'); await shot("13b-staff-prices-toggle");
  await T('[data-sp="0"]'); await page.waitForTimeout(300); console.log("staff_prices saved off:", db.shops[0].staff_prices === false);
  // staff types a regular customer's full number: picked automatically; unknown number opens New customer
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(300); await T('[data-st="account"]'); await T("#out"); await T("#out"); await page.waitForTimeout(500);
  await login("08000000091"); await T("#tabs button.new");
  await page.fill("#cq", "08011112222"); await page.waitForTimeout(600); console.log("staff full number picks:", (await page.textContent("#view")).includes("Regular customer"));
  console.log("staff sees phone anywhere:", (await page.textContent("#view")).includes("0801"));
  await T("#cchange"); await page.fill("#cq", "08099998888"); await page.waitForTimeout(600); console.log("unknown number opens new:", await page.isVisible("#nm"), await page.inputValue("#ph"));
  await shot("15-staff-newfromsearch");
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(400); console.log("staff price list hidden after owner turns off (expect false):", await page.isVisible(".pli.ro"));
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(300); await T("#out"); await T("#out"); await page.waitForTimeout(500); await login("08120756325");
  // laptop
  await page.setViewportSize({ width: 1440, height: 900 });
  // pagination: make 45 orders, expect 20 a page
  for (let i = 0; i < 45; i++) { const o = JSON.parse(JSON.stringify(db.orders[0])); o.id = "pg" + i; o.no = 1000 + i; db.orders.push(o); db.order_money.push({ ...db.order_money[0], order_id: o.id }); }
  await page.goto("http://localhost:8787/#orders"); await page.waitForSelector("#tabs button"); await page.waitForTimeout(500); await shot("20-laptop-orders");
  await page.reload(); await page.waitForSelector(".pager"); console.log("rows on page 1:", (await page.$$(".order")).length, "|", await page.textContent(".pager span"));
  await page.click("#pgnext"); await page.waitForTimeout(200); console.log("page 2:", await page.textContent(".pager span"));
  await page.click("#pgnext"); await page.waitForTimeout(200); console.log("page 3:", await page.textContent(".pager span"), "rows:", (await page.$$(".order")).length, "older disabled:", await page.isDisabled("#pgnext"));
  await page.fill("#q", "ade"); await page.waitForTimeout(200); console.log("search resets to:", await page.textContent(".pager span"));
  await page.fill("#q", ""); await page.waitForTimeout(200);
  await page.click(".order"); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, "21-laptop-order.png") });
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(400); await T('[data-st="prices"]'); await shot("22-laptop-prices");
  await T('[data-st="shops"]'); await page.waitForTimeout(300);
  await page.fill("#as-n", "Saheed Dry Cleaners"); await page.fill("#as-b", "Main branch, Awule point, Oke-Ijebu point"); await page.fill("#as-on", "Saheed Bello"); await page.fill("#as-op", "08055556666"); await page.fill("#as-pin", "246810"); await page.selectOption("#as-r", { index: 1 });
  await T("#as-go"); await page.waitForTimeout(500); console.log("create_shop sent:", JSON.stringify(global.lastCreate)); await shot("16-admin-created");
  console.log("shops listed:", (await page.textContent("#view")).includes("Saheed Dry Cleaners"), "| referral shown:", (await page.textContent("#view")).includes("Referred by BrightWash Test"), (await page.textContent("#view")).includes("Brought 1 shop"));
  await T('[data-st="business"]'); await shot("23-laptop-business");
  await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(400); await shot("24-laptop-log");
  await page.goto("http://localhost:8787/#reports"); await page.waitForTimeout(400); await shot("25-laptop-reports");
  console.log("ERRORS:", errors.length ? errors : "none");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
