// Drives the built app in a phone-sized browser against a stand-in Supabase, owner and secretary.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const SB = "https://uungxatdvelljmaugzuz.supabase.co";
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

// ---- in-memory database ----
const shopId = "shop1", ownerId = "u-owner", secId = "u-sec";
const db = {
  shops: [{ id: shopId, name: "BrightWash Test", created_at: new Date(Date.now() - 86400e3 * 3).toISOString(), next_no: 1 }],
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
  if (p === "/rest/v1/rpc/is_platform_admin") return send(200, current === ownerId);
  if (p === "/rest/v1/rpc/my_plan") return send(200, { state: "trial", until: "2099-01-01", grace_until: "2099-01-03", days_left: 9999 });
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
  if (p === "/rest/v1/rpc/owner_set_greet") { db.customers.find(c => c.id === body.p_customer).greet = body.p_greet; return send(200, { ok: true, greet: body.p_greet }); }
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
      c = { id: uid(), shop_id: shopId, name: x.name, mark: x.mark, greet: x.greet || null, created_at: new Date().toISOString() }; db.customers.push(c); db.customer_phones.push({ customer_id: c.id, shop_id: shopId, phone: x.phone }); }
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
  const login = async (phone, pin = "482915") => { await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad"); if (await page.$(".lhi")) { await page.click("#lhelp"); await page.click("#lswitch"); } await page.keyboard.type(phone); await page.keyboard.press("Enter"); await page.waitForTimeout(100); await page.keyboard.type(pin); await page.waitForSelector("#tabs button"); };
  const T = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };

  // bad login
  await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad"); await shot("01-login");
  await page.keyboard.type("08120756325"); await page.keyboard.press("Enter"); await page.keyboard.type("111111"); await page.waitForTimeout(600);
  console.log("bad login message:", await page.textContent(".lerr"));

  // SECRETARY logs an order for a new customer
  await login("08000000091"); await shot("02-sec-empty");
  console.log("push banner for staff:", await page.isVisible("#pushon"));
  await T("#tabs button.new"); await shot("02b-log-empty"); await T("#cnew");
  await page.fill("#ph", "08011112222"); await page.waitForTimeout(400);
  await page.fill("#nm", "Ade Bello"); await T('[data-gr="boss"]'); await page.evaluate(() => document.querySelector(".gchips").scrollIntoView({ block: "center" })); await shot("02c-greet"); await T('[data-hm="no"]');
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
  await page.fill("#pay", "500"); await T("#pp"); await page.waitForTimeout(400);
  await page.evaluate(() => { const s = document.querySelector("#sheet"); s.scrollTop = 300; }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, "05b-staff-pay.png") });
  console.log("staff payment:", JSON.stringify(global.lastPay), "| staff sheet shows amounts:", /₦\s?\d/.test(await page.textContent("#sheet")));
  await T("#washed"); const n = (await page.$$("[data-ck]")).length; for (let i = 0; i < n; i++) { await page.check(`[data-ck="${i}"]`); await page.waitForTimeout(150); }
  await T("#rd"); console.log("status after sec ready:", db.orders[0].status);
  await T("#sheet [data-back]");
  // log out
  await T("#gear"); await shot("06-sec-settings"); await T("#out"); await T("#out"); await page.waitForTimeout(500);

  // OWNER
  await login("08120756325"); await shot("07-owner-orders");
  console.log("push banner for owner:", await page.isVisible("#pushon"), "(permission:", await page.evaluate(() => Notification.permission) + ")");
  if (await page.isVisible("#pushon")) { await page.click("#pushlater"); await page.waitForTimeout(200); console.log("banner gone after Not now:", !(await page.isVisible("#pushon"))); }
  await page.reload(); await page.waitForTimeout(800); console.log("still logged in after reload:", await page.isVisible("#tabs button"));
  await ctx.unroute(SB + "/**"); await ctx.route(SB + "/**", r => r.abort());
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem("tagbook-auth")); k.expires_at = 1; localStorage.setItem("tagbook-auth", JSON.stringify(k)); });
  await page.reload(); await page.waitForTimeout(10500); console.log("no internet shows:", (await page.textContent("#view")).slice(0, 60), "| login shown:", await page.isVisible("#lf"));
  await ctx.unroute(SB + "/**"); await ctx.route(SB + "/**", handle);
  await page.click("#retry"); await page.waitForTimeout(10000); console.log("after retry logged in:", await page.isVisible("#tabs button"));
  await T(".order"); await shot("08-owner-order");
  await T('[data-done="list"]').catch(() => {});
  console.log("status after list sent attempt:", db.orders[0].status);
  await page.fill('[data-cp="2"]', "6000"); await page.fill("#dl", "1500"); await T("#ex"); await T("#bill"); await page.waitForTimeout(400);
  const mm = db.order_money[0]; console.log("bill:", JSON.stringify({ total: mm.total, unit: mm.unit, exp: mm.express_amt, billed: db.orders[0].billed }));
  await shot("09-owner-billed");
  // message
  const waText = await page.textContent("#sheet");
  console.log("ready msg has invoice:", waText.includes("INVOICE INV-1"), "greets Boss:", waText.includes("Hello Boss,"), "no name line:", !waText.includes("Customer: Ade"), "has bank:", waText.includes("0123456789"));
  await T('[data-done="ready"]'); console.log("status:", db.orders[0].status);
  await page.fill("#pay", "5000"); await T("#pp"); await page.waitForTimeout(300);
  console.log("money after part pay:", db.order_money[0].paid, "settled:", db.orders[0].settled);
  await page.$eval("#ppall", e => e.scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(out, "09b-pay-form.png") });
  console.log("pay-all label:", await page.textContent("#ppall")); await T("#ppall"); await page.waitForTimeout(400); console.log("after pay-all:", db.order_money[0].paid, "of", db.order_money[0].total, "settled:", db.orders[0].settled);
  await T("#pick"); console.log("status:", db.orders[0].status); await shot("10-owner-picked");
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
  // staff types a regular customer's full number: picked automatically; unknown number opens New customer
  await page.goto("http://localhost:8787/#shop"); await page.waitForTimeout(300); await T('[data-st="account"]'); await T("#out"); await T("#out"); await page.waitForTimeout(500);
  await login("08000000091"); await T("#tabs button.new");
  await page.fill("#cq", "08011112222"); await page.waitForTimeout(600); console.log("staff full number picks:", (await page.textContent("#view")).includes("Regular customer"));
  console.log("staff sees phone anywhere:", (await page.textContent("#view")).includes("0801"));
  await T("#cchange"); await page.fill("#cq", "08099998888"); await page.waitForTimeout(600); console.log("unknown number opens new:", await page.isVisible("#nm"), await page.inputValue("#ph"));
  await shot("15-staff-newfromsearch");
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
