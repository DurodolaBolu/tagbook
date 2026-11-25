// Drives the built app in a phone-sized browser against a stand-in Supabase, owner and secretary.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const SB = "https://uungxatdvelljmaugzuz.supabase.co";
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

// ---- in-memory database ----
const shopId = "shop1", ownerId = "u-owner", secId = "u-sec";
const db = { expenses: [], order_photos: [], send_log: [], quick_replies: [], shop_followups: [], shop_remarks: [],
  shops: [{ id: shopId, name: "BrightWash Test", created_at: new Date(Date.now() - 86400e3 * 3).toISOString(), next_no: 1, staff_prices: true }],
  branches: [{ id: "b1", shop_id: shopId, name: "Main branch", sort: 0, active: true }, { id: "b2", shop_id: shopId, name: "Second point", sort: 1, active: true }],
  staff: [{ user_id: ownerId, shop_id: shopId, role: "owner", name: "Bolu", phone: "08120756325", active: true, created_at: "2026-11-01" },
          { user_id: secId, shop_id: shopId, role: "secretary", name: "Grace", phone: "08000000091", active: true, created_at: "2026-11-02" }],
  shop_private: [{ shop_id: shopId, express_type: "percent", express_value: 50, bank_name: "GTBank", acct_no: "0123456789", acct_name: "BrightWash", setup: { ref_pop: Date.now() } }],
  items: [], item_prices: [], customers: [], customer_phones: [], orders: [], order_money: [],
};
const P = [["Shirt", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Trouser", { wi: 800, wo: 500, io: 300, wsi: 1000 }], ["Native (2 piece)", { wi: 1500, wo: 1000, io: 600, wsi: 2000 }], ["Special item", null]];
P.forEach(([n, p], i) => { const id = "it" + i; db.items.push({ id, shop_id: shopId, name: n, custom: !p, services: p ? Object.keys(p) : ["wi", "wo", "io", "wsi"], sort: i, hidden: false }); if (p) db.item_prices.push({ item_id: id, shop_id: shopId, prices: p }); });
let current = null; // logged-in user id
const ownerOnly = new Set(["expenses", "shop_private", "item_prices", "customer_phones", "order_money"]);
const staffMay = t => t === "item_prices" && db.shops[0].staff_prices;
const biller = () => { const me = db.staff.find(s => s.user_id === current); return me && (me.role === "owner" || me.can_bill); };
const rowsFor = t => { const me = db.staff.find(s => s.user_id === current); if (ownerOnly.has(t) && me.role !== "owner" && !staffMay(t) && !(t !== "expenses" && me.can_bill)) return []; return db[t]; };
function filterRows(rows, params) {
  for (const [k, v] of params) { if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") rows = rows.filter(r => String(r[k]) === val);
    if (op === "in") { const set = val.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/"/g, "")); rows = rows.filter(r => set.includes(String(r[k]))); } }
  return rows;
}
const pk = { expenses: "id", order_photos: "id", send_log: "id", quick_replies: "id", shop_followups: "shop_id", shop_remarks: "id", orders: "id", order_money: "order_id", items: "id", item_prices: "item_id", shops: "id", shop_private: "shop_id", branches: "id", customers: "id", customer_phones: "customer_id", staff: "user_id" };
const errors = [];
async function handle(route) {
  const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
  let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (_) { body = null; }
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
    if (!s || body.pin !== ((global.pins || {})[body.phone] || "482915")) { global.fails[body.phone] = (global.fails[body.phone] || 0) + 1; return global.fails[body.phone] >= 5 ? send(429, { error: "LOCKED", wait: 900 }) : send(401, { error: "BAD_LOGIN" }); }
    global.fails[body.phone] = 0; current = s.user_id; if (global.unswitched) global.unswitched.delete(s.user_id);
    return send(200, { access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.sig", refresh_token: "r" });
  }
  if (p === "/rest/v1/rpc/wa_check_status") return send(200, !!global.resetOk);
  if (p === "/functions/v1/admin" && (body.action === "pin_reset_start" || body.action === "pin_reset_finish")) {
    if (!db.staff.some(s => s.phone === body.phone)) return send(404, { error: "NO_ACCOUNT" });
    if (body.action === "pin_reset_start") return send(200, { ok: true, wa_to: "2349160478738", wa_code: "731905", check_id: "22222222-2222-2222-2222-222222222222" });
    if (!global.resetOk) return send(400, { error: "NOT_VERIFIED" });
    global.pins = { ...(global.pins || {}), [body.phone]: body.pin }; global.fails[body.phone] = 0; return send(200, { ok: true });
  }
  if (p === "/functions/v1/admin" && (body.action === "signup_code" || body.action === "self_signup")) {
    if (body.action === "signup_code") return global.waMode ? send(200, { ok: true, wa_to: "2347000000000", wa_code: "482913", check_id: "11111111-1111-1111-1111-111111111111" }) : send(400, { error: "CODES_OFF" });
    if (global.waMode && !global.waOk) return send(400, { error: "NOT_VERIFIED" });
    global.signups = (global.signups || []).concat([body]);
    if (body.website) return send(400, { error: "BAD_FORM" });
    if (db.staff.some(s => s.phone === body.phone)) return send(409, { error: "PHONE_IN_USE" });
    if (body.ms < 4000) return send(400, { error: "TOO_FAST" });
    db.staff.push({ user_id: "u-new", shop_id: shopId, role: "owner", name: body.name, phone: body.phone, active: true, created_at: new Date().toISOString() });
    return send(200, { ok: true });
  }
  if (p === "/functions/v1/admin") {
    if (body.action === "create_shop") { global.lastCreate = body; if (current !== ownerId) return send(403, { error: "NOT_ALLOWED" }); db.shops.push({ id: uid(), name: body.shop, created_at: new Date().toISOString(), trial_ends: body.trial_ends, referred_by: body.referred_by }); global.lastCreate = body; return send(200, { ok: true }); }
    if (body.action === "add_staff") { if (db.staff.some(s => s.phone === body.phone)) return send(409, { error: "PHONE_IN_USE" }); db.staff.push({ user_id: uid(), shop_id: shopId, role: "secretary", name: body.name, phone: body.phone, active: true, created_at: new Date().toISOString() }); }
    return send(200, { ok: true });
  }
  if (p === "/rest/v1/rpc/admin_dashboard" && global.dashRows) return send(200, global.dashRows);
  if (p === "/rest/v1/rpc/admin_send_stats" && global.dashRows) return send(200, [{ kind: "pdf", stage: "ready", sends: 7, shops: 3 }, { kind: "text", stage: "ready", sends: 2, shops: 1 }]);
  if (/^\/rest\/v1\/rpc\/(admin_dashboard|admin_agents|admin_shops|team_options|admin_team_pay)$/.test(p)) return send(200, []);
  if (p === "/rest/v1/rpc/is_platform_admin") return send(200, current === ownerId && !process.env.CAPTURE_CALLS && !process.env.STORE_SHOTS);
  if (process.env.CAPTURE_CALLS && p === "/rest/v1/rpc/is_agent") return send(200, true);
  if (p.startsWith("/storage/v1/object/order-photos/") && method === "POST") { global.photoUploads = (global.photoUploads || 0) + 1; return send(200, { Key: p.slice(19) }); }
  if (p.startsWith("/storage/v1/object/sign/order-photos/") && method === "GET" && process.env.PHOTO_FILE) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(process.env.PHOTO_FILE) });
  if (p === "/functions/v1/photos" && method === "GET") return send(200, { shop: "BrightWash Test", no: 2, dropped: new Date().toISOString(), photos: db.order_photos.map(r => ({ url: SB + "/storage/v1/object/sign/order-photos/" + r.path + "?token=t", item: r.item, notes: r.notes, at: new Date().toISOString() })) });
  if (p === "/storage/v1/object/sign/order-photos") return send(200, (body.paths || []).map(x => ({ path: x, signedURL: "/object/sign/order-photos/" + x + "?token=t", error: null })));
  if (p === "/rest/v1/rpc/order_photo_link") return send(200, "a".repeat(36));
  if (p === "/rest/v1/rpc/goal_progress") return send(200, { active: 12, signups: 18, week_signups: 3, week_active: 2 });
  if (p === "/rest/v1/rpc/is_caller") return send(200, !!process.env.CAPTURE_CALLS);
  if (p === "/rest/v1/rpc/caller_leads") return send(200, (body.p_from ? [] : (global.callLeads || [])));
  if (p === "/rest/v1/rpc/caller_log_call") { const l = (global.callLeads || []).find(x => x.id === body.p_lead); l.status = body.p_status; l.notes = body.p_note; global.lastCall = body; return send(200, { ok: true }); }
  if (p === "/rest/v1/rpc/my_earnings") return send(200, []);
  if (p === "/rest/v1/rpc/agent_shops") return send(200, []);
  if (p === "/rest/v1/rpc/my_plan") { global.planCalls = (global.planCalls || 0) + 1; if (global.planFail) return send(500, { message: "down" }); }
  if (p === "/rest/v1/rpc/my_plan") return send(200, { state: "trial", until: "2099-01-01", grace_until: "2099-01-03", days_left: 9999, prices: { m1: 3000, m6: 15000, m12: 30000 } });
  if (p === "/rest/v1/rpc/admin_shops") return send(200, db.shops.map(s => ({ id: s.id, name: s.name, created_at: s.created_at, trial_ends: s.trial_ends || null, owner_name: "Bolu", owner_phone: "08120756325", staff: db.staff.length, orders: db.orders.length, last_order: new Date().toISOString(), referred_by: s.referred_by || null, referred_by_name: (db.shops.find(k => k.id === s.referred_by) || {}).name || null, referrals: db.shops.filter(k => k.referred_by === s.id).length })));
  if (p === "/rest/v1/rpc/agent_ref_options") return send(200, db.shops.map(s => ({ id: s.id, name: s.name })));
  if (p === "/rest/v1/rpc/team_options") return send(200, [{ id: "11111111-1111-1111-1111-111111111111", name: "Louis" }]);
  if (p === "/rest/v1/rpc/is_agent") return send(200, false);
  if (p === "/rest/v1/tutorials" && method === "GET") return send(200, [{ id: "t1", title: "How to install Tagbook on iPhone", youtube_id: "chuV8thnvrE", section: "start", audience: "all", step_key: "install", sort: 10 }, { id: "t2", title: "How to log a customer's clothes", youtube_id: "SiUDE8sCSQ4", section: "daily", audience: "all", step_key: "order", sort: 20 }, { id: "t3", title: "How to send the list of clothes to your customer", youtube_id: "hinlU63w8ck", section: "daily", audience: "owner", step_key: null, sort: 30 }]);
  if (p === "/rest/v1/rpc/set_staff_can_bill") { if (current !== ownerId) return send(400, { message: "OWNER_ONLY" }); db.staff.find(s => s.user_id === body.p_user).can_bill = body.p_on; return send(204); }
  if (p === "/rest/v1/rpc/remove_last_payment") { if (current !== ownerId) return send(400, { message: "OWNER_ONLY" }); const m = db.order_money.find(q => q.order_id === body.p_order); const last = m.payments.pop(); m.paid -= last.amt; const o = db.orders.find(q => q.id === body.p_order); o.settled = !!m.billed_at && m.paid >= m.total; return send(200, { removed: last.amt }); }
  if (p === "/rest/v1/rpc/pair_orders") {
    const A = db.orders.find(o => o.id === body.p_a), B = db.orders.find(o => o.id === body.p_b);
    if (!A || !B || A.customer_id !== B.customer_id) return send(200, false);
    A.pair_id = B.id; B.pair_id = A.id; return send(200, true);
  }
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
  if (p === "/rest/v1/rpc/track_info") {
    const o = db.orders.find(q => q.track_token === body.p_token); if (!o) return send(200, null);
    return send(200, { shop: db.shops[0].name, no: o.no, mark: (db.customers.find(c => c.id === o.customer_id) || {}).mark || "AD", status: o.status, at: o.created_at || new Date().toISOString(), collect: new Date(Date.now() + 2 * 864e5).toISOString(), picked: null, express: false, wait: false,
      items: o.items.map(it => ({ n: (db.items.find(i => i.id === it.id) || {}).name || "Item", q: it.qty, note: it.note || null, pcs: it.pcs || 1 })) });
  }
  if (p === "/rest/v1/rpc/log_order") {
    const x = body.p; const me = db.staff.find(s => s.user_id === current);
    let ph = db.customer_phones.find(c => c.phone === x.phone), c;
    if (x.customer_id) c = db.customers.find(cc => cc.id === x.customer_id);
    else if (ph) c = db.customers.find(cc => cc.id === ph.customer_id);
    else { const clash = db.customers.find(cc => cc.mark === x.mark); if (clash) return send(400, { message: "MARK_TAKEN:" + clash.name, code: "P0001" });
      c = { id: uid(), shop_id: shopId, name: x.name, mark: x.mark, greet: (current === ownerId && x.greet) || null, greet_asked: current === ownerId && "greet" in x, created_at: new Date().toISOString() }; db.customers.push(c); db.customer_phones.push({ customer_id: c.id, shop_id: shopId, phone: x.phone }); }
    const no = db.shops[0].next_no++; const id = uid();
    db.orders.push({ id, shop_id: shopId, no, customer_id: c.id, branch_id: x.branch_id, items: x.items, duty: x.duty || null, track_token: Math.random().toString(16).slice(2, 14).padEnd(12, "0") + "abcdef012345", express: x.express, wait_get: !!x.wait_get, collect_at: x.collect_at || null, remarks: x.remarks || null, money_found: x.money_found || null, pickup: x.pickup, status: "new", list_sent: false, checking: false, checked: {}, notified: me.role === "owner", billed: false, settled: false, created_at: new Date().toISOString() });
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
    if (ownerOnly.has(t) && db.staff.find(s => s.user_id === current).role !== "owner" && !(t === "order_money" && biller())) return send(403, { message: "rls" });
    if (t === "order_money" && db.staff.find(s => s.user_id === current).role !== "owner") { const ex = db.order_money.find(x => x.order_id === body.order_id); if ((+body.discount || 0) !== (ex ? +ex.discount || 0 : 0)) return send(400, { message: "DISCOUNT_OWNER_ONLY" }); }
    if (method === "DELETE") { const rows = filterRows(db[t], params); db[t] = db[t].filter(r => !rows.includes(r)); return send(204); }
    if (method === "PATCH") {
      const rows = filterRows(db[t], params);
      if (t === "orders" && db.staff.find(s => s.user_id === current).role !== "owner" && !biller() && ("billed" in body || "list_sent" in body || (body.status && ["listed", "told"].includes(body.status)))) return send(400, { message: "OWNER_ONLY" });
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: +(process.env.DSF || 1), serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/websocket|realtime|ERR_|404/i.test(m.text())) errors.push("console: " + m.text()); });
  await ctx.route(SB + "/**", handle);
  await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (_) {} });
  await ctx.routeWebSocket(/realtime/, ws => {});
  const shot = async n => page.screenshot({ path: path.join(out, n + ".png"), fullPage: true });
  const login = async (phone, pin = "482915") => { await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad, #pick-in"); if (await page.$("#pick-in")) await page.click("#pick-in"); if (await page.$(".lhi")) { await page.click("#lhelp"); await page.click("#lswitch"); } await page.keyboard.type(phone); await page.keyboard.press("Enter"); await page.waitForTimeout(100); await page.keyboard.type(pin); try { await page.waitForSelector("#tabs button", { timeout: 8000 }); } catch (e) { console.log("LOGIN STUCK:", await page.textContent(".lerr").catch(() => "?"), await page.evaluate(() => document.body.innerText.slice(0, 300))); throw e; } };
  const T = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };

  if (process.env.CAPTURE_DASH) { // design review: Bolu's Shops page
    const C = process.env.CAPTURE_DASH, now = Date.now(), iso = d => new Date(now - d * 864e5).toISOString();
    const row = (name, o) => ({ id: "s-" + name, name, created_at: iso(5), trial_ends: new Date(now + 20 * 864e5).toISOString().slice(0, 10), paid_until: null, founding: true, is_test: false, owner_name: "Owner", owner_phone: "08030000000", owners: 1, staff: 1, push: 1, orders: 12, today: 1, week: 5, prev_week: 4, clothes_week: 30, clothes: 80, last_order: iso(0), last_active: iso(0), referrals: 0, paid_total: 0, free_months: 0, state: "Ondo", area: "Akure", installed: true, ...o });
    global.dashRows = [row("SureClean Dry Cleaning", { installed: false }), row("Ksolo247 Laundry", { push: 0, self_signup: true, confirmed: false, area: "Oba Ile" }), row("Proclean", { state: "Lagos", area: "Lekki", last_order: iso(5) }), row("Kennycare", { last_order: iso(4) }), row("MG Laundry", { installed: false, push: 0, state: "Ekiti", area: "Ado" })];
    await login("08120756325").catch(() => {});
    await page.setViewportSize({ width: 390, height: 2600 }); await page.goto("http://localhost:8787/#admin"); await page.reload(); await page.waitForTimeout(1500);
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    await page.screenshot({ path: path.join(C, "dash.png"), fullPage: true }); console.log("dash text has App and alerts:", (await page.textContent("#view")).includes("App and alerts"), errs);
    await page.fill("#dq", "proc"); await page.waitForTimeout(300); console.log("search proc:", await page.$$eval(".dlist > *", e => e.length), (await page.textContent("#view")).includes("App and alerts") ? "rest still shown" : "only results");
    await page.screenshot({ path: path.join(C, "dash-search.png") }); await page.fill("#dq", ""); await page.waitForTimeout(300); console.log("cleared, rest back:", (await page.textContent("#view")).includes("App and alerts"));
    { const sec = await page.$("text=New shops to welcome"); if (sec) { await sec.scrollIntoViewIfNeeded(); await page.setViewportSize({ width: 390, height: 1100 }); await page.evaluate(() => { const h = [...document.querySelectorAll("h3")].find(x => /New shops to welcome/.test(x.textContent)); h.scrollIntoView({ block: "start" }); }); await page.screenshot({ path: path.join(C, "dash-welcome.png") }); }
      console.log("welcome rows:", await page.$$eval(".dwel", e => e.length), "| first link has text:", (await page.getAttribute("[data-wwa]", "href") || "").includes("Tagbook")); }
    await page.setViewportSize({ width: 390, height: 1100 }); await page.click('.dsegs [data-dseg="alerts"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(C, "dash-alerts.png") });
    console.log("alerts segment cards:", await page.$$eval(".dlist .dshop", e => e.length), "| remind links:", await page.$$eval('a[href*="wa.me"][href*="notifications"]', e => e.length));
    await page.click('.dsegs [data-dseg="all"]'); await page.fill("#dq", "kenny"); await page.waitForTimeout(400); console.log("search kenny:", await page.$$eval(".dlist .dshop", e => e.length));
    await page.fill("#dq", ""); await page.click("[data-dopen]"); await page.waitForTimeout(300); console.log("opened details:", !!(await page.$(".dclose")));
    if (process.env.FOLLOW) {
      const before = await page.$$eval("[data-nwa]", e => e.length);
      await page.evaluate(() => { const a = document.querySelector("[data-nwa]"); a.removeAttribute("href"); a.removeAttribute("target"); a.click(); }); await page.waitForTimeout(1000);
      const after = await page.$$eval("[data-nwa]", e => e.length);
      console.log("call list before/after messaging:", before, after, "| saved:", JSON.stringify(db.shop_followups.map(x => [x.shop_id, x.times])), "| waiting box:", !!(await page.$(".drest")), errs);
      await page.evaluate(() => document.querySelector(".drest").open = true); await page.screenshot({ path: path.join(C, "dash-follow.png"), fullPage: true });
    }
    process.exit(0);
  }
  if (process.env.CAPTURE_LOGIN) { // design review: phone box and PIN boxes
    const C = process.env.CAPTURE_LOGIN; await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad, #pick-in"); if (await page.$("#pick-in")) await page.click("#pick-in"); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(C, "login-phone-empty.png") });
    await page.keyboard.type("0812075"); await page.waitForTimeout(200); await page.screenshot({ path: path.join(C, "login-phone-typing.png") });
    await page.keyboard.type("6325"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    await page.keyboard.type("482"); await page.waitForTimeout(300); await page.screenshot({ path: path.join(C, "login-pin-3.png") });
    process.exit(0);
  }
  // self sign-up from /start: form checks, number already in use, then a new shop lands on the welcome card
  {
    const C = process.env.CAPTURE_SIGNUP;
    await page.goto("http://localhost:8787/"); await page.waitForSelector("#pick-new");
    if (C) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(C, "first-visit.png") }); }
    await page.click("#pick-new"); await page.waitForSelector("#sform");
    console.log("first visit shows the choice, Start a new shop opens sign-up:", !!(await page.$("#sform")));
    await page.click("#sback"); await page.waitForSelector("#lnew"); await page.click("#lnew"); await page.waitForSelector("#sform");
    console.log("sign-up, Log in, then Start a new shop goes back to sign-up:", !!(await page.$("#sform")));
    await page.goto("http://localhost:8787/?start=1"); await page.waitForSelector("#sform"); if (C) { await page.setViewportSize({ width: 390, height: 1100 }); await page.screenshot({ path: path.join(C, "signup-empty.png"), fullPage: true }); }
    await page.fill("#su-shop", "Ksolo247 Laundry"); await page.fill("#su-name", "Egwu Solomon"); await page.fill("#su-phone", "08120756325");
    await page.selectOption("#su-state", "Ondo"); await page.fill("#su-area", "Oba Ile"); await page.fill("#su-pin", "482915"); await page.fill("#su-pin2", "482916");
    await page.click("#sgo"); await page.waitForTimeout(300);
    console.log("signup pin mismatch caught:", /don't match/.test(await page.textContent(".lerr")));
    await page.fill("#su-pin", "482915"); await page.fill("#su-pin2", "482915"); await page.waitForTimeout(4000);
    await page.click("#sgo"); await page.waitForTimeout(800);
    console.log("signup number in use caught:", /already has a Tagbook account/.test(await page.textContent(".lerr")));
    if (C) await page.screenshot({ path: path.join(C, "signup-in-use.png"), fullPage: true });
    const saved = db.orders; db.orders = [];
    await page.fill("#su-phone", "08144737794"); await page.click("#sgo");
    await page.waitForSelector(".scard.welcome", { timeout: 8000 }).catch(() => {});
    console.log("signup lands on welcome card:", !!(await page.$(".scard.welcome")), "| honeypot empty:", global.signups.slice(-1)[0].website === "", "| area sent:", global.signups.slice(-1)[0].area, "| state sent:", global.signups.slice(-1)[0].state);
    if (C) { await page.screenshot({ path: path.join(C, "signup-welcome.png"), fullPage: true }); }
    db.orders = saved; db.staff = db.staff.filter(s => s.user_id !== "u-new");
    await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch (_) { } });
    if (C) process.exit(0);
    await ctx.clearCookies();
  }

  // bad login
  await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad, #pick-in"); if (await page.$("#pick-in")) await page.click("#pick-in"); await shot("01-login");
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
  await page.fill("#nm", "Ade Bello"); console.log("staff sees greeting question (expect false):", await page.isVisible(".gchips")); await T('[data-hm="yes"]'); await page.fill("#mk", "lag-10457x9"); await page.waitForTimeout(200);
  console.log("mark kept to 8, capitals, no dash:", await page.inputValue("#mk"));
  await T('[data-hm="no"]');
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
  { const first = await page.getAttribute(".plans [data-plan]", "data-plan"), picked = await page.getAttribute('[data-plan][aria-pressed="true"]', "data-plan"), btn = (await page.textContent("#paygo")).trim();
    await shot("13p-plan-year-first"); console.log("plan order first:", first, "| picked:", picked, "| button:", btn);
    if (first !== "m12" || picked !== "m12") errors.push("year plan not first"); }
  await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(400);
  if (process.env.CAPTURE_REPLIES) { // design review: admin Replies tab
    db.quick_replies = [
      { id: "q1", topic: "Price and plans", question: "How much is the subscription?", answer: "Tagbook is \u20a63,000 a month for the whole shop.\n\nYour first month is free.", sort: 10, uses: 0, created_at: new Date().toISOString() },
      { id: "q2", topic: "How it works", question: "How many devices can access an account?", answer: "There's no limit. You can use your account on your phone and your laptop at the same time.", sort: 20, uses: 0, created_at: new Date().toISOString() }];
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("http://localhost:8787/#admin"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-av="replies"]'); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.CAPTURE_REPLIES, "replies.png") });
    await page.fill("#qrq", "device"); await page.waitForTimeout(600);
    console.log("search shows:", await page.$$eval(".qreply", e => e.length));
    await page.fill("#qrq", ""); await page.waitForTimeout(600);
    await page.click("#qradd"); await page.fill("#qr-q", "Test Q"); await page.fill("#qr-t", "Other"); await page.fill("#qr-a", "Test A"); await page.click("#qr-go"); await page.waitForTimeout(600);
    console.log("after add:", db.quick_replies.length, "| shown:", await page.$$eval(".qreply", e => e.length));
    await page.screenshot({ path: path.join(process.env.CAPTURE_REPLIES, "replies-added.png") });
    process.exit(0);
  }
  if (process.env.CAPTURE_LEADS) { // design review: leads page with the call script
    db.outreach_leads = [
      { id: "l1", name: "K-kleen Laundry", area: "NDDC Rd, Oba Ile", city: "Akure", phone: "08036661786", status: "replied", notes: "Said he'd reach out. Price question answered.", created_at: new Date().toISOString() },
      { id: "l2", name: "Washmenn Laundry", area: "Oda Rd", city: "Akure", phone: "08031112222", status: "new", notes: null, created_at: new Date().toISOString() },
      { id: "l3", name: "Clean Plus Laundry", area: "Alagbaka", city: "Akure", phone: "08035556666", status: "nopick", notes: null, created_at: new Date().toISOString() }];
    db.outreach_log = [];
    await page.setViewportSize({ width: 390, height: 1700 });
    await page.goto("http://localhost:8787/#admin"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-av="leads"]').catch(() => {}); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.CAPTURE_LEADS, "leads-closed.png") });
    await page.click('.ochips button:has-text("Didn")').catch(e => console.log("chip", e.message)); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(process.env.CAPTURE_LEADS, "leads-nopick.png") });
    console.log("missed link:", decodeURIComponent((await page.getAttribute('[data-kind="missed"]', "href").catch(() => "")) || "none").slice(0, 200));
    await page.click('.ochips button:has-text("To contact")').catch(() => {}); await page.waitForTimeout(300);
    await page.evaluate(() => { const a = document.querySelector('[data-call="l2"]'); a.removeAttribute("href"); a.click(); }); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.CAPTURE_LEADS, "leads-open.png") });
    process.exit(0);
  }
  if (process.env.CAPTURE_CALLS) { // a team member who calls leads
    const out = process.env.CAPTURE_CALLS; global.callLeads = [
      { id: "c1", name: "Wash & Shine Laundry", area: "Oba Ile", city: "Akure", phone: "07025317387", status: "new", notes: null, called_by: null, called_at: null },
      { id: "c2", name: "Clean Plus", area: "Alagbaka", city: "Akure", phone: "08035556666", status: "new", notes: null, called_by: null, called_at: null },
      { id: "c3", name: "Mag Laundry", area: "Ijapo", city: "Akure", phone: "08139674129", status: "nopick", notes: null, called_by: null, called_at: null }];
    await page.setViewportSize({ width: 390, height: 1500 });
    await page.goto("http://localhost:8787/#setup"); await page.reload(); await page.waitForTimeout(1000);
    await page.click('[data-agv="calls"]'); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "calls.png"), fullPage: true });
    await page.click('[data-clog="c1"]'); await page.waitForTimeout(200); await page.fill("#cnote", "Owner is Mrs Ade. Uses a book. Wants the video."); await page.screenshot({ path: path.join(out, "log.png"), fullPage: true });
    await page.click('[data-cgo="c1"]'); await page.waitForTimeout(500);
    console.log("logged:", JSON.stringify(global.lastCall), "| no WhatsApp buttons:", !(await page.$("[data-wa]")), "| script name:", (await page.textContent(".oscript")).includes("Tolu") || (await page.textContent(".oscript")).slice(0, 0));
    process.exit(0);
  }
  if (process.env.XP_TEST) { // express for some clothes only: saved as 2 orders for the same customer
    await page.setViewportSize({ width: 390, height: 1600 });
    await page.goto("http://localhost:8787/#log"); await page.reload(); await page.waitForTimeout(1000);
    const before = db.orders.length;
    await page.click("[data-pick] >> nth=0"); await page.waitForTimeout(300);
    await page.click('[data-add="it0"]'); await page.click('[data-add="it1"]'); await page.waitForTimeout(300);
    console.log("express chips shown:", (await page.$$("[data-xp]")).length);
    await page.click('[data-xp="0"]'); await page.waitForTimeout(300);
    console.log("split note:", !!(await page.$(".xpnote")), "| button:", (await page.textContent("#save")).trim());
    await page.screenshot({ path: path.join(process.env.XP_TEST, "xp.png"), fullPage: true });
    await page.click("#save"); await page.waitForTimeout(1500);
    const added = db.orders.slice(before);
    console.log("orders saved:", added.length, "| express flags:", added.map(o => o.express), "| items:", added.map(o => o.items.map(i => i.id).join("+")), "| same customer:", added.length === 2 && added[0].customer_id === added[1].customer_id);
    console.log("paired:", added[0].pair_id === added[1].id && added[1].pair_id === added[0].id);
    const normal = added.find(o => !o.express);
    await page.goto("http://localhost:8787/#order-" + normal.no); await page.reload(); await page.waitForTimeout(1200);
    console.log("pair note:", !!(await page.$(".pairnote")));
    await page.click("details.early summary"); await page.waitForTimeout(300);
    console.log("early summary:", (await page.textContent("details.early summary")).trim());
    await page.click("details.early .wtext summary").catch(() => {}); await page.waitForTimeout(200);
    db.customers.forEach(c => { c.greet_asked = true; }); await page.reload(); await page.waitForTimeout(1200); await page.click("details.early summary"); await page.waitForTimeout(300); await page.click("details.early .wtext summary").catch(() => {}); await page.waitForTimeout(200); console.log("combined bill text:\n" + (await page.textContent("#wamsg-early")));
    await page.screenshot({ path: path.join(process.env.XP_TEST, "combo.png"), fullPage: true });
    await page.evaluate(() => { try { delete navigator.share; navigator.canShare = () => false; } catch (_) { } });
    const dl = page.waitForEvent("download", { timeout: 15000 }).catch(e => null);
    await page.click('details.early [data-pdf="early"]');
    const f = await dl; if (!f) console.log("pdf: no download"); else { const fp = path.join(process.env.XP_TEST, "combo.pdf"); await f.saveAs(fp); console.log("pdf:", f.suggestedFilename(), fs.statSync(fp).size); }
    process.exit(0);
  }
  if (process.env.STORE_SHOTS) { // Google Play listing screenshots: a realistic shop, phone size, 1080x1920
    const C = process.env.STORE_SHOTS, day = d => new Date(Date.now() + d * 864e5).toISOString();
    db.shops[0].name = "BrightWash Laundry"; db.shops[0].next_no = 214;
    db.shops[0].crew = [{ n: "Grace", r: "c" }, { n: "Effiong", r: "a" }, { n: "Kemi", r: "a" }];
    db.shop_private[0].setup = { ...db.shop_private[0].setup, complete: true, prices: true };
    db.orders.length = 0; db.order_money.length = 0; db.customers.length = 0; db.customer_phones.length = 0;
    [["Senator (up and down)", 2, { wi: 2000, wo: 1500, io: 800, wsi: 2500 }], ["Agbada", 3, { wi: 3500, wo: 2500, io: 1500, wsi: 4500 }], ["Bedsheet", 1, { wi: 1200, wo: 900, io: 500, wsi: 1500 }], ["Duvet", 1, { wi: 4000, wo: 3000, io: 0, wsi: 5000 }], ["Suit (2 piece)", 2, { wi: 3000, wo: 2000, io: 1200, wsi: 3500 }]]
      .forEach(([n, pc, pr], k) => { const id = "sx" + k; db.items.push({ id, shop_id: shopId, name: n, custom: false, services: Object.keys(pr), sort: 4 + k, hidden: false, pieces: pc }); db.item_prices.push({ item_id: id, shop_id: shopId, prices: pr }); });
    db.items.find(i => i.id === "it2").pieces = 2; db.items.find(i => i.id === "it3").hidden = true;
    const log = x => page.evaluate(async ([SBu, x]) => { const r = await fetch(SBu + "/rest/v1/rpc/log_order", { method: "POST", headers: { "Content-Type": "application/json", apikey: "x", Authorization: "Bearer x" }, body: JSON.stringify({ p: x }) }); return r.status; }, [SB, x]);
    const people = [
      ["Adaeze Okafor", "08031112233", "ADA", [["sx0", 2, "navy blue"], ["it0", 3, "white"]], 2, "new", 0],
      ["Tunde Bakare", "08052223344", "TB", [["sx1", 1, "cream"], ["it1", 2, ""]], 0, "ready", 3000],
      ["Mrs Funmi Adeyemi", "08063334455", "FA", [["sx2", 2, ""], ["sx3", 1, "white"]], -1, "listed", 0],
      ["Chinedu Eze", "08074445566", "CE", [["sx4", 1, "black"], ["it0", 4, ""]], 1, "listed", 5000],
      ["Ibrahim Musa", "08085556677", "IM", [["it2", 2, "green and gold"]], 0, "told", 3000],
      ["Blessing Udoh", "08096667788", "BU", [["it0", 5, ""], ["it1", 3, ""]], 3, "new", 0],
      ["Kunle Ojo", "08017778899", "KO", [["sx0", 1, "wine"]], -2, "listed", 0],
    ];
    for (const [name, phone, mark, lines, due, st, paid] of people) {
      await log({ name, phone, mark, branch_id: "b1", express: false, pickup: false, collect_at: day(due), paid, method: "transfer", duty: { by: "Grace", w: ["Effiong", "Kemi"] },
        items: lines.map(([id, qty, note]) => ({ id, svc: "wi", qty, note: note || undefined, pcs: (db.items.find(i => i.id === id) || {}).pieces || 1 })) });
      const o = db.orders[db.orders.length - 1]; o.status = st; const cu = db.customers.find(c => c.id === o.customer_id); cu.greet = "name"; cu.greet_asked = true; cu.inv_name = name; o.created_at = day(due - 3); if (st !== "new") o.list_sent = true;
    }
    console.log("store orders:", db.orders.length);
    await page.setViewportSize({ width: 360, height: 640 });
    const S = async n => { await page.waitForTimeout(700); await page.addStyleTag({ content: "#supfab,.alert.push{display:none!important}" }).catch(() => {}); await page.screenshot({ path: path.join(C, n + ".png") }); };
    try { localStorage; } catch (_) {}
    await page.evaluate(() => { try { localStorage.setItem("tb-duty-shop1", JSON.stringify({ by: "Grace", w: ["Effiong", "Kemi"] })); } catch (_) {} });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1500); await S("1-orders");
    const tb = db.orders.find(o => o.status === "ready");
    await page.goto("http://localhost:8787/#order-" + tb.no); await page.reload(); await page.waitForTimeout(1500); await S("3-order");
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1200); await page.click('[data-tab="new"]'); await page.waitForTimeout(800);
    try { await page.click("[data-pick] >> nth=0"); await page.waitForTimeout(300); await page.click('[data-add="sx1"]'); await page.click('[data-add="it0"]'); await page.click('[data-add="it0"]'); await page.evaluate(() => scrollTo(0, 0)); } catch (e) { console.log("log fill:", e.message.slice(0, 120)); }
    await S("2-log");
    await page.goto("http://localhost:8787/#reports"); await page.reload(); await page.waitForTimeout(1500); await S("5-reports");
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(1000); await page.click('[data-st="prices"]').catch(() => {}); await page.waitForTimeout(600); await S("6-prices");
    await page.goto("http://localhost:8787/track?k=" + tb.track_token); await page.waitForTimeout(1500); await S("4-track");
    console.log("errors:", errors.slice(0, 5));
    process.exit(0);
  }
  if (process.env.TEAM_TEST) { // team on duty, colour per cloth, pieces (Impressions Laundry)
    const C = process.env.TEAM_TEST; await page.setViewportSize({ width: 390, height: 1700 });
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(1000);
    await page.click('[data-st="staff"]'); await page.waitForTimeout(400);
    for (const [n, r] of [["Inyene", "c"], ["Effiong", "a"], ["Eke", "a"], ["Abas", "a"]]) { await page.click(`[data-crr="${r}"]`); await page.fill("#crn", n); await page.click("#cra"); await page.waitForTimeout(300); }
    console.log("crew saved:", JSON.stringify(db.shops[0].crew));
    await page.screenshot({ path: path.join(C, "team-settings.png"), fullPage: true });
    { const late = new Date(Date.now() - 3 * 864e5).toISOString(); const base = db.orders.find(o => !o.cancelled_at); for (let k = 0; k < 5; k++) { const id = "late" + k; db.orders.push({ ...base, id, no: 900 + k, collect_at: late, status: "new", cancelled_at: null }); db.order_money.push({ ...(db.order_money.find(m => m.order_id === base.id) || {}), order_id: id }); }
      await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1000); await page.screenshot({ path: path.join(C, "home.png") });
      await page.click('[data-dmore="late"]').catch(() => console.log("no show-all")); await page.waitForTimeout(200); console.log("late rows after show all:", (await page.$$(".duerow")).length);
      await page.click("#dutyedit"); await page.waitForTimeout(150); await page.screenshot({ path: path.join(C, "home-duty-open.png") }); await page.click("#dutyok");
      await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(900); await page.click('[data-st="staff"]').catch(() => {}); await page.waitForTimeout(300); }
    db.items.find(i => i.id === "it2").pieces = 2;
    await page.click('[data-st="prices"]'); await page.waitForTimeout(400); await page.click('[data-popen="it2"]').catch(() => {}); await page.waitForTimeout(300);
    await page.fill('[data-ppc="it2"]', "3"); await page.press('[data-ppc="it2"]', "Tab"); await page.waitForTimeout(400);
    console.log("pieces from price list:", db.items.find(i => i.id === "it2").pieces); db.items.find(i => i.id === "it2").pieces = 2;
    await page.screenshot({ path: path.join(C, "prices.png"), fullPage: true });
    await page.setViewportSize({ width: 1200, height: 900 }); await page.reload(); await page.waitForTimeout(900); await page.click('[data-st="prices"]').catch(() => {}); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(C, "prices-wide.png") }); console.log("ptable:", JSON.stringify(await page.evaluate(() => { const r = document.querySelector(".ptable .pr"); const cs = getComputedStyle(r); return { cols: cs.gridTemplateColumns, w: r.clientWidth, inp: [...r.querySelectorAll("input")].map(i => [i.clientWidth, getComputedStyle(i).paddingRight, i.scrollWidth]) }; }))); await page.setViewportSize({ width: 390, height: 1700 });
    await page.goto("http://localhost:8787/#log"); await page.reload(); await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(C, "duty-pick.png") });
    { const n0 = db.orders.length; await page.click("[data-pick] >> nth=0"); await page.waitForTimeout(300); await page.click('[data-add="it0"]'); await page.click("#save"); await page.waitForTimeout(800);
      console.log("blocked without duty:", db.orders.length === n0, "| picker opened:", !!(await page.$("#dutyok"))); await page.click("#dutyok"); await page.click("#clr"); await page.waitForTimeout(200); }
    await page.click("#dutyedit"); await page.waitForTimeout(150);
    await page.click('[data-dby="Inyene"]'); for (const n of ["Effiong", "Eke", "Abas"]) await page.click(`[data-dw="${n}"]`); await page.screenshot({ path: path.join(C, "duty-open.png") }); await page.click("#dutyok"); await page.waitForTimeout(200);
    console.log("duty bar:", (await page.textContent(".duty")).replace(/\s+/g, " "));
    await page.click("[data-pick] >> nth=0"); await page.waitForTimeout(300);
    await page.click('[data-add="it2"]'); await page.click('[data-add="it0"]'); await page.click('[data-add="it0"]'); await page.waitForTimeout(200);
    await page.click('[data-ed="0"]'); await page.fill("#lnn", "up and down"); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(C, "line-edit.png"), fullPage: true });
    await page.click("#lndone"); await page.waitForTimeout(400);
    await page.click('[data-ed="1"]'); await page.fill("#lnn", "white"); await page.click("#lnsplit"); await page.fill("#lnn", "green"); await page.click("#lndone"); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(C, "log-lines.png"), fullPage: true });
    await page.click("#save"); await page.waitForTimeout(1500);
    const o = db.orders[db.orders.length - 1];
    console.log("saved items:", JSON.stringify(o.items), "| duty:", JSON.stringify(o.duty));
    await page.goto("http://localhost:8787/#order-" + o.no); await page.reload(); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(C, "order.png"), fullPage: true });
    { await page.setViewportSize({ width: 390, height: 1800 }); await page.screenshot({ path: path.join(C, "new-list.png") }); await page.setViewportSize({ width: 390, height: 1700 });
      page.context().once("page", p2 => p2.close().catch(() => {}));
      db.customers.forEach(c => { c.greet_asked = true; }); await page.reload(); await page.waitForTimeout(1000);
      await page.click('[data-wtxt="list"]').catch(e => console.log("no list btn", e.message.slice(0, 60))); await page.waitForTimeout(1200);
      console.log("list auto-marked sent:", JSON.stringify(db.orders.find(q => q.id === o.id).list_sent), db.orders.find(q => q.id === o.id).status); }
    db.shops[0].crew.push({ n: "Ada", r: "c" }); await page.evaluate(id => localStorage.setItem("tb-duty-" + id, JSON.stringify({ by: "Ada", w: ["Effiong", "Eke", "Abas"] })), db.shops[0].id);
    db.customers.forEach(c => { c.greet_asked = true; }); await page.reload(); await page.waitForTimeout(1200);
    await page.click("details.early summary").catch(() => {}); await page.waitForTimeout(300); await page.click("details.early .wtext summary").catch(() => {}); await page.waitForTimeout(200);
    const txt = await page.evaluate(() => [...document.querySelectorAll(".wa")].map(x => x.textContent).join("\n----\n"));
    console.log("messages:\n" + txt);
    await page.evaluate(() => { try { delete navigator.share; navigator.canShare = () => false; } catch (_) { } });
    const dl = page.waitForEvent("download", { timeout: 15000 }).catch(e => null);
    await page.click('details.early [data-pdf="early"]').catch(e => console.log("no pdf btn"));
    const f = await dl; if (f) { const fp = path.join(C, "inv.pdf"); await f.saveAs(fp); console.log("pdf ok", fs.statSync(fp).size); }
    console.log("track link in list:", /track\?k=[0-9a-f]{24}/.test(txt));
    await page.goto("http://localhost:8787/track.html?k=" + o.track_token); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(C, "track.png"), fullPage: true });
    console.log("track page:", (await page.textContent("h1").catch(() => "-")));
    { const q = db.orders.find(x => x.id === o.id); q.status = "ready"; await page.goto("http://localhost:8787/#order-" + o.no); await page.reload(); await page.waitForTimeout(1200);
      await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async () => {}; });
      await page.click('[data-pdf="ready"]').catch(e => console.log("no ready pdf", e.message.slice(0, 80))); await page.waitForTimeout(4000);
      console.log("auto told:", db.orders.find(x => x.id === o.id).status); }
    { const q = db.orders.find(x => x.id === o.id); q.status = "ready"; const m = db.order_money.find(x => x.order_id === o.id); if (m) { m.paid = 2000; m.payments = [{ amt: 2000, at: Date.now() - 864e5, method: "cash", by: "Bolu" }]; }
      await page.setViewportSize({ width: 390, height: 3200 }); await page.goto("http://localhost:8787/#order-" + o.no); await page.reload(); await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(C, "order-ready.png"), fullPage: true }); }
    console.log("bill sender saved:", JSON.stringify(db.orders.find(q => q.id === o.id).duty));
    console.log("errors:", errors.slice(0, 5));
    process.exit(0);
  }
  if (process.env.BILL_TEST) { // owner lets a front desk staff send bills; staff can't discount; owner can remove a wrong payment
    const relog = async ph => { await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) { } }); current = null; await login(ph); };
    const C = process.env.BILL_TEST; await page.setViewportSize({ width: 390, height: 1700 });
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(1000);
    await page.click('[data-st="staff"]'); await page.waitForTimeout(400);
    console.log("switch shown:", !!(await page.$('[data-cb="u-sec"]')));
    await page.screenshot({ path: path.join(C, "staff-switch.png"), fullPage: true });
    await page.check('[data-cb="u-sec"]'); await page.waitForTimeout(600);
    console.log("can_bill saved:", db.staff.find(s => s.user_id === "u-sec").can_bill === true);
    const o = db.orders[db.orders.length - 1];
    o.items = [{ id: "it2", svc: "wi", qty: 2 }]; o.express = false; o.status = "new"; o.list_sent = false; o.billed = false; o.settled = false; db.customers.forEach(c => { c.greet_asked = true; });
    db.order_money = db.order_money.filter(m => m.order_id !== o.id);
    await relog("08000000091");
    await page.goto("http://localhost:8787/#order-" + o.no); await page.reload(); await page.waitForTimeout(1200);
    console.log("staff sees send list:", !!(await page.$(".wa, [data-wa], .wa-label")), "| bill button:", !!(await page.$("#bill")), "| discount box:", !!(await page.$("#dc")), "| phone shown:", (await page.textContent(".dhead span, .ohead span").catch(() => "")).includes("0"));
    await page.screenshot({ path: path.join(C, "staff-order.png"), fullPage: true });
    await page.click("#bill"); await page.waitForTimeout(400); console.log("toast:", await page.textContent(".toast").catch(() => "-")); await page.waitForTimeout(500);
    const mm = db.order_money.find(m => m.order_id === o.id);
    console.log("staff saved bill:", !!(mm && mm.billed_at), "total:", mm && mm.total, "| unpay for staff:", !!(await page.$("#unpay")));
    await page.fill("#pay", "1000"); await page.click("#pp"); await page.waitForTimeout(300); await page.click('.cfm [data-c="1"]'); await page.waitForTimeout(900);
    await page.fill("#pay", "1000").catch(() => {}); await page.click("#pp").catch(() => {}); await page.waitForTimeout(300); await page.click('.cfm [data-c="1"]').catch(() => {}); await page.waitForTimeout(900);
    console.log("payments recorded:", mm.payments.length, "paid:", mm.paid);
    await relog("08120756325");
    await page.goto("http://localhost:8787/#order-" + o.no); await page.reload(); await page.waitForTimeout(1200);
    console.log("owner unpay button:", !!(await page.$("#unpay")));
    await page.click("#unpay"); await page.waitForTimeout(300); await page.screenshot({ path: path.join(C, "unpay-confirm.png") }); await page.click('.cfm [data-c="1"]'); await page.waitForTimeout(900);
    console.log("after remove: payments", mm.payments.length, "paid", mm.paid);
    await page.screenshot({ path: path.join(C, "owner-order.png"), fullPage: true });
    console.log("errors:", errors.slice(0, 5));
    process.exit(0);
  }
  if (process.env.SETUP_TEST) { // checklist steps tick only when the real work is done
    await page.setViewportSize({ width: 390, height: 1500 });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1000);
    const priceDone = async () => page.$eval('[data-sgo="prices"]', () => false).catch(() => true);
    console.log("prices step open at start:", !(await priceDone()));
    await page.click('[data-sgo="prices"]'); await page.waitForTimeout(600);
    console.log("guide shown on price list:", !!(await page.$(".pguide")));
    await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(600);
    console.log("just opening did NOT tick it:", !(await priceDone()), "| saved flag:", !!(db.shop_private[0].setup || {}).prices);
    await page.click('[data-sgo="prices"]'); await page.waitForTimeout(600);
    await page.click("[data-popen] >> nth=0"); await page.waitForTimeout(300);
    const inp = await page.$("[data-pp]"); await inp.fill("1234"); await inp.dispatchEvent("change"); await page.waitForTimeout(800);
    console.log("saving a price ticked it:", !!(db.shop_private[0].setup || {}).prices, "| guide gone:", !(await page.$(".pguide")));
    await page.goto("http://localhost:8787/#orders"); await page.waitForTimeout(600);
    console.log("prices step done on checklist:", await priceDone(), "| skip links:", await page.$$eval("[data-sskip]", b => b.map(x => x.textContent)));
    await page.screenshot({ path: path.join(process.env.SETUP_TEST, "setup.png"), fullPage: true });
    // A shop with no prices: logging an unpriced item asks the owner for its price first
    db.item_prices.forEach(r => r.prices = {});
    await page.goto("http://localhost:8787/#log"); await page.reload(); await page.waitForTimeout(1000);
    await page.click('[data-svc="wi"]').catch(() => {}); await page.waitForTimeout(200);
    console.log("picker says no price:", (await page.$$("[data-add] small.nop")).length > 0);
    await page.click('[data-add="it0"]'); await page.waitForTimeout(300);
    console.log("asks for price:", !!(await page.$("#aprice")), "| item not added yet:", (await page.$$(".items .item")).length === 0);
    await page.screenshot({ path: path.join(process.env.SETUP_TEST, "askprice.png"), fullPage: true });
    await page.fill("#aprice", "900"); await page.click("#apa"); await page.waitForTimeout(800);
    console.log("price saved:", JSON.stringify((db.item_prices.find(r => r.item_id === "it0") || {}).prices), "| item added:", (await page.$$(".items .item")).length === 1);
    process.exit(0);
  }
  if (process.env.CAPTURE_OPTS) { // order options: collection date, wait & get, remarks, starch and iron
    const out = process.env.CAPTURE_OPTS; await page.setViewportSize({ width: 390, height: 1900 });
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-st="business"]'); await page.waitForTimeout(400);
    await page.check("#oc"); await page.check("#ow"); await page.waitForTimeout(400);
    console.log("settings saved:", db.shops[0].collect_dates, db.shops[0].wait_get_on);
    await page.screenshot({ path: path.join(out, "settings.png"), fullPage: true });
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    console.log("service chips:", await page.$$eval("[data-svc]", b => b.map(x => x.textContent)));
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300);
    await page.click("[data-pick]"); await page.waitForTimeout(200);
    await page.click("[data-add]"); await page.waitForTimeout(200);
    await page.click('[data-calm="1"]'); await page.waitForTimeout(150); await page.click('[data-cal]:not([disabled]) >> nth=2'); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, "cal.png"), fullPage: true });
    await page.click('[data-rm="Stain"]'); await page.waitForTimeout(100); await page.click('[data-rm="Missing button"]'); await page.waitForTimeout(100);
    await page.click("[data-money]"); await page.waitForTimeout(200); await page.fill("#mp-in", "500"); await page.screenshot({ path: path.join(out, "money.png") }); await page.click("#mp-ok"); await page.waitForTimeout(200);
    await page.click("[data-rmo]"); await page.waitForTimeout(150); await page.fill("#rmo-in", "Faded collar"); await page.click("#rmo-add"); await page.waitForTimeout(300);
    console.log("shop list saved:", JSON.stringify(db.shop_remarks || []));
    await page.click("#save"); await page.waitForTimeout(1200);
    const o = db.orders[db.orders.length - 1]; console.log("saved order:", o.wait_get, o.express, o.collect_at, o.remarks, o.money_found);
    await page.screenshot({ path: path.join(out, "order.png"), fullPage: true });
    if (await page.$("[data-og]")) { await page.click("[data-og] >> nth=0"); await page.waitForTimeout(800); }
    console.log("list msg:", JSON.stringify(await page.evaluate(() => { const e = document.querySelector("#wamsg-list"); return e && e.textContent; })));
    await page.click("#nedit"); await page.waitForTimeout(300); await page.click('[data-rm="Burn mark"]'); await page.waitForTimeout(200); await page.screenshot({ path: path.join(out, "edit.png"), fullPage: true }); await page.click("#ngo"); await page.waitForTimeout(600);
    console.log("edited remarks:", db.orders[db.orders.length - 1].remarks);
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300); await page.click("[data-pick]"); await page.click("[data-add]"); await page.waitForTimeout(150);
    await page.click('[data-spd="exp"]'); await page.waitForTimeout(150); await page.click('[data-exd="2"]'); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, "log-express.png"), fullPage: true });
    await page.click('[data-spd="wait"]'); await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, "log-wait.png"), fullPage: true });
    await page.click("#save"); await page.waitForTimeout(1200);
    const o2 = db.orders[db.orders.length - 1]; console.log("wait order:", o2.wait_get, o2.express, o2.collect_at);
    // a late, a due-today and a due-tomorrow order for the Due soon card
    const dd = n => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + n); return t.toISOString(); };
    const lst = db.orders.filter(q => !q.cancelled_at).slice(-3); [-1, 0, 1].forEach((n, i) => { if (lst[i]) { lst[i].collect_at = dd(n); lst[i].status = "new"; } });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1000);
    console.log("due card:", await page.$$eval(".dueh b", e => e.map(x => x.textContent)));
    await page.screenshot({ path: path.join(out, "list.png"), fullPage: true });
    process.exit(0);
  }
  if (process.env.RESET_TEST) { // forgot PIN: reset it by sending a code from the phone's WhatsApp
    const out = process.env.RESET_TEST; await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) { } }); await page.goto("http://localhost:8787/"); await page.waitForSelector(".keypad, #pick-in");
    if (await page.$("#pick-in")) await page.click("#pick-in");
    await page.keyboard.type("08120756325"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "reset-1-pin.png") });
    await page.click("#lforgot"); await page.waitForTimeout(500);
    console.log("reset screen:", !!(await page.$("#rwa")), "| link:", await page.getAttribute("#rwa", "href"));
    await page.screenshot({ path: path.join(out, "reset-2-code.png") });
    await page.click("#rnext"); await page.waitForTimeout(500);
    console.log("not sent yet stays:", !!(await page.$("#rwa")), (await page.textContent(".lerr")).slice(0, 45));
    await page.screenshot({ path: path.join(out, "reset-3-notyet.png") });
    global.resetOk = true; await page.click("#rnext"); await page.waitForTimeout(500);
    await page.keyboard.type("111111"); await page.waitForTimeout(300); console.log("easy pin refused:", (await page.textContent(".lerr")).slice(0, 40));
    await page.keyboard.type("703518"); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, "reset-4-again.png") }); await page.keyboard.type("703518");
    try { await page.waitForSelector("#tabs button", { timeout: 8000 }); console.log("logged in with new PIN: true"); } catch (_) { console.log("logged in with new PIN: false", await page.textContent(".lerr").catch(() => "")); }
    process.exit(0);
  }
  if (process.env.WA_TEST) { // sign-up with the WhatsApp number check
    const out = process.env.WA_TEST; global.waMode = true; await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) { } });
    await page.goto("http://localhost:8787/?start=1"); await page.waitForSelector("#sform");
    await page.fill("#su-shop", "Ksolo247 Laundry"); await page.fill("#su-name", "Egwu Solomon"); await page.fill("#su-phone", "08144737700");
    await page.selectOption("#su-state", "Ondo"); await page.fill("#su-area", "Oba Ile"); await page.fill("#su-pin", "482915"); await page.fill("#su-pin2", "482915"); await page.waitForTimeout(4100);
    await page.click("#sgo"); await page.waitForTimeout(800);
    console.log("wa step shown:", !!(await page.$("#swa")), "| link:", await page.getAttribute("#swa", "href"));
    await page.screenshot({ path: path.join(out, "wa-step.png"), fullPage: true });
    await page.click("#sgo"); await page.waitForTimeout(800);
    console.log("not verified message:", (await page.textContent(".lerr")).slice(0, 60));
    global.waOk = true; await page.click("#sgo"); await page.waitForTimeout(2500);
    console.log("finished, check_id sent:", global.signups.slice(-1)[0].check_id);
    process.exit(0);
  }
  if (process.env.CAPTURE_MAIN) { // frames for the main "how Tagbook works" video
    const out = process.env.CAPTURE_MAIN; await page.setViewportSize({ width: 390, height: 844 });
    const snap = async (n, sel, block = "center") => { await page.addStyleTag({ content: ".toast,#supfab{display:none!important}" }); if (sel) await page.evaluate(([q, b]) => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: b }); }, [sel, block]); else await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, n + ".jpg"), type: "jpeg", quality: 92 }); };
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300); await page.click("[data-pick]"); await page.waitForTimeout(200);
    for (let k = 0; k < 3; k++) { const bs = await page.$$("[data-add]"); if (bs[k]) { await bs[k].click(); await page.waitForTimeout(250); } }
    await page.click("[data-inc='0']").catch(() => { }); await page.waitForTimeout(150);
    await snap("m01-log", ".item");
    await page.click("#save"); await page.waitForTimeout(2500);
    if (await page.$("[data-og]")) { await page.click("[data-og] >> nth=0"); await page.waitForTimeout(900); }
    await snap("m02-mark", null);
    const amts = [[4500, 1000], [7200, 0], [3000, 1500], [5600, 2000]];
    db.orders.filter(q => !q.cancelled_at).forEach((q, i) => { const [t, pd] = amts[i % amts.length]; q.status = "told"; q.billed = true; q.notified = true; const m = db.order_money.find(x => x.order_id === q.id); if (m) { m.total = t; m.paid = pd; m.billed_at = new Date().toISOString(); m.payments = pd ? [{ amt: pd, at: Date.now(), method: "transfer", by: "Bolu" }] : []; } });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1200);
    if (await page.$('[data-f="owed"]')) { await page.click('[data-f="owed"]'); await page.waitForTimeout(600); }
    await snap("m03-owing", null);
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-st="staff"]'); await page.waitForTimeout(600);
    await snap("m04-staff", null);
    process.exit(0);
  }
  if (process.env.CAPTURE_PHOTOVID) { // frames for the photos video
    const out = process.env.CAPTURE_PHOTOVID, jpg = process.env.PHOTO_FILE; await page.setViewportSize({ width: 390, height: 844 });
    const snap = async (n, sel, block = "center") => { await page.addStyleTag({ content: ".toast,#supfab{display:none!important}" }); if (sel) await page.evaluate(([q, b]) => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: b }); }, [sel, block]); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, n + ".jpg"), type: "jpeg", quality: 92 }); };
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300); await page.click("[data-pick]"); await page.waitForTimeout(200);
    await page.click("[data-add]"); await page.waitForTimeout(300);
    await page.evaluate(() => { const b = document.querySelector('[data-cam="0"]'); b.style.outline = "3px solid #E8A33D"; b.style.outlineOffset = "2px"; });
    await snap("01-camera", '[data-cam="0"]');
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-cam="0"]')]); await fc.setFiles(jpg); await page.waitForTimeout(900);
    await snap("02-photo", ".phedit");
    await page.click('[data-pn="0"][data-note="Stain"]'); await page.waitForTimeout(300);
    await snap("03-stain", ".phedit");
    await snap("04-remarks", '[data-rm="Stain"]');
    await page.click("#save"); await page.waitForTimeout(2500);
    if (await page.$("[data-og]")) { await page.click("[data-og] >> nth=0"); await page.waitForTimeout(900); }
    await snap("05-order", ".phblock", "start");
    await snap("06-list", "#wamsg-list");
    const tok = "a".repeat(36); await page.goto("http://localhost:8787/photos.html?t=" + tok); await page.waitForTimeout(1500);
    await snap("07-customer");
    process.exit(0);
  }
  if (process.env.CAPTURE_PHOTOS) { // photos at drop-off: log screen and order screen
    const out = process.env.CAPTURE_PHOTOS; await page.setViewportSize({ width: 390, height: 1700 });
    const jpg = path.join(out, "_p.jpg"); fs.writeFileSync(jpg, Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z", "base64"));
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300); await page.click("[data-pick]"); await page.waitForTimeout(200);
    await page.click("[data-add]"); await page.waitForTimeout(200);
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-cam="0"]')]); await fc.setFiles(jpg); await page.waitForTimeout(600);
    await page.click('[data-pn="0"][data-note="Stain"]'); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, "log.png"), fullPage: true });
    await page.click("#save"); await page.waitForTimeout(2500);
    console.log("uploads:", global.photoUploads, "rows:", JSON.stringify(db.order_photos.map(r => ({ item: r.item, notes: r.notes, order: !!r.order_id, path: r.path.split("/").length }))));
    console.log("items saved clean:", JSON.stringify(db.orders[db.orders.length - 1].items));
    console.log("remarks saved:", db.orders[db.orders.length - 1].remarks);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "order.png"), fullPage: true });
    if (await page.$("[data-og]")) { await page.click("[data-og] >> nth=0"); await page.waitForTimeout(800); }
    console.log("list msg:", JSON.stringify(await page.evaluate(() => { const e = document.querySelector("#wamsg-list"); return e && e.textContent; })));
    console.log("separate send hidden before list sent:", !(await page.$("#phsend")));
    process.exit(0);
  }
  if (process.env.CAPTURE_VIDEO) { // phone-size frames for the "what's new" video
    const out = process.env.CAPTURE_VIDEO; await page.setViewportSize({ width: 390, height: 844 });
    const snap = async (n, sel) => { await page.addStyleTag({ content: ".toast,#supfab{display:none!important}" }); if (sel) await page.evaluate(q => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: "center" }); }, sel); await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, n + ".jpg"), type: "jpeg", quality: 92 }); };
    await page.goto("http://localhost:8787/#shop"); await page.reload(); await page.waitForTimeout(800);
    await page.click('[data-st="business"]'); await page.waitForTimeout(400);
    await snap("01-settings-off", "#oc");
    await page.check("#oc"); await page.check("#ow"); await page.waitForTimeout(400); await snap("02-settings-on", "#oc");
    await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(800);
    await page.fill("#cq", db.customers[0].name.slice(0, 3)); await page.waitForTimeout(300); await page.click("[data-pick]"); await page.waitForTimeout(200); await page.click("[data-add]"); await page.waitForTimeout(200);
    await snap("03-speed", '[data-spd="std"]');
    await page.click('[data-calm="1"]'); await page.waitForTimeout(150); await page.click('[data-cal]:not([disabled]) >> nth=2'); await snap("04-calendar", ".cal");
    await page.click('[data-spd="exp"]'); await page.waitForTimeout(150); await page.click('[data-exd="2"]'); await snap("05-express", '[data-exd="2"]');
    await page.click('[data-spd="wait"]'); await snap("06-wait", '[data-spd="wait"]');
    await page.click('[data-rm="Stain"]'); await page.waitForTimeout(100);
    await page.click("[data-money]"); await page.waitForTimeout(200); await page.fill("#mp-in", "500"); await snap("07-money"); await page.click("#mp-ok"); await snap("08-remarks", "[data-money]");
    await page.click('[data-spd="exp"]'); await page.waitForTimeout(150); await page.click('[data-exd="1"]'); await page.waitForTimeout(150);
    await page.click("#save"); await page.waitForTimeout(1200);
    const dd = n => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + n); return t.toISOString(); };
    const lst = db.orders.filter(q => !q.cancelled_at).slice(-3); [0, 1, 1].forEach((n, i) => { if (lst[i]) { lst[i].collect_at = dd(n); lst[i].status = "new"; } });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(1000);
    await snap("09-due", ".duecard");
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
    if (process.env.LONGMARK) db.customers.forEach((c, i) => { if (i % 2 === 0) c.mark = "LAG1045" + (i % 10); });
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForSelector(".order", { timeout: 8000 });
    if (process.env.REFPOP) { db.shop_private[0].setup = { complete: true };
      const base = db.orders.slice(); base.forEach((o, i) => { const id = "x" + i; db.orders.push({ ...JSON.parse(JSON.stringify(o)), id, no: 100 + i }); const m = db.order_money.find(x => x.order_id === o.id); if (m) db.order_money.push({ ...JSON.parse(JSON.stringify(m)), order_id: id }); });
      await page.reload(); await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(process.env.CAPTURE_ORDERS, "refpop.png") }); console.log("popup shown:", !!(await page.$("#refpop")), "| ref_pop saved:", !!db.shop_private[0].setup.ref_pop);
      await page.click("#refpop-x"); await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.CAPTURE_ORDERS, "refcard.png") }); process.exit(0); }
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
    const P = process.env.MSGS ? [700, 1000, 6000] : null; if (P) db.shops[0].name = "BrightWash Laundry";
    const unit = its.map((_, i) => P ? P[i] || 800 : 800), total = its.reduce((s, it, i) => s + unit[i] * it.qty, 0);
    db.order_money.push({ order_id: "oi", shop_id: t0.shop_id, unit, custom: {}, delivery: 500, discount: 0, total: total + 500, billed_at: new Date().toISOString(), paid: 1000, payments: [{ amt: 1000, at: Date.now(), method: "cash" }], express_amt: 0 });
    Object.assign(db.shop_private[0], { inv_tagline: "Laundry and dry cleaning", inv_address: "12 Oba Adesida Road, Akure", inv_phone: "08120756325", inv_email: "hello@brightwash.ng", inv_terms: "Clothes not collected within 30 days may be given away. Please check your pockets before drop-off." });
    if (process.env.MSGS) db.shop_private[0].inv_phone = "08030000000";
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
    if (process.env.MSGS) console.log("READY_MSG<<" + await page.textContent("#wamsg-ready") + ">>");
    await page.screenshot({ path: path.join(out, "order-send-text-open.png") });
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('[data-pdf="ready"]')]); await dl2.saveAs(path.join(out, "order.pdf"));
    // the same order while still being cleaned: the bill can go out early
    db.orders.find(o => o.id === "oi").status = "listed";
    await page.goto("http://localhost:8787/#orders"); await page.reload(); await page.waitForTimeout(800);
    await page.click('.order:has-text("Adaeze")'); await page.waitForTimeout(800);
    await page.click("details.early summary"); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector("details.early").scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(out, "order-early.png") });
    const [dl3] = await Promise.all([page.waitForEvent("download"), page.click('[data-pdf="early"]')]); await dl3.saveAs(path.join(out, "order-early.pdf"));
    await page.waitForTimeout(300); console.log("send log:", JSON.stringify(db.send_log.map(x => x.kind + "/" + x.stage)));
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
  page.context().once("page", p2 => p2.close().catch(() => {})); await page.evaluate(() => document.querySelector('[data-wtxt="ready"]').click()); await page.waitForTimeout(1000); console.log("status:", db.orders[0].status);
  await T("#ppart"); await page.fill("#pay", "5000"); await T("#pp"); await T('.cfm [data-c="1"]'); await page.waitForTimeout(300);
  console.log("money after part pay:", db.order_money[0].paid, "settled:", db.orders[0].settled);
  await page.$eval("#ppall", e => e.scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(out, "09b-pay-form.png") });
  await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  console.log("print button:", await page.textContent("#prt")); await T(".oprint summary"); await T("#prt"); await page.waitForTimeout(200);
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
  console.log("auto-billed order shows:", (await page.textContent("#billcard h3")).trim());
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
  { // expenses: add two, check Left, delete one
    const recv = await page.evaluate(() => [...document.querySelectorAll(".lines div")].find(d => /Money received/.test(d.textContent)).querySelector("b").textContent);
    await T("#exadd"); await page.fill("#exa", "1500"); await T('[data-exk="soap"]'); await page.fill("#exn", "2 bags of Ariel"); await shot("12a-expense-form"); await T("#exsave"); await page.waitForTimeout(300);
    await T("#exadd"); await page.fill("#exa", "2000"); await T("#exsave"); const nokind = (await page.textContent("#toast")).trim(); await T('[data-exk="fuel"]'); await T("#exsave"); await page.waitForTimeout(300);
    await shot("12b-expenses");
    const spent = await page.evaluate(() => [...document.querySelectorAll(".lines div")].find(d => /Spent on the shop/.test(d.textContent)).querySelector("b").textContent);
    const left = await page.textContent(".exleft b");
    console.log("expenses:", db.expenses.length, "spent:", spent, "left:", left, "received:", recv, "no-kind toast:", nokind, "row:", JSON.stringify(db.expenses[0] && { a: db.expenses[0].amount, k: db.expenses[0].kind, n: db.expenses[0].note, d: !!db.expenses[0].spent_on }));
    if (db.expenses.length !== 2 || spent !== "₦3,500") errors.push("expenses not saved right");
    await T('[data-exdel]'); await T('.cfm [data-c="1"]'); await page.waitForTimeout(300);
    console.log("after delete:", db.expenses.length, await page.textContent(".exleft b"));
    await T("#exprev"); const yl = await page.textContent(".exnav b"), yrows = await page.$$eval(".exlist .exrow", r => r.length); await shot("12c-expenses-yesterday"); await T("#exnext");
    console.log("yesterday:", yl, "rows:", yrows, "| back to:", await page.textContent(".exnav b"));
    if (yl !== "Yesterday" || yrows !== 0) errors.push("expense day picker wrong");
    await T('[data-ext="month"]'); const mspent = await page.evaluate(() => [...document.querySelectorAll(".lines div")].find(d => /Spent on the shop/.test(d.textContent)).querySelector("b").textContent);
    const mtype = await page.textContent(".exlist"); const madd = !!(await page.$("#exadd")); await shot("12d-expenses-month");
    console.log("month spent:", mspent, "| by type:", mtype.replace(/\s+/g, " ").trim(), "| add button:", madd);
    if (mspent !== "₦2,000" || madd) errors.push("expense month view wrong");
    await T('[data-ext="day"]');
    if (db.expenses.length !== 1) errors.push("expense delete failed");
  }
  // settings: add staff, price edit, branch add
  await T("#gear"); await shot("13a-settings-business");
  await T('[data-st="account"]'); await page.waitForTimeout(400); console.log("account notifications box:", (await page.textContent("#pushbox")).trim().slice(0, 40)); await shot("13x-account");
  await T('[data-st="shops"]'); await page.waitForTimeout(300);
  await page.fill("#as-n", "Saheed Dry Cleaners"); await page.selectOption("#as-st", "Ondo"); await page.fill("#as-tw", "Akure"); await page.fill("#as-b", "Main branch, Awule point, Oke-Ijebu point"); await page.fill("#as-on", "Saheed Bello"); await page.fill("#as-op", "08055556666"); await page.fill("#as-pin", "246810"); await page.selectOption("#as-r", { index: 1 });
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
  await page.fill("#as-n", "Saheed Dry Cleaners"); await page.selectOption("#as-st", "Ondo"); await page.fill("#as-tw", "Akure"); await page.fill("#as-b", "Main branch, Awule point, Oke-Ijebu point"); await page.fill("#as-on", "Saheed Bello"); await page.fill("#as-op", "08055556666"); await page.fill("#as-pin", "246810"); await page.selectOption("#as-r", { index: 1 });
  await T("#as-go"); await page.waitForTimeout(500); console.log("create_shop sent:", JSON.stringify(global.lastCreate)); await shot("16-admin-created");
  console.log("shops listed:", (await page.textContent("#view")).includes("Saheed Dry Cleaners"), "| referral shown:", (await page.textContent("#view")).includes("Referred by BrightWash Test"), (await page.textContent("#view")).includes("Brought 1 shop"));
  await T('[data-st="business"]'); await shot("23-laptop-business");
  await page.goto("http://localhost:8787/#log"); await page.waitForTimeout(400); await shot("24-laptop-log");
  await page.goto("http://localhost:8787/#reports"); await page.waitForTimeout(400); await shot("25-laptop-reports");
  console.log("ERRORS:", errors.length ? errors : "none");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
