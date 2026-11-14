/* Tagbook: the real app. Same screens as the approved demo, backed by Supabase. */
import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://uungxatdvelljmaugzuz.supabase.co";
const SB_KEY = "sb_publishable_oE_-Yt6fovcOpIC01tnrpw_ueK-Zx7v";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "tagbook-auth" } });
// Logins are phone + 6-digit PIN, checked by the "login" server function, which counts wrong PINs
// and pauses a login after 5. The app never builds the real password itself.

const SERVICES = { wi: "Wash and iron", wo: "Wash only", io: "Iron only", wsi: "Wash, starch and iron" };
const STEPS = [["new", "Logged"], ["listed", "List sent"], ["ready", "Ready"], ["told", "Told"], ["picked", "Picked up"]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const naira = n => "₦" + Math.round(n || 0).toLocaleString("en-NG");
const fmtPhone = p => String(p || "").replace(/(\d{4})(\d{3})(\d{4})/, "$1 $2 $3");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const digits = v => String(v ?? "").replace(/\D/g, "");
const num = v => +digits(v) || 0;
const fmtDay = ts => new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const moneyAttrs = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"';
function moneyInput(el, fn) { if (!el) return; el.addEventListener("input", () => { const c = digits(el.value); if (el.value !== c) el.value = c; fn(num(c)); }); }
const $ = s => document.querySelector(s);
const view = $("#view");
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2800); }
const busy = () => { const a = document.activeElement; return !!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); };

/* ---------- State, loaded from the database ---------- */
let me = null, role = "sec", shop = null, priv = null, isAdmin = false, isAgent = false;
let BRANCHES = [], PRICES = [], customers = [], orders = [], cancelledOrders = [], staffList = [];
let tab = "orders", filter = "all", query = "", openNo = null, page = 0;
const PER_PAGE = 20;
const own = () => role === "own";
const theme = () => { try { return localStorage.getItem("tb-theme") || "light"; } catch (_) { return "light"; } };
const shopName = () => (shop && shop.name.trim()) || "Your laundry";
const branchName = id => (BRANCHES.find(b => b.id === id) || {}).name || "";
const liveBranches = () => BRANCHES.filter(b => b.active);
const cust = id => customers.find(c => c.id === id) || { name: "Customer", mark: "?", phone: "" };
// Many shops save customers as "Lexus 350" or "Tailor", so messages can greet them as Sir, Ma, Boss and so on.
const GREETS = [["", "Their name"], ["sir", "Sir"], ["ma", "Ma"], ["chief", "Chief"], ["boss", "Boss"], ["chairman", "Chairman"], ["prof", "Prof"], ["doctor", "Doctor"], ["aunty", "Aunty"], ["uncle", "Uncle"]];
const isPreset = g => GREETS.some(([k]) => k === (g || ""));
const greetWord = g => g === "sir" || g === "ma" ? g : isPreset(g) ? g[0].toUpperCase() + g.slice(1) : g;
const hello = c => c.greet ? `Hello ${greetWord(c.greet)}` : `Hello ${c.name.split(" ")[0]}`;
// cur: the chosen greeting ("" = their name, "-" = nothing chosen yet). other: the "Other" box is open.
// Greetings this shop typed before under "Other" show up as choices too, so nobody types them twice.
const greetOpts = () => { const seen = new Set(GREETS.map(([k]) => k.toLowerCase())), extra = [];
  customers.forEach(c => { const g = c.greet; if (g && !seen.has(g.toLowerCase())) { seen.add(g.toLowerCase()); extra.push([g, g]); } });
  return GREETS.concat(extra.sort((a, b) => a[1].localeCompare(b[1]))); };
const greetChips = (cur, attr, other) => {
  const opts = greetOpts(), custom = other || (cur && cur !== "-" && !opts.some(([k]) => k === cur));
  return `<div class="chips gchips" role="group" aria-label="How do you greet them in messages?">${opts.map(([k, v]) => `<button type="button" class="chip" ${attr}="${k}" aria-pressed="${!custom && (cur || "") === k}">${v}</button>`).join("")}<button type="button" class="chip" ${attr}="__other" aria-pressed="${!!custom}">Other</button></div>
    ${custom ? `<input id="${attr}-txt" class="gtxt" maxlength="20" placeholder="Type it, e.g. Alhaji, Pastor, Engineer" value="${esc(cur && cur !== "-" && !opts.some(([k]) => k === cur) ? cur : "")}" autocomplete="off">` : ""}`;
};
// Puts a special item (name + price for one service) on the shop's price list. Returns the item id, or null.
async function toPriceList(name, svc, price) {
  const it = PRICES.find(x => !x.custom && x.name.toLowerCase() === name.toLowerCase());
  if (it) {
    if ((it.p || {})[svc] && !it.hidden) return it.id; // already priced: keep the owner's list price
    const pr = { ...(it.p || {}), [svc]: price }, svcs = [...new Set([...(it.services || []), svc])];
    return await put("items", { id: it.id }, { services: svcs, hidden: false }) && await put("item_prices", { item_id: it.id }, { prices: pr }) ? it.id : null;
  }
  const sort = Math.max(0, ...PRICES.filter(x => !x.custom).map(x => x.sort)) + 1;
  const { data, error } = await sb.from("items").insert({ shop_id: shop.id, name, services: [svc], sort }).select("id").single();
  if (error) { toast(failMsg(error)); return null; }
  const r2 = await sb.from("item_prices").insert({ item_id: data.id, shop_id: shop.id, prices: { [svc]: price } });
  if (r2.error) { toast(failMsg(r2.error)); return null; }
  PRICES.push({ id: data.id, name, custom: false, services: [svc], sort, hidden: false, p: { [svc]: price } });
  return data.id;
}
// A clear "are you sure" step for actions that are hard to undo (no browser pop-ups).
function askConfirm(title, text, yes) {
  return new Promise(res => {
    const w = document.createElement("div"); w.className = "cfm"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<div class="cfm-box"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ""}<div class="row"><button class="btn btn-ghost" data-c="0">Go back</button><button class="btn btn-primary" data-c="1">${esc(yes)}</button></div></div>`;
    const done = v => { w.remove(); res(v); };
    w.onclick = e => { if (e.target === w) done(false); };
    w.querySelectorAll("[data-c]").forEach(b => b.onclick = () => done(b.dataset.c === "1"));
    document.body.appendChild(w); w.querySelector('[data-c="1"]').focus();
  });
}
const cleanGreet = v => tidy(v).replace(/[^A-Za-z .'-]/g, "").slice(0, 20);
const BANKS = ["Access Bank", "ALAT by Wema", "Carbon", "Citibank", "Ecobank", "FairMoney", "Fidelity Bank", "First Bank", "FCMB", "Globus Bank", "GTBank", "Jaiz Bank", "Keystone Bank", "Kuda", "Lotus Bank", "Moniepoint", "Opay", "Optimus Bank", "Paga", "Palmpay", "Parallex Bank", "Polaris Bank", "Premium Trust Bank", "Providus Bank", "Signature Bank", "Stanbic IBTC", "Standard Chartered", "Sterling Bank", "SunTrust Bank", "Taj Bank", "Titan Trust Bank", "UBA", "Union Bank", "Unity Bank", "VFD Microfinance Bank", "Wema Bank", "Zenith Bank"];
const bankList = id => `<datalist id="${id}">${BANKS.map(b => `<option value="${b}"></option>`).join("")}</datalist>`;
const item = id => PRICES.find(x => x.id === id);
const pname = it => it.label || (item(it.id) || {}).name || "Item";
const emptyMoney = () => ({ unit: null, custom: {}, delivery: 0, discount: 0, total: 0, billed_at: null, paid: 0, payments: [], express_amt: 0 });

async function fetchAll(table, cols, orderBy) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    let q = sb.from(table).select(cols).range(from, from + step - 1);
    if (orderBy) q = q.order(orderBy, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < step) return out;
  }
}

async function load() {
  const base = await Promise.all([
    sb.from("shops").select("id,name,created_at,is_test,staff_prices").single(),
    fetchAll("branches", "id,name,sort,active", "sort"),
    fetchAll("items", "id,name,custom,services,sort,hidden", "sort"),
    fetchAll("customers", "id,name,mark,greet,greet_asked"),
    fetchAll("orders", "id,no,customer_id,branch_id,items,express,pickup,status,checking,checked,notified,billed,settled,list_sent,created_at,cancelled_at,cancelled_by", "no"),
  ]);
  if (base[0].error) throw base[0].error;
  shop = base[0].data; BRANCHES = base[1]; customers = base[3];
  loadPlan().then(() => { if (me && (tab === "orders" || tab === "new" || (tab === "prices" && setTab === "plan"))) render(); });
  let prices = {}, phones = {}, money = {};
  if (own()) {
    const [p, ip, ph, om, st] = await Promise.all([
      sb.from("shop_private").select("*").single(),
      fetchAll("item_prices", "item_id,prices"),
      fetchAll("customer_phones", "customer_id,phone"),
      fetchAll("order_money", "order_id,unit,custom,delivery,discount,total,billed_at,paid,payments,express_amt"),
      fetchAll("staff", "user_id,name,phone,role,created_at", "created_at"),
    ]);
    if (p.error) throw p.error;
    priv = p.data; staffList = st;
    ip.forEach(r => prices[r.item_id] = r.prices);
    ph.forEach(r => phones[r.customer_id] = r.phone);
    om.forEach(r => money[r.order_id] = r);
  } else if (shop.staff_prices) {
    (await fetchAll("item_prices", "item_id,prices")).forEach(r => prices[r.item_id] = r.prices);
  }
  PRICES = base[2].map(i => ({ ...i, p: prices[i.id] || {} }));
  customers.forEach(c => c.phone = phones[c.id] || "");
  const all = base[4].map(o => ({
    id: o.id, no: o.no, cid: o.customer_id, branch: o.branch_id, items: o.items || [], express: o.express, pickup: o.pickup,
    status: o.status, checking: o.checking, checked: o.checked || {}, notified: o.notified, billed: o.billed, settled: o.settled, list_sent: o.list_sent,
    at: Date.parse(o.created_at), m: { ...emptyMoney(), ...(money[o.id] || {}) }, again: {},
    cancelled: o.cancelled_at ? Date.parse(o.cancelled_at) : 0, cancelled_by: o.cancelled_by || "",
  }));
  // Cancelled orders stay on record but are left out of every list, total and report.
  orders = all.filter(o => !o.cancelled); cancelledOrders = all.filter(o => o.cancelled);
}

/* ---------- Saving: change the screen first, then the database; on failure reload what is really saved ---------- */
function failMsg(e) {
  const m = (e && (e.message || e.error_description)) || "";
  if (/fetch|network|Failed to/i.test(m)) return "Not saved. Check your internet and try again.";
  if (/OWNER_ONLY/.test(m)) return "Only the owner can do that.";
  if (/PLAN_ENDED/.test(m)) { loadPlan().then(render); return "New orders are paused until the Tagbook plan is paid."; }
  return "Not saved. Please try again.";
}
async function put(table, key, fields) {
  const { error } = await sb.from(table).update(fields).match(key);
  if (error) { toast(failMsg(error)); refresh(); return false; }
  return true;
}
async function saveMoney(o) {
  const m = o.m;
  const { error } = await sb.from("order_money").upsert({
    order_id: o.id, shop_id: shop.id, unit: m.unit, custom: m.custom, delivery: m.delivery, discount: m.discount,
    total: m.total, billed_at: m.billed_at, paid: m.paid, payments: m.payments, express_amt: m.express_amt,
  });
  if (error) { toast(failMsg(error)); refresh(); return false; }
  o.billed = !!m.billed_at; o.settled = o.billed && m.paid >= m.total;
  return true;
}
let reloadTimer = null, pending = false;
/* Background updates re-draw the screen; keep whatever the user has typed so far. */
function keepTyped(fn) {
  const saved = [];
  document.querySelectorAll("#view [id], #sheet [id]").forEach(el => {
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.type === "file") return;
    saved.push([el.id, el.type === "checkbox" || el.type === "radio" ? el.checked : el.value, el.type === "checkbox" || el.type === "radio"]);
  });
  fn();
  saved.forEach(([id, v, isCheck]) => { const el = document.getElementById(id); if (!el) return; if (isCheck) el.checked = v; else if (el.value !== v) el.value = v; });
}
function refresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await load(); } catch (e) { return; }
    if (busy()) { pending = true; return; }
    keepTyped(render);
  }, 350);
}
document.addEventListener("focusout", () => setTimeout(() => { if (pending && !busy()) { pending = false; keepTyped(render); } }, 50));
window.addEventListener("online", () => { $("#offline").hidden = true; refresh(); });
window.addEventListener("offline", () => { $("#offline").hidden = false; });

let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("shop-" + shop.id);
  const tables = ["orders", "customers", "items", "branches", "shops"].concat(own() ? ["order_money", "customer_phones", "item_prices", "shop_private"] : shop.staff_prices ? ["item_prices"] : []);
  tables.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: t === "shops" ? `id=eq.${shop.id}` : `shop_id=eq.${shop.id}` }, refresh));
  channel.subscribe();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) refresh(); });

/* ---------- Money ---------- */
const sPriv = () => priv || { express_type: "manual", express_value: 0, bank_name: "", acct_no: "", acct_name: "" };
const hasBank = () => { const p = sPriv(); return p.bank_name.trim() && p.acct_no.length === 10 && p.acct_name.trim(); };
const payTo = () => { const p = sPriv(); return hasBank() ? `\n\nPay by transfer to:\n${p.bank_name.trim()}\n${p.acct_no}\n${p.acct_name.trim()}\nPlease send your payment receipt here.` : ""; };
const expManual = () => sPriv().express_type === "manual";
function expressFor(sub) { const p = sPriv(); return p.express_type === "manual" ? 0 : p.express_type === "times" ? sub * Math.max(1, p.express_value) - sub : p.express_type === "percent" ? Math.round(sub * p.express_value / 100 / 50) * 50 : p.express_value; }
const expressLabel = () => { const p = sPriv(); return p.express_type === "manual" ? "" : p.express_type === "times" ? ` (${p.express_value}× the bill)` : p.express_type === "percent" ? ` (+${p.express_value}%)` : ` (+${naira(p.express_value)})`; };
function unitPrice(o, it, i) {
  if (o.m.unit && o.m.unit[i] != null) return o.m.unit[i];
  const p = item(it.id) || {};
  if (p.custom) return +o.m.custom[i] || 0;
  return (p.p && p.p[it.svc]) || 0;
}
function lockPrices(o) { o.m.unit = o.items.map((it, i) => (item(it.id) || {}).custom ? null : unitPrice({ ...o, m: { ...o.m, unit: null } }, it, i)); }
function calc(o) {
  const count = o.items.reduce((s, it) => s + it.qty, 0);
  if (!own()) return { sub: 0, exp: 0, total: 0, count };
  const sub = o.items.reduce((s, it, i) => s + unitPrice(o, it, i) * it.qty, 0);
  const exp = o.express ? (expManual() || (o.billed && o.m.express_amt) ? (+o.m.express_amt || 0) : expressFor(sub)) : 0;
  const total = Math.max(0, sub + exp + (+o.m.delivery || 0) - (+o.m.discount || 0));
  return { sub, exp, total, count };
}
const owed = o => own() ? (o.billed ? Math.max(0, o.m.total - o.m.paid) : 0) : (o.billed && !o.settled ? 1 : 0);

const MOON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g></svg>';
/* ---------- Ordiventa dashboard (platform admin only) ---------- */
let dash = null, dashAt = 0, dashBusy = false, leads = [], leadForm = false, agents = [], agentForm = false, newAgent = null, nCopy = null, markFor = null, markPlan = 1, teamPay = [], editFor = null, payOpen = null;
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); if (m < 2) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago"; };
const daysTo = d => d ? Math.ceil((Date.parse(d + "T23:59:59") - Date.now()) / 864e5) : null;
async function loadDash() { if (dashBusy) return; dashBusy = true; try { const [{ data, error }, L, A] = await Promise.all([sb.rpc("admin_dashboard"), sb.from("ref_leads").select("*").order("created_at"), sb.rpc("admin_agents")]); if (!error) { dash = data || []; dashAt = Date.now(); } if (!L.error) leads = L.data || []; if (!A.error) agents = A.data || []; try { const T = await sb.rpc("admin_team_pay"); if (!T.error) teamPay = T.data || []; } catch (_) { } } finally { dashBusy = false; } if (tab === "admin") keepTyped(renderAdmin); }
const daysLeft = d => d ? Math.round((Date.parse(String(d).slice(0, 10) + "T00:00:00Z") - Date.parse(lagosDay(Date.now()) + "T00:00:00Z")) / 864e5) : null;
const coveredUntil = r => [r.trial_ends, r.paid_until].filter(Boolean).sort().pop() || null;
function shopFlags(r) {
  const f = [], age = (Date.now() - Date.parse(r.created_at)) / 864e5, left = daysTo(r.trial_ends);
  if (!r.orders && age > 1) f.push(["No orders yet, " + Math.floor(age) + " day" + (Math.floor(age) === 1 ? "" : "s") + " in", "owes"]);
  else if (!r.orders) f.push(["No orders yet", "warn"]);
  else if (r.last_order && Date.now() - Date.parse(r.last_order) > 3 * 864e5) f.push(["No orders for " + ago(r.last_order).replace(" ago", ""), "owes"]);
  const cov = coveredUntil(r), cl = daysLeft(cov);
  if (cl !== null && cl < 0) f.push([cl < -2 ? "Plan ended, orders paused" : "Plan ended, in 2-day grace", "owes"]);
  else if (cl !== null && cl <= 7) f.push([(r.paid_until && r.paid_until >= cov ? "Plan" : "Trial") + (cl === 0 ? " ends today" : " ends in " + cl + " day" + (cl === 1 ? "" : "s")), "warn"]);
  if (!r.staff) f.push(["No staff login", "warn"]);
  if (!r.push) f.push(["Owner alerts off", "warn"]);
  return f;
}
let adminView = (() => { try { return localStorage.getItem("tb-admin-view") || "shops"; } catch (_) { return "shops"; } })();
const adminSeg = () => `<div class="aseg" role="tablist"><button data-av="shops" aria-pressed="${adminView === "shops"}">Shops</button><button data-av="leads" aria-pressed="${adminView === "leads"}">Leads</button></div>`;
function wireAdminSeg() { view.querySelectorAll("[data-av]").forEach(b => b.onclick = () => { adminView = b.dataset.av; try { localStorage.setItem("tb-admin-view", adminView); } catch (_) { } renderAdmin(); }); }

/* ---------- Leads: shops to reach, with one-tap WhatsApp messages ---------- */
let oCopy = null; // iPhone + WhatsApp Business: Apple gives websites no way to open Business, so we copy the message instead
const iosBiz = () => isIOS && waApp === "business";
let olead = null, olog = [], oleadBusy = false, oCity = "Akure", oStatus = "new", oQ = "", oAdd = false;
let oCall = null, oScriptOpen = (() => { try { return localStorage.getItem("tb-script-open") === "1"; } catch (_) { return false; } })();
// Is now a good time to phone a laundry? Lagos time. Weekdays 10am-12pm and 3-5pm; Saturday mornings are
// busy with drop-offs, so 12-2pm and 3-5pm; Sunday most shops are closed or at church.
function callTiming() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  const d = now.getDay(), m = now.getHours() * 60 + now.getMinutes();
  const slots = d === 0 ? [] : d === 6 ? [[720, 840], [900, 1020]] : [[600, 720], [900, 1020]];
  const fmt = x => { const h = Math.floor(x / 60), mm = x % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
  const cur = slots.find(([a, b]) => m >= a && m < b);
  if (cur) return { ok: true, text: `Good time to call now, until ${fmt(cur[1])}.` };
  const next = slots.find(([a]) => m < a);
  if (next) return { ok: false, text: `Not the best time. Next good time today: ${fmt(next[0])} to ${fmt(next[1])}.` };
  return { ok: false, text: d === 0 ? "Sunday: most shops are closed or at church. Call tomorrow from 10am." : d === 6 ? "Done for today. Shops close soon; call Monday from 10am." : "Done for today. Call tomorrow from " + (d === 5 ? "12pm (Saturday)." : "10am.") };
}
function callScriptHtml() {
  const t = callTiming(), l = oCall && olead && olead.find(x => x.id === oCall), shop = l ? `<b>${esc(l.name)}</b>` : "[Shop name]";
  return `<section class="scard oscript">
    <button class="oscript-top" id="oscript" aria-expanded="${oScriptOpen}"><span><b>Call script</b><span class="otime ${t.ok ? "ok" : ""}">${t.text}</span></span><span aria-hidden="true">${oScriptOpen ? "▴" : "▾"}</span></button>
    ${oScriptOpen ? `<div class="oscript-body">
      ${l ? `<p class="ocalling">Calling ${esc(l.name)}${l.phone ? ` · ${fmtPhone(l.phone)}` : ""}</p>` : ""}
      <ol>
        <li><b>Opening</b><p>"Good ${new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false }) < 12 ? "morning" : "afternoon"}. Am I speaking with the owner of ${shop}?"</p><p class="hint">Not the owner? "Please, when is the best time to reach the owner?" Write it in the note and call back then.</p></li>
        <li><b>Why you're calling</b><p>"My name is Bolu, from Tagbook. We help laundry shops keep track of every customer's clothes, send the bill on WhatsApp, and see who still owes, all from your phone."</p></li>
        <li><b>Ask, then listen</b><p>"How do you keep track of your customers' clothes right now?"</p><p class="hint">Book, tags or memory: "That's exactly what Tagbook replaces."</p></li>
        <li><b>The offer</b><p>"The first month is free, then ₦3,000 a month, and you can stop anytime. Can we set it up for you now? We just need your shop name and the number you'll log in with."</p></li>
        <li><b>If they hesitate</b><p>"No problem. Can we send you a short video on WhatsApp so you can see how it works?"</p></li>
      </ol>
      <p class="hint">Keep it under 3 minutes. After the call, set the status below and add a one-line note.</p>
    </div>` : ""}
  </section>`;
}
const O_STATUS = { new: "To contact", messaged: "Messaged", replied: "Replied", demo: "Demo booked", joined: "Joined", no: "Said no" };
const O_PILL = { new: "p-new", messaged: "p-billed", replied: "p-ready", demo: "p-ready", joined: "p-collected", no: "p-owed" };
const DAILY_SAFE = 5;
const lagosDay = t => new Date(new Date(t).getTime() + 3600e3).toISOString().slice(0, 10);
async function loadLeads() {
  if (oleadBusy) return; oleadBusy = true;
  try {
    // The server returns at most 1,000 rows per call, so fetch the leads in pages.
    const allLeads = async () => {
      let rows = [];
      for (let from = 0; ; from += 1000) {
        const r = await sb.from("outreach_leads").select("*").order("created_at").order("id").range(from, from + 999);
        if (r.error) return r;
        rows = rows.concat(r.data || []);
        if (!r.data || r.data.length < 1000) return { data: rows };
      }
    };
    const [a, b] = await Promise.all([allLeads(), sb.from("outreach_log").select("lead_id,kind,sent_at").gte("sent_at", new Date(Date.now() - 60 * 864e5).toISOString())]);
    if (!a.error) olead = a.data || []; if (!b.error) olog = b.data || [];
  } finally { oleadBusy = false; }
  if (tab === "admin" && adminView === "leads") keepTyped(renderAdmin);
}
const ONDO_NEAR = ["Ondo town", "Owo", "Ore", "Ikare-Akoko", "Akungba", "Ile-Oluji", "Okitipupa", "Idanre"];
function greet() { const h = (new Date().getUTCHours() + 1) % 24; return h < 12 ? "Good morning" : h < 16 ? "Good afternoon" : "Good evening"; }
// Outreach messages rotate between versions so WhatsApp doesn't see the same text sent again and again.
// Each lead keeps its version for this page visit, so "Message on WhatsApp" and "Copy" always match.
const LEAD_FIRST = [
  (g, n, near, visit) => `${g}. This is Bolu from Tagbook. We found ${n} on Google Maps.${near}\n\nWe've built a simple app that helps laundry and dry cleaning shops record every customer's clothes, send the bill on WhatsApp and see who still owes.\n\nCan we send you a 2 minute video of how it works?${visit}\n\nBolu, Tagbook team`,
  (g, n, near, visit) => `${g}. Is this the owner of ${n}?\n\nMy name is Bolu, from Tagbook.${near} We help laundry shops keep track of customers' clothes and payments from their phone.\n\nWould you like to see a short video of how it works?${visit}`,
  (g, n, near, visit) => `${g}. Bolu here, from Tagbook.${near} We came across ${n} on Google.\n\nWe have an app made for laundry and dry cleaning shops. It records each customer's clothes, sends their bill on WhatsApp and shows you who hasn't paid.\n\nShould we send you a quick video?${visit}\n\nBolu, Tagbook team`,
  (g, n, near, visit) => `${g}. This is Bolu from Tagbook.${near}\n\nHow do you keep track of your customers' clothes at ${n} right now? A book, tags, or memory?\n\nWe made a simple app that does it for you and also sends the bill on WhatsApp. Can we show you a 2 minute video?${visit}`,
  (g, n, near, visit) => `${g}. We saw ${n} on Google Maps and wanted to reach out. This is Bolu from Tagbook.${near}\n\nTagbook is an app for laundry shops: log customers' clothes, send bills on WhatsApp, see who owes. The first month is free.\n\nCan we send you a short video?${visit}\n\nBolu, Tagbook team`,
];
const LEAD_FOLLOW = [
  g => `${g}. Just checking if you saw our message about Tagbook, the app that records your customers' clothes and payments. We're happy to send a 2 minute video if you'd like to see it.\n\nBolu, Tagbook team`,
  g => `${g}. Following up on our message about Tagbook for your shop. Would a short video of how it works be helpful?`,
  g => `${g}. Just checking in. Did you get a chance to see our message? We'd be happy to show you how Tagbook works for laundry shops.\n\nBolu, Tagbook team`,
];
const leadPick = {}; let leadTurn = Math.floor(Math.random() * 15);
function leadMsg(l, kind) {
  const list = kind === "follow" ? LEAD_FOLLOW : LEAD_FIRST, key = l.id + ":" + kind;
  if (leadPick[key] == null) leadPick[key] = leadTurn++ % list.length; // next version in turn, so neighbours never match
  if (kind === "follow") return list[leadPick[key]](greet());
  const akure = l.city === "Akure", near = akure ? " We're based here in Akure." : ONDO_NEAR.includes(l.city) ? " We're in Akure, not far from you." : "";
  return list[leadPick[key]](greet(), l.name, near, akure ? "\n\nSince we're in Akure, we can also come by and set it up for you." : "");
}
/* Message for a live shop that hasn't started, or has gone quiet */
function nudgeMsg(r) {
  // Skip initials like "O A Matthew" -> "Matthew"
  const first = String(r.owner_name || "").trim().split(/\s+/).find(w => w.replace(/[^a-z]/gi, "").length >= 3) || "";
  const hi = `${greet()}${first ? " " + first : ""}. This is Bolu from Tagbook.`;
  const cl = daysLeft(coveredUntil(r));
  if (cl !== null && cl < 0) return `${hi}\n\nYour Tagbook plan ended on ${longDay(coveredUntil(r))}.${cl >= -2 ? " You can still log clothes for a short while, but it will pause soon." : " New orders are paused for now, but all your records are safe."}\n\nYou can pay in the app under Settings, Plan & billing. The 6 months plan gives you 1 month free.\n\nIf you'd rather pay us directly, just reply here.\n\nBolu, Tagbook team`;
  const vid = ((tuts || []).find(t => t.step_key === "order") || {}).youtube_id || "SiUDE8sCSQ4";
  if (!r.orders) return `${hi}\n\nWe noticed no clothes have gone into Tagbook yet. Is anything stopping you, or is something not clear?\n\nThis short video shows how to log your first customer's clothes. It takes less than a minute: https://youtu.be/${vid}\n\nIf you'd like us to walk you through it, just reply and we'll give you a quick call.\n\nBolu, Tagbook team`;
  const days = Math.floor((Date.now() - Date.parse(r.last_order)) / 864e5);
  return `${hi}\n\nWe noticed nothing has been logged in Tagbook for ${days} days. Is everything okay with the app?\n\nIf something is not working well for you, tell us and we will fix it. We can also give you a quick call to help.\n\nBolu, Tagbook team`;
}
/* ---------- Plan & billing ---------- */
let plan = null, planPick = "m6", planBusy = false, planFailed = false;
const PRICE_MONTH = 3000;
const PLAN_INFO = { m1: ["1 month", 1, ""], m6: ["6 months", 6, "1 month free"], m12: ["1 year", 12, "2 months free"] };
const longDay = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const TAGBOOK_LINE = "2348120756325";
async function loadPlan() {
  try { const { data, error } = await sb.rpc("my_plan"); if (!error) plan = data; } catch (_) { }
  return plan;
}
const planEnded = () => !!plan && plan.state === "ended";
function planBanner() {
  if (!plan || plan.state === "free") return "";
  const d = plan.days_left, pay = own() ? `<button data-gopay>Pay now</button>` : "";
  let t = "";
  if (plan.state === "ended") t = own() ? "New orders are paused. Your records are safe. Pay to start logging clothes again." : "New orders are paused. Ask the owner to pay for Tagbook.";
  else if (plan.state === "grace") t = own() ? `Your Tagbook plan ended on ${longDay(plan.until)}. Pay by ${longDay(plan.grace_until)} to keep logging clothes.` : `The Tagbook plan has ended. Ask the owner to pay by ${longDay(plan.grace_until)}, or logging will pause.`;
  else if (own() && d <= 7) t = plan.state === "trial" ? `Your free trial ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}. It's ${naira(PRICE_MONTH)} a month, or pay for 6 months or 1 year and get free months.` : `Your Tagbook plan ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}.`;
  return t ? `<div class="alert ${plan.state === "ended" || plan.state === "grace" ? "planwarn" : ""}"><span>${t}</span>${pay}</div>` : "";
}
function wirePlanBanner(root) { root.querySelectorAll("[data-gopay]").forEach(b => b.onclick = () => go("plan")); }
async function billingCall(body) {
  const { data, error } = await sb.functions.invoke("billing", { body });
  if (!error) return data || {};
  let j = {}; try { j = await error.context.json(); } catch (_) { }
  return { error: j.error || "NETWORK" };
}
function planHtml() {
  if (!plan || !plan.prices) return card("Plan & billing", "", planFailed
    ? `<p class="hint" style="margin-top:0">Couldn't load your plan. Check your internet and try again.</p><button class="btn btn-ghost" id="planretry">Try again</button>`
    : `<p class="hint">Loading…</p>`);
  const p = plan, d = p.days_left;
  const status = {
    trial: [`Free trial`, `Ends ${longDay(p.until)} · ${d} day${d === 1 ? "" : "s"} left`],
    paid: [`Paid until ${longDay(p.until)}`, `${d} day${d === 1 ? "" : "s"} left`],
    grace: [`Your plan ended on ${longDay(p.until)}`, `You can still log clothes until ${longDay(p.grace_until)}. Pay before then.`],
    ended: [`New orders are paused`, `Your records are safe. Pay to start logging clothes again.`],
    free: [`No plan needed`, `This shop isn't billed.`],
  }[p.state];
  const per = k => Math.round(p.prices[k] / PLAN_INFO[k][1]);
  const save = k => p.prices.m1 * PLAN_INFO[k][1] - p.prices[k];
  const opts = ["m1", "m6", "m12"].filter(k => p.prices[k]).map(k => `<button class="popt" data-plan="${k}" aria-pressed="${planPick === k}">
      <span class="pname">${PLAN_INFO[k][0]}${k === "m12" ? ` <em>Best value</em>` : ""}</span>
      <b>${naira(p.prices[k])}</b>
      <span class="hint">${k === "m1" ? "Pay every month" : `${PLAN_INFO[k][2]} (save ${naira(save(k))})`}</span></button>`).join("");
  const refs = p.referrals || [];
  return card("Your plan", "", `<p class="pstate"><b>${status[0]}</b><span>${status[1]}</span></p>`)
    + (p.state === "free" && !isAdmin ? "" : card("Choose a plan", p.state === "free" ? "Test shop: paying here is only for trying the payment. It doesn't change anything for real shops." : "",
      `<p class="hint" style="margin-top:0">${naira(p.prices.m1)} a month for every shop, with no extra charges. Pay ahead and get free months.</p>
       <div class="plans">${opts}</div>
       <button class="btn btn-primary" id="paygo">Pay ${naira(p.prices[planPick])} with Paystack</button>
       <p class="hint">Card, bank transfer or USSD. ${p.state === "free" ? "" : p.state === "trial" || p.state === "paid" ? `Paying early adds to the days you have left, so the new plan starts after ${longDay(p.until)}.` : "Logging opens again as soon as you pay."}</p>`))
    + card("Refer a laundry, get a month free", "When a shop you refer pays for Tagbook, your next month is free. Refer 12 and use Tagbook free for a year.",
      `<p class="pstate"><b>${refs.length} shop${refs.length === 1 ? "" : "s"} referred · ${p.free_months} free month${p.free_months === 1 ? "" : "s"} earned</b></p>
       ${refs.map(r => `<div class="staff-row"><div><b>${esc(r.name)}</b><span>Joined ${longDay(r.joined)}${r.reward_at ? ` · your free month was added ${longDay(r.reward_at)}` : " · free month comes when they start paying"}</span></div><span class="pill ${r.paying ? "p-ready" : "p-billed"}">${r.paying ? "Paying" : "On trial"}</span></div>`).join("")}
       <a class="btn btn-primary" target="_blank" rel="noopener" href="${refShareLink()}">Share with a laundry</a>
       <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://wa.me/${TAGBOOK_LINE}?text=${encodeURIComponent(`Hello Tagbook, we want to refer a laundry to you.\n\nShop name:\nOwner's phone:\n\nReferred by: ${shop.name}`)}">Or send us their details</a>`)
    + ((p.payments || []).length ? card("Payment history", "", p.payments.map(x => `<div class="staff-row"><div><b>${naira(x.amount)} · ${x.months} month${x.months === 1 ? "" : "s"}</b><span>${longDay(x.paid_at)}${x.method === "manual" ? " · paid to Tagbook directly" : " · Paystack"} · covered until ${longDay(x.paid_until)}</span></div></div>`).join("")) : "");
}
function wirePlan() {
  // Load the plan once when the tab opens. If it fails, show "Try again" instead of retrying on its own.
  if (!plan || !plan.prices) {
    if ($("#planretry")) $("#planretry").onclick = () => { planFailed = false; renderSettings(); };
    if (!planBusy && !planFailed) { planBusy = true; loadPlan().finally(() => { planBusy = false; planFailed = !(plan && plan.prices); if (tab === "prices" && setTab === "plan") renderSettings(); }); }
    return;
  }
  view.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => { planPick = b.dataset.plan; renderSettings(); });
  const go_ = $("#paygo"); if (!go_) return;
  go_.onclick = async () => {
    go_.disabled = true; go_.textContent = "Opening Paystack…";
    const r = await billingCall({ action: "start", plan: planPick });
    if (r.url) { location.href = r.url; return; }
    go_.disabled = false; go_.textContent = `Pay ${naira(plan.prices[planPick])} with Paystack`;
    toast(r.error === "NOT_READY" ? "Online payment isn't switched on yet. Message Tagbook to pay." : r.error === "NETWORK" ? "Check your internet and try again." : "Couldn't open Paystack. Please try again.");
  };
}
async function checkPaystackReturn() {
  const q = new URLSearchParams(location.search), ref = q.get("reference") || q.get("trxref");
  if (!ref) return;
  history.replaceState(null, "", location.pathname + "#plan");
  toast("Checking your payment…");
  const r = await billingCall({ action: "verify", reference: ref });
  await loadPlan();
  if (r.ok) toast(`Payment received. Tagbook is paid until ${longDay(r.paid_until)}.`);
  else if (r.error === "NOT_PAID") toast("The payment wasn't completed. You can try again.");
  else toast("We couldn't confirm the payment yet. If you paid, it will show here shortly.");
  route();
}
const copyText = async text => { try { await navigator.clipboard.writeText(text); return true; } catch (_) { const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (_) { } t.remove(); return ok; } };
/* Leads open in WhatsApp Business by default (the 0812 line); switchable to normal WhatsApp */
let waApp = (() => { try { return localStorage.getItem("tb-wa-app") || "business"; } catch (_) { return "business"; } })();
const isAndroid = /Android/i.test(navigator.userAgent);
const waLink = (phone, text) => {
  const num = "234" + String(phone).replace(/^0/, ""), t = text ? encodeURIComponent(text) : "";
  if (waApp === "business" && isAndroid) return `intent://send/?phone=${num}${t ? "&text=" + t : ""}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent("https://wa.me/" + num + (t ? "?text=" + t : ""))};end`;
  return `https://wa.me/${num}${t ? "?text=" + t : ""}`;
};
function renderLeads() {
  if (olead === null) { loadLeads(); view.innerHTML = `${adminSeg()}<p class="hint">Loading leads…</p>`; wireAdminSeg(); return; }
  const today = lagosDay(Date.now());
  const sentToday = olog.filter(x => lagosDay(x.sent_at) === today).length;
  const lastSent = id => olog.filter(x => x.lead_id === id).reduce((m, x) => Math.max(m, Date.parse(x.sent_at)), 0);
  const cityOrder = ["Akure"].concat(ONDO_NEAR, ["Ado Ekiti", "Osogbo", "Ile-Ife", "Ibadan", "Ilorin", "Abeokuta", "Lagos", "Benin City", "Abuja", "Port Harcourt"]);
  const cities = [...new Set(olead.map(l => l.city))].sort((a, b) => (cityOrder.indexOf(a) + 1 || 99) - (cityOrder.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const inCity = olead.filter(l => oCity === "all" || l.city === oCity);
  const q = oQ.trim().toLowerCase();
  const list = inCity.filter(l => (oStatus === "all" || l.status === oStatus) && (!q || (l.name + " " + (l.area || "") + " " + (l.phone || "")).toLowerCase().includes(q)));
  const groups = cities.map(c => [c, list.filter(l => l.city === c)]).filter(g => g[1].length);
  const pct = Math.min(100, Math.round(sentToday / DAILY_SAFE * 100));
  const card = l => {
    const last = lastSent(l.id), days = last ? (Date.now() - last) / 864e5 : null;
    let act = "";
    if (!l.phone) act = `<span class="hint">No phone yet</span>`;
    else if (l.status === "new") act = `<a class="btn btn-primary" data-wa="${l.id}" data-kind="first" href="${waLink(l.phone, leadMsg(l, "first"))}" target="_blank" rel="noopener">Message on WhatsApp</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="first">Copy message instead</button>` : ""}`;
    else if (l.status === "messaged") act = days !== null && days >= 2 ? `<a class="btn btn-ghost" data-wa="${l.id}" data-kind="follow" href="${waLink(l.phone, leadMsg(l, "follow"))}" target="_blank" rel="noopener">Send follow-up</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="follow">Copy follow-up instead</button>` : ""}` : `<span class="hint">Messaged ${ago(new Date(last).toISOString())}</span>`;
    else if (l.status !== "no") act = `<a class="btn btn-ghost" href="${waLink(l.phone)}" target="_blank" rel="noopener">Open chat</a>`;
    return `<section class="olead${l.status === "no" ? " is-no" : ""}">
      <div class="ohead"><div><b>${esc(l.name)}</b><span>${esc(l.area || "")}${l.phone ? ` · ${fmtPhone(l.phone)}` : ""}</span></div><span class="pill ${O_PILL[l.status]}">${O_STATUS[l.status]}</span></div>
      ${l.notes ? `<p class="onote">${esc(l.notes)}</p>` : ""}
      ${oCopy && oCopy.id === l.id ? `<div class="ocopy"><p><b>Message copied.</b> Now open <b>WhatsApp Business</b>, start a new chat with <b>${fmtPhone(l.phone)}</b> and paste the message.</p>
        <div class="row"><button class="btn btn-ghost" data-copynum="${l.id}">Copy number</button><button class="btn btn-ghost" data-recopy="${l.id}">Copy message again</button></div>
        <div class="row"><button class="btn btn-primary" data-sent="${l.id}">I've sent it</button><button class="btn btn-ghost" data-nocopy>Not now</button></div></div>` : ""}
      <div class="oact">${l.phone && l.status !== "no" ? `<a class="btn btn-ghost ocall" data-call="${l.id}" href="tel:${l.phone}">Call</a>` : ""}${act}<select data-ost="${l.id}" aria-label="Change status for ${esc(l.name)}">${Object.entries(O_STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </section>`;
  };
  view.innerHTML = `${adminSeg()}
    <div class="dtop"><div><h2 class="ptitle">Leads</h2><p class="hint">${olead.length} shops · tap a button to open WhatsApp with the message ready</p></div><div class="row"><button class="btn btn-ghost" id="oadd">+ Add a lead</button></div></div>
    <div class="owa"><span>Open chats in</span><div class="aseg"><button data-wapp="business" aria-pressed="${waApp === "business"}">WhatsApp Business</button><button data-wapp="normal" aria-pressed="${waApp === "normal"}">WhatsApp</button></div></div>
    <section class="scard osent"><div class="osent-top"><b>${sentToday} of ${DAILY_SAFE}</b><span>messages sent today</span></div><div class="obar"><i style="width:${pct}%" class="${sentToday >= DAILY_SAFE ? "full" : ""}"></i></div>
      <p class="hint" style="margin:8px 0 0">${sentToday >= DAILY_SAFE ? "That's today's safe limit. Carry on tomorrow so WhatsApp doesn't flag the 0812 line." : `${DAILY_SAFE - sentToday} more today keeps the 0812 line safe.`}</p></section>
    ${callScriptHtml()}
    ${oAdd ? `<section class="scard dlead"><h3 class="stitle">Add a lead</h3>
      <label for="ol-n">Shop name</label><input id="ol-n" autocomplete="off">
      <div class="sgrid"><div><label for="ol-a">Area</label><input id="ol-a" placeholder="e.g. Oba Ile" autocomplete="off"></div>
      <div><label for="ol-c">City</label><input id="ol-c" list="ol-cities" value="${oCity === "all" ? "Akure" : esc(oCity)}" autocomplete="off"><datalist id="ol-cities">${cities.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div></div>
      <label for="ol-p">Phone</label><input id="ol-p" type="text" inputmode="tel" autocomplete="off">
      <label for="ol-x">Note (optional)</label><input id="ol-x" autocomplete="off">
      <div class="row"><button class="btn btn-ghost" id="ol-no">Cancel</button><button class="btn btn-primary" id="ol-go">Save lead</button></div></section>` : ""}
    <div class="chips ochips">${[["all", "All", olead.length]].concat(cities.map(c => [c, c, olead.filter(l => l.city === c).length])).map(([k, v, n]) => `<button class="chip" data-oc="${esc(k)}" aria-pressed="${oCity === k}">${esc(v)} <span class="n">${n}</span></button>`).join("")}</div>
    <div class="chips ochips">${[["new", "To contact"], ["messaged", "Messaged"], ["replied", "Replied"], ["demo", "Demo booked"], ["joined", "Joined"], ["no", "Said no"], ["all", "All"]].map(([k, v]) => `<button class="chip" data-os="${k}" aria-pressed="${oStatus === k}">${v} <span class="n">${k === "all" ? inCity.length : inCity.filter(l => l.status === k).length}</span></button>`).join("")}</div>
    <input id="oq" class="search" placeholder="Search name, area or phone" value="${esc(oQ)}" autocomplete="off">
    ${groups.length ? groups.map(([c, ls]) => {
      // On "All" with no search, show a few per city so the page stays quick on a phone.
      const cut = oCity === "all" && !q && ls.length > 6;
      return `<h3 class="stitle dtest">${esc(c)} <span class="hint">${ls.length}</span></h3><div class="dlist">${(cut ? ls.slice(0, 6) : ls).map(card).join("")}</div>${cut ? `<button class="btn btn-ghost omore" data-oc="${esc(c)}">See all ${ls.length} in ${esc(c)}</button>` : ""}`;
    }).join("") : `<p class="hint" style="margin-top:16px">No leads here.</p>`}`;
  wireAdminSeg();
  $("#oscript").onclick = () => { oScriptOpen = !oScriptOpen; try { localStorage.setItem("tb-script-open", oScriptOpen ? "1" : "0"); } catch (_) { } renderAdmin(); };
  // Tapping Call opens the phone's dialer and opens the script for that shop, so it's there when you come back.
  view.querySelectorAll("[data-call]").forEach(a => a.onclick = () => { oCall = a.dataset.call; oScriptOpen = true; setTimeout(() => { renderAdmin(); const sc = $(".oscript"); if (sc) sc.scrollIntoView({ block: "start" }); }, 300); });
  view.querySelectorAll("[data-wapp]").forEach(b => b.onclick = () => { waApp = b.dataset.wapp; try { localStorage.setItem("tb-wa-app", waApp); } catch (_) { } renderAdmin(); });
  view.querySelectorAll("[data-oc]").forEach(b => b.onclick = () => { oCity = b.dataset.oc; renderAdmin(); if (b.classList.contains("omore")) mainScroll().scrollTo(0, 0); });
  view.querySelectorAll("[data-os]").forEach(b => b.onclick = () => { oStatus = b.dataset.os; renderAdmin(); });
  $("#oq").oninput = e => { oQ = e.target.value; clearTimeout(window.__oqT); window.__oqT = setTimeout(() => { const pos = e.target.selectionStart; renderAdmin(); const el = $("#oq"); el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { } }, 250); };
  $("#oadd").onclick = () => { oAdd = !oAdd; renderAdmin(); if (oAdd) $("#ol-n").focus(); };
  if ($("#ol-no")) $("#ol-no").onclick = () => { oAdd = false; renderAdmin(); };
  if ($("#ol-go")) $("#ol-go").onclick = async () => {
    const row = { name: $("#ol-n").value.trim(), area: $("#ol-a").value.trim() || null, city: $("#ol-c").value.trim() || "Akure", phone: digits($("#ol-p").value) || null, notes: $("#ol-x").value.trim() || null };
    if (!row.name) return toast("Type the shop name");
    if (row.phone && !/^0\d{10}$/.test(row.phone)) return toast("The phone must be 11 digits and start with 0.");
    const { data, error } = await sb.from("outreach_leads").insert(row).select().single();
    if (error) return toast("Couldn't save. Check your internet.");
    olead.push(data); oAdd = false; oCity = data.city; oStatus = "new"; toast("Lead saved"); renderAdmin();
  };
  const markSent = (l, kind) => {
    olog.push({ lead_id: l.id, kind, sent_at: new Date().toISOString() });
    sb.from("outreach_log").insert({ lead_id: l.id, kind }).then(() => { });
    if (l.status === "new") { l.status = "messaged"; sb.from("outreach_leads").update({ status: "messaged" }).eq("id", l.id).then(() => { }); }
  };
  const copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch (_) { const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (_) { } t.remove(); return ok; } };
  view.querySelectorAll("[data-wa]").forEach(a => a.addEventListener("click", () => {
    const l = olead.find(x => x.id === a.dataset.wa); if (!l) return;
    markSent(l, a.dataset.kind); setTimeout(() => renderAdmin(), 400);
  }));
  view.querySelectorAll("[data-wacopy]").forEach(b => b.onclick = async () => {
    const l = olead.find(x => x.id === b.dataset.wacopy); if (!l) return;
    oCopy = { id: l.id, kind: b.dataset.kind, text: leadMsg(l, b.dataset.kind) };
    toast(await copy(oCopy.text) ? "Message copied" : "Couldn't copy. Try again."); renderAdmin();
  });
  view.querySelectorAll("[data-recopy]").forEach(b => b.onclick = async () => toast(await copy(oCopy.text) ? "Message copied" : "Couldn't copy"));
  view.querySelectorAll("[data-copynum]").forEach(b => b.onclick = async () => { const l = olead.find(x => x.id === b.dataset.copynum); toast(await copy("+234" + l.phone.slice(1)) ? "Number copied" : "Couldn't copy"); });
  view.querySelectorAll("[data-sent]").forEach(b => b.onclick = () => { const l = olead.find(x => x.id === b.dataset.sent); markSent(l, oCopy.kind); oCopy = null; toast(`${l.name}: marked as messaged`); renderAdmin(); });
  view.querySelectorAll("[data-nocopy]").forEach(b => b.onclick = () => { oCopy = null; renderAdmin(); });
  view.querySelectorAll("[data-ost]").forEach(sel => sel.onchange = async () => {
    const l = olead.find(x => x.id === sel.dataset.ost); const status = sel.value;
    const { error } = await sb.from("outreach_leads").update({ status }).eq("id", l.id);
    if (error) return toast("Couldn't save. Check your internet.");
    l.status = status; toast(`${l.name}: ${O_STATUS[status]}`); renderAdmin();
  });
}

function renderAdmin() {
  if (!isAdmin) return go("orders");
  if (adminView === "leads") return renderLeads();
  if (dash === null || Date.now() - dashAt > 60e3) loadDash();
  if (dash === null) { view.innerHTML = `<h2 class="ptitle">Shops</h2><p class="hint">Loading…</p>`; return; }
  const real = dash.filter(r => !r.is_test), test = dash.filter(r => r.is_test);
  const sum = k => real.reduce((s, r) => s + (+r[k] || 0), 0);
  const active = real.filter(r => r.week > 0).length, trial = real.filter(r => daysTo(r.trial_ends) >= 0).length;
  const need = real.map(r => [r, shopFlags(r).filter(f => f[1] === "owes")]).filter(x => x[1].length);
  const wa = p => p ? "https://wa.me/234" + String(p).replace(/^0/, "") : "";
  const shopCard = r => {
    const left = daysTo(r.trial_ends), trend = r.prev_week ? Math.round((r.week - r.prev_week) / r.prev_week * 100) : null;
    return `<section class="dshop${r.is_test ? " is-test" : ""}">
      <div class="dhead"><div><b>${esc(r.name)}</b><span>${esc(r.owner_name || "")}${r.owner_phone ? ` · <a href="${wa(r.owner_phone)}" target="_blank" rel="noopener">${fmtPhone(r.owner_phone)}</a>` : ""}</span></div>
        <span class="pill ${r.is_test ? "p-collected" : left !== null && left >= 0 ? "p-billed" : "p-ready"}">${r.is_test ? "Test" : left !== null && left >= 0 ? "Trial" : "Live"}</span></div>
      <div class="dnums"><div><b>${r.today}</b><span>Today</span></div><div><b>${r.week}</b><span>7 days${trend !== null ? ` <em class="${trend >= 0 ? "up" : "down"}">${trend >= 0 ? "+" : ""}${trend}%</em>` : ""}</span></div><div><b>${r.orders}</b><span>All orders</span></div><div><b>${r.clothes_week}</b><span>Clothes this week</span></div></div>
      <dl class="dmeta">
        <div><dt>Last order</dt><dd>${r.last_order ? ago(r.last_order) : "none yet"}</dd></div>
        <div><dt>Last opened</dt><dd>${ago(r.last_active)}</dd></div>
        <div><dt>Logins</dt><dd>${r.owners} owner, ${r.staff} staff</dd></div>
        <div><dt>Owner alerts</dt><dd>${r.push ? "On" : "Off"}</dd></div>
        <div><dt>Joined</dt><dd>${fmtDay(Date.parse(r.created_at))}</dd></div>
        <div><dt>Trial</dt><dd>${r.trial_ends ? (left >= 0 ? `ends ${fmtDay(Date.parse(r.trial_ends))} (${left} day${left === 1 ? "" : "s"})` : `ended ${fmtDay(Date.parse(r.trial_ends))}`) : "none"}</dd></div>
        <div><dt>Agent</dt><dd>${esc(r.brought_by_name || "Ordiventa")} · helper: ${esc(r.setup_by_name || "none")}</dd></div>
        <div><dt>Paid</dt><dd>${r.paid_until ? `until ${longDay(r.paid_until)} · ${naira(r.paid_total)} so far` : r.paid_total ? naira(r.paid_total) + " so far" : "not yet"}${r.free_months ? ` · ${r.free_months} free month${r.free_months === 1 ? "" : "s"} earned` : ""}</dd></div>
        ${(pend => r.referred_by_name || r.referrals || pend ? `<div><dt>Referrals</dt><dd>${[r.referred_by_name ? `From ${esc(r.referred_by_name)}` : "", r.referrals ? `brought ${r.referrals}` : "", pend ? `${pend} lead${pend === 1 ? "" : "s"} pending` : ""].filter(Boolean).join(" · ")}</dd></div>` : "")(leads.filter(l => l.referrer_shop === r.id && l.status === "pending").length)}
      </dl>
      ${!r.is_test && r.claim_status === "pending" ? `<div class="dclaim"><p><b>${esc(r.claim_by_name || "An agent")}</b> says <b>${r.claim_kind === "self" ? "they" : esc(r.claim_for_name || "a team member")}</b> found this shop. No agent pay until you decide.</p>
        <div class="row"><button class="btn btn-primary" data-cl="${r.id}" data-ok="1">Yes, ${r.claim_kind === "self" ? esc(r.claim_by_name || "they") : esc(r.claim_for_name || "they")} found it</button><button class="btn btn-ghost" data-cl="${r.id}" data-ok="0">Ordiventa found it</button><button class="btn btn-ghost" data-ep="${r.id}">Another team member</button></div></div>` : ""}
      ${r.is_test ? "" : editFor === r.id ? `<div class="dlead dmark">
          <label for="ep-r">Referred by (shop)</label><select id="ep-r" ${r.reward_given ? "disabled" : ""}><option value="">Nobody</option>${dash.filter(k => !k.is_test && k.id !== r.id).map(k => `<option value="${k.id}" ${r.referred_by === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select>
          ${r.reward_given ? `<p class="hint">The free month was already given, so this can't change.</p>` : ""}
          <label for="ep-b">Agent (found and closed the shop)</label><select id="ep-b"><option value="">Ordiventa (no agent pay)</option>${agents.map(a => `<option value="${a.user_id}" ${(r.claim_status === "pending" ? null : r.brought_by) === a.user_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
          ${r.claim_status === "pending" ? `<p class="hint">Pick the team member who really found this shop, then Save.</p>` : ""}
          <label for="ep-s">Helper (demoed and set it up)</label><select id="ep-s"><option value="">Nobody (no helper pay)</option>${agents.map(a => `<option value="${a.user_id}" ${r.setup_by === a.user_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
          <div class="row"><button class="btn btn-ghost" data-epno>Cancel</button><button class="btn btn-primary" data-epgo="${r.id}">Save</button></div></div>` : `<button class="btn btn-ghost dmarkbtn" data-ep="${r.id}">Edit referral, agent and helper</button>`}
      ${r.is_test ? "" : markFor === r.id ? `<div class="dlead dmark"><label for="mk-m">Months paid for</label><input id="mk-m" type="text" inputmode="numeric" maxlength="2" value="${markPlan}">
          <label for="mk-a">Amount received (₦)</label><input id="mk-a" ${moneyAttrs} value="${PRICE_MONTH * markPlan}">
          <label for="mk-n">Note (optional)</label><input id="mk-n" placeholder="e.g. transfer to Ordiventa account" autocomplete="off">
          <div class="row"><button class="btn btn-ghost" data-mkno>Cancel</button><button class="btn btn-primary" data-mkgo="${r.id}">Mark as paid</button></div></div>` : `<button class="btn btn-ghost dmarkbtn" data-mk="${r.id}">Record a cash or transfer payment</button>`}
      ${r.is_test ? "" : (f => f.length ? `<div class="dflags">${f.map(([t, k]) => `<span class="pill p-${k === "owes" ? "owed" : "new"}">${t}</span>`).join("")}</div>` : "")(shopFlags(r))}
    </section>`;
  };
  const referrers = real.filter(r => r.referrals || leads.some(l => l.referrer_shop === r.id));
  const refHtml = `<section class="scard dref"><h3 class="stitle">Referrals</h3>
    <p class="ssub">A shop earns 1 free month when a shop it brought starts paying.</p>
    ${referrers.length ? referrers.map(r => {
      const joined = dash.filter(k => k.referred_by === r.id), ls = leads.filter(l => l.referrer_shop === r.id && !l.joined_shop);
      return `<div class="drefb"><b>${esc(r.name)}</b>${r.owner_name ? `<span class="hint">${esc(r.owner_name)}</span>` : ""}
        ${joined.map(k => { const left = daysTo(k.trial_ends); return `<div class="dref-row"><div><b>${esc(k.name)}</b><span>Joined ${fmtDay(Date.parse(k.created_at))} · ${left !== null && left >= 0 ? `free month due once they pay, from ${fmtDay(Date.parse(k.trial_ends))}` : "free month due once they pay"}</span></div><span class="pill p-ready">Joined</span></div>`; }).join("")}
        ${ls.map(l => `<div class="dref-row"><div><b>${esc(l.name)}</b><span>${[l.contact ? fmtPhone(l.contact) : "", l.note ? esc(l.note) : "", "added " + fmtDay(Date.parse(l.created_at))].filter(Boolean).join(" · ")}</span></div>
          ${l.status === "pending" ? `<div class="row"><button class="btn btn-ghost" data-lj="${l.id}">Joined</button><button class="btn btn-ghost" data-ll="${l.id}">Lost</button></div>` : `<span class="pill ${l.status === "joined" ? "p-ready" : "p-collected"}">${l.status === "joined" ? "Joined" : "Lost"}</span>`}</div>`).join("")}
      </div>`; }).join("") : `<p class="hint">No referrals yet.</p>`}
    ${leadForm ? `<div class="dlead"><label for="rl-r">Referred by</label><select id="rl-r">${real.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>
      <label for="rl-n">Shop or person they referred</label><input id="rl-n" placeholder="e.g. Latwash Laundry (Mr Lateef)" autocomplete="off">
      <label for="rl-c">Phone (optional)</label><input id="rl-c" type="text" inputmode="tel" autocomplete="off">
      <label for="rl-x">Note (optional)</label><input id="rl-x" placeholder="e.g. don't mention who referred" autocomplete="off">
      <div class="row"><button class="btn btn-ghost" id="rl-no">Cancel</button><button class="btn btn-primary" id="rl-go">Save lead</button></div></div>`
      : `<button class="btn btn-ghost" id="rl-add">+ Add a referral lead</button>`}
  </section>`;
  const agentHtml = `<section class="scard dref"><h3 class="stitle">Agents</h3>
    <p class="ssub">Your team demo Tagbook on their own copy of BrightWash and set shops up. They can't see this page or any shop's money. Helper (demo and setup): ₦1,500 when the shop first pays, ₦1,500 more from day 30 if it's still logging orders. Agent (found and closed it): ₦3,000 once the shop has paid ₦6,000, plus ₦500 for each paid month, up to 12. Pay from a shop never goes above half of what that shop has paid; anything above that waits until it pays more. Pay out once someone is owed ${naira((teamPay[0] || {}).threshold || 10000)}, or once money has waited ${(teamPay[0] || {}).max_wait || 60} days. You get a notification when someone is ready.</p>
    ${agents.map(a => { const t = teamPay.find(x => x.user_id === a.user_id) || { due: 0, paid: 0, items: [] }; return `<div class="dteam"><div class="dref-row" style="padding-left:0"><div><b>${esc(a.name)}</b><span>${fmtPhone(a.phone)} · ${a.shops} shop${a.shops === 1 ? "" : "s"} set up, ${a.active} logged orders this week${a.names.length ? ` · ${a.names.map(esc).join(", ")}` : ""}</span></div></div>
      ${t.acct_no ? `<div class="dbank"><span><b>${esc(t.acct_no)}</b> · ${esc(t.bank_name)} · ${esc(t.acct_name)}</span><div class="row"><button class="btn btn-ghost" data-bkc="${esc(t.acct_no)}">Copy number</button><button class="btn btn-ghost" data-bkc="${esc(`${t.acct_name}\n${t.acct_no}\n${t.bank_name}`)}">Copy all</button></div></div>` : `<p class="hint">No bank details yet. Ask them to add them under Set up shops.</p>`}
      ${t.ready ? `<span class="pill p-ready">Ready to pay</span>` : t.due ? `<span class="hint">${naira(t.due)} of ${naira(t.threshold || 10000)} payout level</span>` : ""}
      <div class="dpay"><div><b>${naira(t.due)}</b><span>owed now</span></div>${t.held ? `<div><b>${naira(t.held)}</b><span>waiting on shops</span></div>` : ""}<div><b>${naira(t.paid)}</b><span>paid so far</span></div>
        <div class="row">${t.items.length ? `<button class="btn btn-ghost" data-tpo="${a.user_id}">${payOpen === a.user_id ? "Hide details" : "Details"}</button>` : ""}${t.due ? `<button class="btn btn-primary" data-tpay="${a.user_id}">Mark ${naira(t.due)} paid</button>` : ""}</div></div>
      ${payOpen === a.user_id ? t.items.map(i => `<div class="staff-row"><div><b>${naira(i.amount)} · ${esc(i.shop)}</b><span>${esc(i.what)} · ${longDay(i.due_on)}</span></div><span class="pill ${i.status === "paid" ? "p-collected" : i.status === "held" ? "p-billed" : "p-ready"}">${i.status === "paid" ? "Paid" : i.status === "held" ? "Waiting" : "Owed"}</span></div>`).join("") : ""}</div>`; }).join("") || `<p class="hint">Nobody yet.</p>`}
    ${newAgent ? `<div class="dlead"><p class="hint">Send this to ${esc(newAgent.name.split(" ")[0])}:</p><div class="wa">${esc(newAgent.msg)}</div>
        <div class="row"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234${newAgent.phone.slice(1)}?text=${encodeURIComponent(newAgent.msg)}">Send on WhatsApp</a><button class="btn btn-ghost" id="ag-done">Done</button></div></div>`
      : agentForm ? `<div class="dlead"><label for="ag-n">Name</label><input id="ag-n" autocomplete="off">
        <label for="ag-p">Phone</label><input id="ag-p" type="text" inputmode="tel" autocomplete="off">
        <label for="ag-pin">6-digit PIN (made for you, change it if you like)</label><input id="ag-pin" class="pin" ${genPinAttrs()}>
        <div class="row"><button class="btn btn-ghost" id="ag-no">Cancel</button><button class="btn btn-primary" id="ag-go">Add to team</button></div></div>`
      : `<button class="btn btn-ghost" id="ag-add">+ Add an agent</button>`}
  </section>`;
  view.innerHTML = `${adminSeg()}<div class="dtop"><div><h2 class="ptitle">Shops</h2><p class="hint">Updated ${ago(new Date(dashAt).toISOString())} · test shops not counted</p></div>
      <div class="row"><button class="btn btn-ghost" id="dref">Refresh</button><button class="btn btn-primary" id="dadd">Add a shop</button></div></div>
    <div class="stats dstats">
      <div class="stat"><b>${real.length}</b><span>Shops</span></div>
      <div class="stat"><b>${active}<small> of ${real.length}</small></b><span>Logged orders this week</span></div>
      <div class="stat"><b>${sum("today")}</b><span>Orders today</span></div>
      <div class="stat"><b>${sum("week")}</b><span>Orders, 7 days</span></div>
      <div class="stat"><b>${sum("clothes").toLocaleString()}</b><span>Clothes logged · ${sum("clothes_week").toLocaleString()} this week</span></div>
      <div class="stat"><b>${trial}</b><span>On free trial</span></div>
      <div class="stat"><b>${naira(sum("paid_total"))}</b><span>Shops have paid us</span></div>
      <div class="stat"><b>${naira(real.length * PRICE_MONTH)}</b><span>Monthly, once all pay</span></div>
    </div>
    ${(cl => cl.length ? `<section class="scard dcall"><h3 class="stitle">Claims to check</h3><p class="ssub">Approve only if you're sure. Your decision is final.</p>${cl.map(r => `<div class="staff-row"><div><b>${esc(r.name)}</b><span>${esc(r.claim_by_name || "An agent")} says ${r.claim_kind === "self" ? "they" : esc(r.claim_for_name || "a team member")} found it</span></div><div class="row"><button class="btn btn-primary" data-cl="${r.id}" data-ok="1">Approve</button><button class="btn btn-ghost" data-cl="${r.id}" data-ok="0">Ordiventa</button><button class="btn btn-ghost" data-ep="${r.id}" data-goto="1">Someone else</button></div></div>`).join("")}</section>` : "")(real.filter(r => r.claim_status === "pending"))}
    ${need.length ? `<section class="scard dcall"><h3 class="stitle">Call these shops</h3><p class="ssub">A call works best. If you can't call, send the message.</p>${need.map(([r, f]) => `<div class="staff-row"><div><b>${esc(r.name)}</b><span>${f.map(x => x[0]).join(" · ")}</span></div>${r.owner_phone ? `<div class="row"><a class="btn btn-ghost" href="tel:${esc(r.owner_phone)}">Call</a>${`<a class="btn btn-primary" href="${waLink(r.owner_phone, nudgeMsg(r))}" target="_blank" rel="noopener">WhatsApp</a>${iosBiz() ? `<button class="btn btn-ghost" data-ncopy="${r.id}">Copy</button>` : ""}`}</div>` : ""}</div>${iosBiz() && nCopy === r.id ? `<div class="ocopy"><p><b>Message copied.</b> Open <b>WhatsApp Business</b>, open the chat with ${fmtPhone(r.owner_phone)} and paste it.</p><div class="row"><button class="btn btn-ghost" data-nnum="${r.id}">Copy number</button><button class="btn btn-ghost" data-nclose>Done</button></div></div>` : ""}`).join("")}</section>` : ""}
    <div class="dlist">${real.map(shopCard).join("") || `<p class="hint">No shops yet.</p>`}</div>
    ${refHtml}
    ${agentHtml}
    ${test.length ? `<h3 class="stitle dtest">Test shops</h3><div class="dlist">${test.map(shopCard).join("")}</div>` : ""}`;
  wireAdminSeg();
  $("#dref").onclick = () => { dashAt = 0; loadDash(); toast("Refreshing"); };
  view.querySelectorAll("[data-ep]").forEach(b => b.onclick = () => { editFor = b.dataset.ep; renderAdmin(); const f = $("#ep-b"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } });
  view.querySelectorAll("[data-epno]").forEach(b => b.onclick = () => { editFor = null; renderAdmin(); });
  view.querySelectorAll("[data-epgo]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const v = id => $(id).value || null;
    const { error } = await sb.rpc("admin_set_shop_people", { p_shop: b.dataset.epgo, p_referred_by: v("#ep-r"), p_brought_by: v("#ep-b"), p_setup_by: v("#ep-s") });
    b.disabled = false;
    if (error) { toast(/REWARD_GIVEN/.test(error.message) ? "The free month was already given for this shop." : "Not saved. Please try again."); return; }
    editFor = null; toast("Saved"); dashAt = 0; loadDash();
  });
  view.querySelectorAll("[data-bkc]").forEach(b => b.onclick = async () => toast(await copyText(b.dataset.bkc) ? "Copied" : "Couldn't copy"));
  view.querySelectorAll("[data-cl]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.rpc("admin_decide_claim", { p_shop: b.dataset.cl, p_approve: b.dataset.ok === "1" });
    if (error) { b.disabled = false; toast("Not saved. Please try again."); return; }
    toast(b.dataset.ok === "1" ? "Approved. Agent pay will count for this shop." : "Saved. No agent pay for this shop."); dashAt = 0; loadDash();
  });
  view.querySelectorAll("[data-tpo]").forEach(b => b.onclick = () => { payOpen = payOpen === b.dataset.tpo ? null : b.dataset.tpo; renderAdmin(); });
  view.querySelectorAll("[data-tpay]").forEach(b => b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again once you've sent it"; return; }
    b.disabled = true;
    const { data, error } = await sb.rpc("admin_pay_agent", { p_agent: b.dataset.tpay });
    if (error || !data || !data.ok) { b.disabled = false; toast("Not saved. Please try again."); return; }
    toast(`Marked ${naira(data.amount)} as paid.`); dashAt = 0; loadDash();
  });
  view.querySelectorAll("[data-mk]").forEach(b => b.onclick = () => { markFor = b.dataset.mk; markPlan = 1; renderAdmin(); });
  if ($("#mk-m")) $("#mk-m").oninput = e => { markPlan = Math.max(1, Math.min(24, +digits(e.target.value) || 1)); if ($("#mk-a")) $("#mk-a").value = PRICE_MONTH * markPlan; };
  view.querySelectorAll("[data-mkno]").forEach(b => b.onclick = () => { markFor = null; renderAdmin(); });
  view.querySelectorAll("[data-mkgo]").forEach(b => b.onclick = async () => {
    const amt = +digits($("#mk-a").value); if (!amt) { toast("Enter the amount received."); return; }
    b.disabled = true;
    const { data, error } = await sb.rpc("admin_record_payment", { p_shop: b.dataset.mkgo, p_months: markPlan, p_amount: amt, p_note: $("#mk-n").value });
    b.disabled = false;
    if (error || !data || !data.ok) { toast("Not saved. Please try again."); return; }
    markFor = null; toast(`Saved. Paid until ${longDay(data.paid_until)}.`); dashAt = 0; loadDash();
  });
  view.querySelectorAll("[data-ncopy]").forEach(b => b.onclick = async () => { const r = dash.find(x => x.id === b.dataset.ncopy); if (await copyText(nudgeMsg(r))) { nCopy = r.id; renderAdmin(); } else toast("Couldn't copy"); });
  view.querySelectorAll("[data-nnum]").forEach(b => b.onclick = async () => { const r = dash.find(x => x.id === b.dataset.nnum); toast(await copyText("+234" + String(r.owner_phone).replace(/^0/, "")) ? "Number copied" : "Couldn't copy"); });
  view.querySelectorAll("[data-nclose]").forEach(b => b.onclick = () => { nCopy = null; renderAdmin(); });
  $("#dadd").onclick = () => { setTab = "shops"; go("shop"); };
  const setLead = async (id, status) => { const { error } = await sb.from("ref_leads").update({ status }).eq("id", id); if (error) return toast("Couldn't save. Check your internet."); const l = leads.find(x => x.id === id); if (l) l.status = status; renderAdmin(); };
  view.querySelectorAll("[data-lj]").forEach(b => b.onclick = () => setLead(b.dataset.lj, "joined"));
  view.querySelectorAll("[data-ll]").forEach(b => b.onclick = () => setLead(b.dataset.ll, "lost"));
  if ($("#ag-add")) $("#ag-add").onclick = () => { agentForm = true; renderAdmin(); $("#ag-n").focus(); };
  if ($("#ag-no")) $("#ag-no").onclick = () => { agentForm = false; renderAdmin(); };
  if ($("#ag-done")) $("#ag-done").onclick = () => { newAgent = null; renderAdmin(); };
  if ($("#ag-go")) $("#ag-go").onclick = async () => {
    const name = $("#ag-n").value.trim(), phone = digits($("#ag-p").value), pin = digits($("#ag-pin").value);
    const err = !name ? "Type their name." : !/^0\d{10}$/.test(phone) ? "The phone must be 11 digits and start with 0." : pin.length !== 6 ? "The PIN must be 6 digits." : "";
    if (err) return toast(err);
    $("#ag-go").disabled = true; $("#ag-go").textContent = "Adding…";
    const r = await callAdmin({ action: "create_agent", name, phone, pin });
    if (!r.ok) { toast(r.msg); $("#ag-go").disabled = false; $("#ag-go").textContent = "Add to team"; return; }
    newAgent = { name, phone, msg: `Hello ${name.split(" ")[0]}, welcome to the Tagbook team.\n\nOpen tagbook.ordiventa.com and log in with:\nPhone: ${fmtPhone(phone)}\nPIN: ${pin}\n\nYou'll see a demo shop (BrightWash) to show shop owners, and a "Set up shops" tab to create their accounts.` };
    agentForm = false; dashAt = 0; loadDash();
  };
  if ($("#rl-add")) $("#rl-add").onclick = () => { leadForm = true; renderAdmin(); $("#rl-n").focus(); };
  if ($("#rl-no")) $("#rl-no").onclick = () => { leadForm = false; renderAdmin(); };
  if ($("#rl-go")) $("#rl-go").onclick = async () => {
    const name = $("#rl-n").value.trim(); if (!name) return toast("Type the shop or person's name");
    const row = { referrer_shop: $("#rl-r").value, name, contact: $("#rl-c").value.replace(/\D/g, "") || null, note: $("#rl-x").value.trim() || null };
    const { data, error } = await sb.from("ref_leads").insert(row).select().single(); if (error) return toast("Couldn't save. Check your internet.");
    leads.push(data); leadForm = false; toast("Lead saved"); renderAdmin();
  };
}
/* ---------- Navigation ---------- */
const TAB_HASH = { orders: "orders", new: "log", prices: "shop", reports: "reports", admin: "admin", agent: "setup", help: "help" };
function go(h) { if (location.hash.slice(1) === h) route(); else location.hash = h; }
function route() {
  if (!me) return;
  const h = location.hash.slice(1);
  const m = h.match(/^order-(\d+)$/);
  if (m && (orders.some(o => o.no === +m[1]) || cancelledOrders.some(o => o.no === +m[1]))) { tab = "orders"; openNo = +m[1]; }
  else if (h === "plan") { openNo = null; tab = "prices"; setTab = own() ? "plan" : "account"; }
  else if (h === "help" || h.startsWith("help-")) { openNo = null; tab = "help"; helpPlay = h.startsWith("help-") ? h.slice(5) : null; }
  else { openNo = null; tab = h === "log" ? "new" : h === "shop" ? "prices" : (h === "reports" && own()) ? "reports" : (h === "admin" && isAdmin) ? "admin" : (h === "setup" && isAgent) ? "agent" : "orders"; }
  render();
}
window.addEventListener("hashchange", route);
["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
const backBtn = label => `<div class="topbar"><button class="back" data-back>← ${label}</button></div>`;
function wireBack(root) { root.querySelectorAll("[data-back]").forEach(b => b.onclick = () => go("orders")); }

// Floating WhatsApp button so a shop can reach Tagbook support from any main screen.
const WA_ICON = `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z"/></svg>`;
function drawSupportFab() {
  let f = document.getElementById("supfab");
  if (!f) { f = document.createElement("a"); f.id = "supfab"; f.target = "_blank"; f.rel = "noopener"; f.setAttribute("aria-label", "Chat with Tagbook support on WhatsApp"); f.title = "Chat with Tagbook support"; f.innerHTML = WA_ICON; document.body.appendChild(f); }
  f.href = "https://wa.me/" + TAGBOOK_LINE + "?text=" + encodeURIComponent(`Hello Tagbook, I need help with ${shopName() || "my shop"}.`);
  f.hidden = !!openNo || !["orders", "prices", "help", "reports"].includes(tab) || document.body.classList.contains("tplaying");
}
function render() {
  if (!me) return;
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = false; $("#tabsnav").hidden = false; $("#app").classList.remove("is-loading");
  $("#shopname").textContent = shopName();
  const tabs = own() ? [["orders", "Orders"], ["new", "+ Log clothes"], ["reports", "Reports"]] : [["orders", "Orders"], ["new", "+ Log clothes"]];
  if (isAdmin) tabs.push(["admin", "Shops"]); else if (isAgent) tabs.push(["agent", "Set up shops"]);

  const th = $("#themebtn"), dark = theme() === "dark";
  th.innerHTML = dark ? SUN : MOON; th.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode"); th.title = th.getAttribute("aria-label");
  th.onclick = () => { try { localStorage.setItem("tb-theme", dark ? "light" : "dark"); } catch (_) { } render(); };
  const hb = $("#helpbtn"); if (hb) { hb.hidden = false; hb.onclick = () => go("help"); hb.setAttribute("aria-current", tab === "help" ? "page" : "false"); }
  const g = $("#gear"); g.hidden = false; g.onclick = () => go("shop"); g.setAttribute("aria-current", tab === "prices" ? "page" : "false");
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" ${k === "new" ? 'class="new"' : ""} ${tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("");
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => go(TAB_HASH[b.dataset.tab]));
  if (tab !== "help") document.body.classList.remove("tplaying");
  if (tab === "orders") renderOrders(); else if (tab === "new") renderNew(); else if (tab === "reports") renderReports(); else if (tab === "admin") renderAdmin(); else if (tab === "agent") renderAgent(); else if (tab === "help") renderHelp(); else renderSettings();
  if (openNo) openOrder(openNo); else $("#sheet").hidden = true;
  document.body.classList.toggle("has-sheet", !!openNo);
  drawSupportFab();
}

// Right side of an order in the list: at most one money line and, only under "All" or a search,
// one plain status word. The filter chips already say the status, so it isn't repeated there.
function orderRight(o, showStatus) {
  // [words, colour class]: each stage has its own colour so rows are easy to tell apart at a glance
  const st = own()
    ? { new: ["Send list", "s-new"], listed: ["In progress", "s-work"], ready: ["Ready, not told", "s-new"], told: ["Customer told", "s-told"], picked: ["Picked up", "s-done"] }
    : { new: ["In progress", "s-work"], listed: ["In progress", "s-work"], ready: ["Ready", "s-told"], told: ["Ready", "s-told"], picked: ["Picked up", "s-done"] };
  let money = "";
  if (own() && !o.cancelled) {
    // A bold amount is always money still to collect.
    const due = owed(o);
    if (o.billed && due && (o.status === "told" || o.status === "picked")) money = `<b class="owes">Owes ${naira(due)}</b>`;
    else if (o.billed && due) money = `<b>${naira(due)} due</b>`;
    else if (o.billed) money = `<span class="sub s-paid">Paid</span>`;
    else if (o.m.paid) money = `<span class="sub">${naira(o.m.paid)} paid</span>`;
    else if (o.status !== "new") money = `<span class="sub">No bill yet</span>`;
  }
  if (!own() && o.billed && (o.status === "told" || o.status === "picked") && owed(o)) money = `<b class="owes">Not paid</b>`;
  const status = o.cancelled ? ["Cancelled", "s-done"] : showStatus ? st[o.status] : null;
  return money + (status ? `<span class="sub ${status[1]}">${status[0]}</span>` : "");
}

/* ---------- Install banner: Android gets the real install prompt, iPhone gets the steps ---------- */
let installEvt = null;
const installLater = () => { try { return Date.now() - (+localStorage.getItem("tb-install-later") || 0) < 3 * 864e5; } catch (_) { return false; } };
function showInstall() {
  const bar = document.getElementById("installbar"); if (!bar) return;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
  if (isStandalone || installLater() || (!installEvt && !ios) || (typeof me !== "undefined" && me)) { bar.hidden = true; return; }
  bar.innerHTML = `<img src="/icon-192.png" alt=""><div><b>Install Tagbook</b><span>${installEvt ? "Opens like an app, straight from your home screen." : "Tap the Share button <svg viewBox='0 0 24 24' width='15' height='15' aria-label='Share'><path fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'/></svg> (or tap <b>⋯</b> first, then Share), then <b>Add to Home Screen</b>."}</span></div>
    ${installEvt ? `<button id="instgo">Install</button>` : ""}<button id="instx" aria-label="Not now">×</button>`;
  bar.hidden = false;
  const go_ = document.getElementById("instgo");
  if (go_) go_.onclick = async () => { const e = installEvt; installEvt = null; bar.hidden = true; e.prompt(); try { const c = await e.userChoice; if (c.outcome !== "accepted") localStorage.setItem("tb-install-later", Date.now()); } catch (_) { } };
  document.getElementById("instx").onclick = () => { try { localStorage.setItem("tb-install-later", Date.now()); } catch (_) { } bar.hidden = true; };
}
/* ---------- How-to videos (YouTube) ---------- */
let tuts = null, tutsBusy = false, helpPlay = null, tutDel = null;
async function loadTuts(force) {
  if ((tuts && !force) || tutsBusy) return tuts;
  tutsBusy = true;
  try { const { data } = await sb.from("tutorials").select("*").order("sort").order("created_at"); tuts = data || []; } catch (_) { tuts = tuts || []; }
  tutsBusy = false; return tuts;
}
const myTuts = () => (tuts || []).filter(t => t.audience === "all" || (own() ? t.audience === "owner" : t.audience === "staff") || isAdmin);
const ytId = v => { const m = String(v || "").trim().match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/) || String(v || "").trim().match(/^([A-Za-z0-9_-]{11})$/); return m ? m[1] : null; };
const TUT_SEC = [["start", "Getting started", "Watch these once when you begin."], ["daily", "Every day", "The jobs you do with every customer."], ["more", "More", ""]];
function renderHelp() {
  if (!tuts) { view.innerHTML = backBtn("Orders") + `<p class="hint">Loading videos…</p>`; wireBack(view); loadTuts().then(() => { if (tab === "help") renderHelp(); }); return; }
  const list = myTuts(), play = helpPlay && list.find(t => t.youtube_id === helpPlay);
  const who = t => t.audience === "owner" ? "For owners" : t.audience === "staff" ? "For staff" : "For everyone";
  view.innerHTML = backBtn("Orders") + `
    <h2 class="vtitle">How-to videos</h2><p class="hint" style="margin-top:0">Short videos showing how to use Tagbook. Tap one to watch.</p>
    ${play ? `<section class="tplayer" role="dialog" aria-label="${esc(play.title)}"><div class="tptop"><b>${esc(play.title)}</b><button class="tclose" id="tclose" aria-label="Close video">✕</button></div><div class="tframe"><iframe src="https://www.youtube.com/embed/${play.youtube_id}?autoplay=1&rel=0&playsinline=1&origin=${encodeURIComponent(location.origin)}" title="${esc(play.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><a class="tyt" href="https://youtu.be/${play.youtube_id}" target="_blank" rel="noopener">Not playing? Watch it on YouTube</a></section>` : ""}
    ${TUT_SEC.map(([k, h, sub]) => { const l = list.filter(t => t.section === k); return l.length ? `<h3 class="stitle tsec">${h}</h3>${sub ? `<p class="hint" style="margin-top:-4px">${sub}</p>` : ""}<div class="tlist">${l.map(t => `
      <div class="tcard ${play && play.id === t.id ? "on" : ""}"><button class="tbtn" data-tplay="${t.youtube_id}"><span class="tthumb"><img src="https://i.ytimg.com/vi/${t.youtube_id}/mqdefault.jpg" alt="" loading="lazy" onerror="this.remove()"><i>▶</i></span><span class="ttxt"><b>${esc(t.title)}</b><span>${who(t)}</span></span></button>
      ${isAdmin ? `<button class="x" data-tdel="${t.id}" aria-label="Remove video">${tutDel === t.id ? "Remove?" : "✕"}</button>` : ""}</div>`).join("")}</div>` : ""; }).join("") || `<p class="hint">No videos yet.</p>`}
    ${isAdmin ? card("Add a video", "Paste a YouTube link. Only you see this form.", `
      <label for="tv-l">YouTube link</label><input id="tv-l" placeholder="https://youtu.be/..." autocomplete="off">
      <label for="tv-t">Title</label><input id="tv-t" placeholder="e.g. How to record a payment" maxlength="120">
      <div class="sgrid"><div><label for="tv-s">Section</label><select id="tv-s"><option value="daily">Every day</option><option value="start">Getting started</option><option value="more">More</option></select></div>
      <div><label for="tv-a">Who it's for</label><select id="tv-a"><option value="all">Everyone</option><option value="owner">Owners</option><option value="staff">Staff</option></select></div></div>
      <label for="tv-k">Show on setup step (optional)</label><select id="tv-k"><option value="">None</option><option value="install">Install</option><option value="prices">Price list</option><option value="bank">Bank details</option><option value="staff">Add staff</option><option value="push">Notifications</option><option value="order">First order</option></select>
      <button class="btn btn-primary" id="tv-go">Add video</button>`) : ""}`;
  wireBack(view);
  document.body.classList.toggle("tplaying", !!play);
  const tc = $("#tclose"); if (tc) tc.onclick = () => go("help");
  view.querySelectorAll("[data-tplay]").forEach(b => b.onclick = () => go("help-" + b.dataset.tplay));
  view.querySelectorAll("[data-tdel]").forEach(b => b.onclick = async () => {
    if (tutDel !== b.dataset.tdel) { tutDel = b.dataset.tdel; return renderHelp(); }
    const { error } = await sb.from("tutorials").delete().eq("id", b.dataset.tdel); tutDel = null;
    if (error) toast("Not removed. Please try again."); else { toast("Video removed"); await loadTuts(true); } renderHelp();
  });
  const add = $("#tv-go"); if (add) add.onclick = async () => {
    const id = ytId($("#tv-l").value), title = $("#tv-t").value.trim();
    if (!id) return toast("That doesn't look like a YouTube link.");
    if (title.length < 3) return toast("Type a title for the video.");
    const sec = $("#tv-s").value, sort = 10 + Math.max(0, ...(tuts || []).filter(t => t.section === sec).map(t => t.sort));
    add.disabled = true;
    const { error } = await sb.from("tutorials").insert({ youtube_id: id, title, section: sec, audience: $("#tv-a").value, step_key: $("#tv-k").value || null, sort });
    add.disabled = false;
    if (error) return toast("Not saved. Please try again.");
    toast("Video added"); await loadTuts(true); renderHelp();
  };
}

/* ---------- Referral: share message + quiet line on Orders ---------- */
const refShareLink = () => "https://wa.me/?text=" + encodeURIComponent(
  `We now use Tagbook in our laundry to record customers' clothes, send bills on WhatsApp and see who still owes. It has made things easier for us.\n\nThe first month is free. Message them here and tell them ${shop.name} sent you:\nhttps://wa.me/${TAGBOOK_LINE}?text=${encodeURIComponent(`Hi, ${shop.name} referred me to Tagbook`)}`);
const refLater = () => { try { return Date.now() - (+localStorage.getItem("tb-ref-later") || 0) < 30 * 864e5; } catch (_) { return false; } };
const GIFT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/></svg>`;
function refLine() {
  if (!own() || !priv || !setupState().complete || orders.length < 10 || refLater()) return "";
  return `<div class="refl"><span class="gift">${GIFT}</span><p><b>Know another laundry?</b> Refer them and get 1 month free.</p>
    <a class="share" target="_blank" rel="noopener" href="${refShareLink()}">Share</a><button class="x" id="refx" aria-label="Hide for 30 days">✕</button></div>`;
}
function wireRefLine() { const x = $("#refx"); if (x) x.onclick = () => { try { localStorage.setItem("tb-ref-later", Date.now()); } catch (_) { } renderOrders(); }; }

/* ---------- Owner's setup checklist on the Orders screen ---------- */
let instOpen = false;
const setupState = () => (priv && priv.setup) || {};
async function markSetup(k, v = true) {
  if (!own() || !priv) return;
  if (setupState()[k] === v) return;
  priv.setup = { ...setupState(), [k]: v };
  await sb.from("shop_private").update({ setup: priv.setup }).eq("shop_id", shop.id);
}
const setupLater = () => { try { return Date.now() - (+localStorage.getItem("tb-setup-later") || 0) < 864e5; } catch (_) { return false; } };
function setupSteps() {
  const st = setupState();
  if (standalone() && !st.installed) markSetup("installed");
  return [
    { k: "login", t: "Log in", done: true },
    { k: "install", t: "Install Tagbook on this phone", d: "So it opens like an app and can notify you.", go: "Show me", done: !!st.installed || standalone() || (!isPhone() && !installEvt) },
    { k: "prices", t: "Check your price list", d: "Change any price that's different in your shop.", go: "Open", done: !!st.prices },
    { k: "bank", t: "Add your bank details", d: "Your bill shows customers where to pay.", go: "Add", done: !!hasBank() },
    { k: "staff", t: "Add your staff", d: "Each staff gets their own login.", go: "Add", done: staffList.some(x => x.role !== "owner") || !!st.alone, alone: true },
    { k: "push", t: "Turn on notifications", d: "Get a buzz when staff log clothes.", go: "Turn on", done: pushSupported() && Notification.permission === "granted" },
    { k: "order", t: "Log your first customer's clothes", d: "Try it with the next customer who walks in.", go: "Log", done: orders.length > 0 },
  ];
}
const tutFor = k => { const t = (tuts || []).find(t => t.step_key === k && (t.audience !== "staff")); return t ? t.youtube_id : null; };
function setupCard() {
  if (!own() || !priv || setupState().complete || setupLater()) return "";
  if (!tuts && !tutsBusy) loadTuts().then(() => { if (tab === "orders" && !openNo) renderOrders(); });
  const steps = setupSteps(), n = steps.filter(x => x.done).length;
  if (n === steps.length) { markSetup("complete"); return `<section class="scard sdone"><span class="sbig">${TICK}</span><div><b>Your shop is ready</b><span>Every customer's clothes, bill and payment, now in one place.</span></div></section>`; }
  const next = steps.findIndex(x => !x.done);
  return `<section class="scard setup"><div class="cl-top"><h3>Get your shop ready</h3><span class="count">${n} of ${steps.length} done</span></div>
    <div class="segs">${steps.map(x => `<i class="${x.done ? "on" : ""}"></i>`).join("")}</div>
    <ul class="ssteps">${steps.map((x, i) => `<li class="sstep ${x.done ? "done" : ""} ${i === next ? "next" : ""}">
      <span class="tick">${TICK}</span><span class="txt"><b>${x.t}</b>${x.done ? "" : `<span>${x.d}${x.alone ? ` <button class="linkbtn" data-salone>I work alone</button>` : ""}${tutFor(x.k) ? ` <button class="linkbtn" data-watch="${tutFor(x.k)}">Watch how</button>` : ""}</span>`}</span>
      ${x.done ? "" : `<button class="go" data-sgo="${x.k}">${x.go}</button>`}</li>
      ${x.k === "install" && !x.done && instOpen ? `<li class="sinst">${installSteps()}</li>` : ""}`).join("")}</ul>
    <button class="linkbtn" id="slater">Hide for now</button></section>`;
}
const TICK = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function wireSetup() {
  view.querySelectorAll("[data-sgo]").forEach(b => b.onclick = async () => {
    const k = b.dataset.sgo;
    if (k === "install") { if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); try { await e.userChoice; } catch (_) { } } else instOpen = !instOpen; return renderOrders(); }
    if (k === "prices") { await markSetup("prices"); setTab = "prices"; return go("shop"); }
    if (k === "bank") { setTab = "business"; go("shop"); setTimeout(() => { const f = $("#an"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }, 250); return; }
    if (k === "staff") { setTab = "staff"; return go("shop"); }
    if (k === "push") { if (!pushSupported()) { toast(isIOS ? "Install Tagbook first (the step above), then open it from your Home Screen." : "This browser can't show notifications."); return; } await enablePush(); return renderOrders(); }
    if (k === "order") return go("log");
  });
  view.querySelectorAll("[data-watch]").forEach(b => b.onclick = () => go("help-" + b.dataset.watch));
  const a = view.querySelector("[data-salone]"); if (a) a.onclick = async () => { await markSetup("alone"); renderOrders(); };
  const l = $("#slater"); if (l) l.onclick = () => { try { localStorage.setItem("tb-setup-later", Date.now()); } catch (_) { } renderOrders(); };
}

/* After login: a card on the main screen until Tagbook is installed on this phone */
const isPhone = () => /Android|iPhone|iPod/i.test(navigator.userAgent);
const installCardLater = () => { try { return Date.now() - (+localStorage.getItem("tb-install-card") || 0) < 864e5; } catch (_) { return false; } };
function installCard() {
  if (standalone() || installCardLater() || (!installEvt && !isPhone())) return "";
  const steps = installEvt ? "" : installSteps();
  return `<section class="scard icard"><div class="ihead"><img src="/icon-192.png" alt=""><div><b>Install Tagbook on this phone</b><span>It opens like an app, stays logged in and can send you notifications.</span></div></div>
    ${steps}<div class="row">${installEvt ? `<button class="btn btn-primary" id="icgo">Install</button>` : ""}<button class="btn btn-ghost" id="iclater">Later</button></div></section>`;
}
function installSteps() {
  const share = `<svg viewBox='0 0 24 24' width='16' height='16' aria-label='Share'><path fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'/></svg>`;
  return isIOS
    ? `<ol class="isteps"><li>Tap the Share button ${share} ${/CriOS/.test(navigator.userAgent) ? "at the top right" : "at the bottom of the screen"}. Don't see it? Tap <b>⋯</b> at the bottom right first, then <b>Share</b>.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Then open Tagbook from your Home Screen.</li></ol>`
    : `<ol class="isteps"><li>Tap the menu <b>⋮</b> at the top right of your browser.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Then open Tagbook from your Home Screen.</li></ol>`;
}
function wireInstallCard() {
  if ($("#icgo")) $("#icgo").onclick = async () => { const e = installEvt; installEvt = null; e.prompt(); try { await e.userChoice; } catch (_) { } render(); };
  if ($("#iclater")) $("#iclater").onclick = () => { try { localStorage.setItem("tb-install-card", Date.now()); } catch (_) { } render(); };
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; showInstall(); if (typeof me !== "undefined" && me && $("#view") && !standalone()) render(); });
window.addEventListener("appinstalled", () => { installEvt = null; const b = document.getElementById("installbar"); if (b) b.hidden = true; toast("Tagbook installed. Open it from your home screen."); });
setTimeout(showInstall, 1500);

/* ---------- Push notifications (owner): staff logged an order / clothes ready ---------- */
const VAPID = "BLmHWFO3eEf660xQVHBvFJIPBsEjmjhM_5-BxwgKg0-z9kUpzOKRgtCGoY2_voza_qnZ0_gyqKrnbqixbbpfyIA";
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64 = s => { const p = "=".repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function swReg() { if (!("serviceWorker" in navigator)) return null; try { return await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register("/sw.js"); } catch (_) { return null; } }
async function saveSub(sub) {
  const j = sub.toJSON();
  const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, user_id: me.user_id, shop_id: shop.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
  return !error;
}
async function pushState() {
  if (!pushSupported()) return isIOS && !standalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}
async function enablePush() {
  if (!pushSupported()) { toast(isIOS ? "On iPhone, add Tagbook to your Home Screen first." : "This browser can't show notifications."); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Notifications not allowed. You can allow them in your phone's settings for this app."); return false; }
  const reg = await swReg(); if (!reg) { toast("Couldn't turn on notifications. Try again."); return false; }
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  try { if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) }); }
  catch (_) { toast("Couldn't turn on notifications. Try again."); return false; }
  if (!await saveSub(sub)) { toast("Not saved. Check your internet and try again."); return false; }
  toast("Notifications are on"); return true;
}
async function disablePush() {
  const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); try { await sub.unsubscribe(); } catch (_) { } }
}
// keep this phone's subscription saved (the address can change after updates)
async function syncPush() {
  if (!own() || !pushSupported() || Notification.permission !== "granted") return;
  const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
  if (sub) saveSub(sub);
}
const pushDismissed = () => { try { return localStorage.getItem("tb-push-later") === "1"; } catch (_) { return false; } };

/* ---------- Orders ---------- */
function renderOrders() {
  const fresh = orders.filter(o => !o.notified);
  const toList = orders.filter(o => o.status === "new");
  const notTold = orders.filter(o => o.status === "ready");
  const owing = orders.reduce((s, o) => s + ((o.status === "told" || o.status === "picked") ? (own() ? owed(o) : 0) : 0), 0);
  const inShop = orders.filter(o => o.status !== "picked");
  const fl = own()
    ? [["all", "All"], ["new", "Send list"], ["work", "In progress"], ["ready", "Ready, not told"], ["owed", "Owing"], ["picked", "Picked up"], ...(cancelledOrders.length || filter === "cx" ? [["cx", "Cancelled"]] : [])]
    : [["all", "All"], ["work", "In progress"], ["ready", "Ready"], ["picked", "Picked up"]];
  const inF = (o, f) => {
    // Owner: "In progress" = list sent, being washed (new ones sit under "Send list"). Staff: everything not yet ready.
    if (f === "work" && !(own() ? o.status === "listed" : (o.status === "new" || o.status === "listed"))) return false;
    if (f === "new" && o.status !== "new") return false;
    if (f === "ready" && !(own() ? o.status === "ready" : (o.status === "ready" || o.status === "told"))) return false;
    if (f === "owed" && !((o.status === "told" || o.status === "picked") && owed(o))) return false;
    if (f === "picked" && o.status !== "picked") return false;
    return true;
  };
  const list = (filter === "cx" ? cancelledOrders : orders).filter(o => {
    if (!inF(o, filter)) return false;
    if (query) {
      const c = cust(o.cid), q = query.toLowerCase().replace(/\s/g, "");
      return (own() && c.phone.includes(q)) || c.name.toLowerCase().replace(/\s/g, "").includes(q) || c.mark.toLowerCase() === q || String(o.no).includes(q);
    }
    return true;
  }).sort((a, b) => b.no - a.no);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE)); if (page >= pages) page = pages - 1; if (page < 0) page = 0;
  const shown = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const setupHtml = setupCard();
  const askPush = !setupHtml.includes("setup") && own() && pushSupported() && Notification.permission === "default" && !pushDismissed();
  view.innerHTML = `
    ${planBanner()}
    ${setupHtml || installCard()}
    ${askPush ? `<div class="alert push"><span>Get a buzz when staff log clothes, even when Tagbook is closed.</span><span class="pacts"><button id="pushon">Turn on</button><button class="later" id="pushlater">Not now</button></span></div>` : ""}
    ${own() && fresh.length ? `<div class="alert"><span>${fresh.length} new order${fresh.length > 1 ? "s" : ""} logged by staff. Send the list of clothes to the customer.</span><button id="seen">See</button></div>` : ""}
    ${own() ? `<div class="stats">
      <button class="stat ${toList.length ? "hot" : ""}" data-go="new"><b>${toList.length}</b><span>Send list</span></button>
      <button class="stat ${notTold.length ? "hot" : ""}" data-go="ready"><b>${notTold.length}</b><span>Ready, not told</span></button>
      <button class="stat" data-go="owed"><b>${naira(owing)}</b><span>Owed to you</span></button></div>`
      : `<div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><b>${inShop.length}</b><span>Orders in the shop</span></div>
      <div class="stat"><b>${inShop.reduce((s, o) => s + calc(o).count, 0)}</b><span>Clothes in the shop</span></div></div>`}
    <input class="search" id="q" placeholder="${own() ? "Search phone, name or mark (BO)" : "Search name or mark (BO)"}" value="${esc(query)}" aria-label="Search">
    <div class="chips">${fl.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}<span class="cnt">${k === "cx" ? cancelledOrders.length : orders.filter(o => inF(o, k)).length}</span></button>`).join("")}</div>
    <div class="list">${shown.length ? shown.map(o => {
      const c = cust(o.cid), k = calc(o); return `
      <button class="order" data-no="${o.no}">
        <div class="mark">${esc(c.mark)}</div>
        <div class="who"><b>${esc(c.name)}</b><span>#${o.no} · ${k.count} items${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}</span></div>
        <div class="right">${orderRight(o, filter === "all" || !!query)}</div>
      </button>`;
    }).join("") : `<div class="empty">${orders.length ? "No orders here. Change the filter or search." : "No orders yet. Tap “+ Log clothes” to add the first one."}</div>`}</div>
    ${pages > 1 ? `<div class="pager"><button class="mini" id="pgprev" ${page === 0 ? "disabled" : ""} aria-label="Newer orders">‹ Newer</button>
      <span>${page * PER_PAGE + 1}–${page * PER_PAGE + shown.length} of ${list.length}</span>
      <button class="mini" id="pgnext" ${page >= pages - 1 ? "disabled" : ""} aria-label="Older orders">Older ›</button></div>` : ""}
    ${refLine()}
    <p class="foot">Tagbook by Ordiventa · version ${String(window.TB_BUILD || "").slice(4, 12)} · <a href="/privacy">Privacy policy</a></p>`;
  const toTop = () => { const t = $("#q"), sc = mainScroll(); if (t) sc.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top) + sc.scrollTop - 12) }); };
  if ($("#pgprev")) $("#pgprev").onclick = () => { page--; renderOrders(); toTop(); };
  if ($("#pgnext")) $("#pgnext").onclick = () => { page++; renderOrders(); toTop(); };
  $("#q").oninput = e => { query = e.target.value; page = 0; const p = e.target.selectionStart; renderOrders(); const q = $("#q"); q.focus(); q.setSelectionRange(p, p); };
  view.querySelectorAll(".chip").forEach(c => c.onclick = () => { filter = c.dataset.f; page = 0; renderOrders(); });
  view.querySelectorAll("[data-go]").forEach(c => c.onclick = () => { filter = c.dataset.go; page = 0; renderOrders(); });
  view.querySelectorAll(".order").forEach(b => b.onclick = () => go("order-" + b.dataset.no));
  wirePlanBanner(view); wireInstallCard(); wireSetup(); wireRefLine();
  if ($("#pushon")) $("#pushon").onclick = async () => { await enablePush(); renderOrders(); };
  if ($("#pushlater")) $("#pushlater").onclick = () => { try { localStorage.setItem("tb-push-later", "1"); } catch (_) { } renderOrders(); };
  const s = $("#seen"); if (s) s.onclick = () => {
    const ids = fresh.map(o => o.id); fresh.forEach(o => o.notified = true); filter = "new"; renderOrders();
    sb.from("orders").update({ notified: true }).in("id", ids).then(({ error }) => { if (error) { toast(failMsg(error)); refresh(); } });
  };
}

/* ---------- Log clothes ---------- */
let d;
function reset() { d = { method: null, cust: null, q: "", newMode: false, phone: "", found: undefined, name: "", hasMark: null, mark: "", branch: (liveBranches()[0] || {}).id || null, greet: "", greetOther: false, svc: "wi", items: [], express: false, pickup: false, askSpecial: false, specialName: "", specialPrice: 0, paid: 0, saving: false }; }
reset();
const markTaken = m => customers.find(c => c.mark === m);
function suggest(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean); const tries = [];
  if (parts[0]) tries.push(parts[0].slice(0, 2));
  if (parts[0] && parts[1]) tries.push(parts[0][0] + parts[1][0]);
  if (parts[0]) tries.push(parts[0][0] + (parts[0][2] || "X"));
  for (const t of tries) { const m = t.toUpperCase().replace(/[^A-Z]/g, ""); if (m.length === 2 && !markTaken(m)) return m; }
  const base = (tries[0] || "XX").toUpperCase().replace(/[^A-Z]/g, "") || "XX"; let n = 2; while (markTaken(base + n)) n++; return base + n;
}
// Most recent customers first, from the orders already loaded
function recentCustomers(n) {
  const seen = new Set(), out = [];
  for (const o of [...orders].sort((a, b) => b.no - a.no)) { if (seen.has(o.cid)) continue; seen.add(o.cid); const c = customers.find(x => x.id === o.cid); if (c) out.push(c); if (out.length >= n) break; }
  return out;
}
function searchCustomers(q) {
  const t = q.trim().toLowerCase(), dg = digits(q);
  if (!t) return [];
  const score = c => {
    if (c.mark.toLowerCase() === t) return 0;
    if (own() && dg.length >= 4 && c.phone.includes(dg)) return 1;
    const n = c.name.toLowerCase();
    if (n.startsWith(t) || n.split(/\s+/).some(w => w.startsWith(t))) return 2;
    if (n.includes(t)) return 3;
    if (c.mark.toLowerCase().startsWith(t)) return 4;
    return 9;
  };
  return customers.map(c => [score(c), c]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 8).map(([, c]) => c);
}
let lookupFor = "";
async function lookup(phone) {
  lookupFor = phone; d.found = "loading";
  const { data, error } = await sb.rpc("find_customer", { p_phone: phone });
  if (lookupFor !== phone || d.phone !== phone) return;
  d.found = error ? undefined : (data && data[0]) || null;
  if (error) toast(failMsg(error));
  if (tab === "new") renderNew();
}
const custRow = c => `<button class="crow" data-pick="${c.id}"><span class="mark">${esc(c.mark)}</span><span class="cn"><b>${esc(c.name)}</b>${own() && c.phone ? `<small>${fmtPhone(c.phone)}</small>` : ""}</span></button>`;
function customerBlock() {
  if (d.cust) return `<div class="cpicked"><span class="mark">${esc(d.cust.mark)}</span><span class="cn"><b>${esc(d.cust.name)}</b><small>Regular customer. Write <b>${esc(d.cust.mark)}</b> inside every cloth.</small></span><button class="mini" id="cchange">Change</button></div>`;
  if (!d.newMode) {
    const res = searchCustomers(d.q), recent = d.q ? [] : recentCustomers(5);
    const dg = digits(d.q), phoneLike = /^0\d{10}$/.test(dg) && dg === d.q.replace(/\s/g, "");
    return `<input id="cq" class="search" style="margin:0" placeholder="${own() ? "Search name, mark (BO) or phone" : "Search name or mark (BO)"}" value="${esc(d.q)}" autocomplete="off" aria-label="Find customer">
      ${res.length ? `<div class="clist">${res.map(custRow).join("")}</div>` : ""}
      ${d.q && !res.length ? `<p class="hint">${phoneLike ? "Checking this number…" : `No customer called “${esc(d.q)}”.`}</p>` : ""}
      ${recent.length ? `<p class="clabel">Recent customers</p><div class="clist">${recent.map(custRow).join("")}</div>` : ""}
      <button class="btn btn-ghost" id="cnew">+ New customer</button>`;
  }
  // new customer: phone first (it might still be someone we know), then name and mark
  const existing = d.phone.length === 11 && d.found && d.found !== "loading" ? d.found : null;
  let b = `<div class="newc"><div class="row" style="justify-content:space-between;align-items:center"><b>New customer</b><button class="mini" id="cback">Back to search</button></div>
    <label for="ph">Phone number</label><input id="ph" type="text" inputmode="tel" placeholder="0803 412 7790" value="${d.phone}" autocomplete="off">`;
  if (d.phone.length === 11 && d.found === "loading") b += `<p class="hint">Checking this number…</p>`;
  else if (existing) b += `<div class="found">This number is already a customer: <b>${esc(existing.name)}</b>, mark <b>${esc(existing.mark)}</b>. <button class="mini" id="cuse" style="margin-left:6px">Use</button></div>`;
  else if (d.phone.length === 11 && d.found === null) {
    const clash = d.hasMark === "yes" && d.mark && markTaken(d.mark);
    b += `<label for="nm">Customer name</label><input id="nm" placeholder="e.g. Bola Ogun" value="${esc(d.name)}" autocomplete="off">
      ${own() ? `<label>How do you greet them in messages?</label>${greetChips(d.greet, "data-gr", d.greetOther)}
      <p class="gprev" id="gprev">Messages will start: <b>${d.greet ? `${hello({ greet: d.greet })},` : d.greetOther ? "Hello …," : `Hello ${esc((d.name.trim() || "Bola").split(" ")[0])},`}</b></p>` : ""}
      <label>Does this customer already have a mark on their clothes?</label>
      <div class="chips" style="margin:0"><button class="chip" data-hm="yes" aria-pressed="${d.hasMark === "yes"}">Yes, use it</button><button class="chip" data-hm="no" aria-pressed="${d.hasMark === "no"}">No, give one</button></div>
      ${d.hasMark === "yes" ? `<label for="mk">Their mark</label><input id="mk" placeholder="e.g. BL" value="${esc(d.mark)}" autocomplete="off">
        ${clash ? `<div class="bad">${esc(clash.mark)} is already used by ${esc(clash.name)}. Use a different mark so their clothes don't mix.</div>` : ""}` : ""}
      ${d.hasMark === "no" && d.name.trim() ? `<div class="found">New mark: <b>${suggest(d.name)}</b>. Write this inside every cloth.</div>` : ""}`;
  } else b += `<p class="hint">Ask the customer for their number. Next time, you'll find them by name.</p>`;
  return b + `</div>`;
}
function renderNew() {
  if (planEnded()) {
    view.innerHTML = `${backBtn("Orders")}<h2>Log clothes</h2>${planBanner()}<p class="hint">You can still open every order you already logged. ${own() ? "Once you pay, logging opens again straight away." : "Logging opens again as soon as the owner pays."}</p>`;
    wireBack(view); wirePlanBanner(view); return;
  }
  if (!d.branch || !liveBranches().some(b => b.id === d.branch)) d.branch = (liveBranches()[0] || {}).id || null;
  const count = d.items.reduce((s, it) => s + it.qty, 0);
  const pickable = PRICES.filter(p => !p.hidden && (p.custom || (p.services || []).includes(d.svc)));
  view.innerHTML = `
    ${backBtn("Orders")}
    <h2>Log clothes</h2>
    <label>Customer</label>
    ${customerBlock()}
    ${liveBranches().length > 1 ? `<label for="br">Dropped at</label>
    <select id="br">${liveBranches().map(b => `<option value="${b.id}" ${d.branch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : ""}
    <label>Service</label>
    <div class="chips" style="margin:0">${Object.entries(SERVICES).map(([s, l]) => `<button class="chip" data-svc="${s}" aria-pressed="${d.svc === s}">${l}</button>`).join("")}</div>
    <label>Tap to add clothes</label>
    <div class="picker">${pickable.map(p => `<button data-add="${p.id}">${esc(p.name)}${p.custom ? "<small>Wedding gown, curtain</small>" : ""}</button>`).join("")}</div>
    ${d.askSpecial ? `<div class="check" style="margin-top:8px"><label for="sp" style="margin-top:0">What is the special item?</label>
      <input id="sp" placeholder="e.g. Wedding gown" value="${esc(d.specialName)}" autocomplete="off">
      ${own() ? `<label for="spp">Price for ${SERVICES[d.svc].toLowerCase()} (₦)</label><input id="spp" ${moneyAttrs} placeholder="e.g. 5000" value="${d.specialPrice || ""}">
      <p class="hint">With a price, it's also added to your price list, so next time just tap it. Leave it empty to set the price on the bill.</p>` : ""}
      <div class="row"><button class="btn btn-ghost" id="spc">Cancel</button><button class="btn btn-primary" id="spa" ${d.specialName.trim() ? "" : "disabled"}>Add item</button></div></div>` : ""}
    <div class="items">${d.items.map((it, i) => `
      <div class="item"><span>${esc(pname(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}</small></span>
      <div class="qty"><button data-dec="${i}" aria-label="Remove one">−</button><b style="min-width:22px;text-align:center">${it.qty}</b><button data-inc="${i}" aria-label="Add one">+</button></div></div>`).join("")}</div>
    <label class="toggle"><span>Express delivery</span><input type="checkbox" id="ex" ${d.express ? "checked" : ""}></label>
    <label class="toggle"><span>Pickup and delivery</span><input type="checkbox" id="pk" ${d.pickup ? "checked" : ""}></label>
    <label for="pd">Paid now (₦)</label><input id="pd" ${moneyAttrs} placeholder="0" value="${d.paid || ""}">
    ${d.paid ? "" : `<p class="hint">Leave empty if the customer will pay later.</p>`}
    <div class="lines"><div><b>Clothes logged</b><b>${count}</b></div></div>
    <p class="hint">${own() ? "After saving, you can send the list of clothes to the customer straight away." : "Saving sends this order to the owner's phone. The owner sends the list of clothes to the customer."}</p>
    <p class="bad" id="saveerr" role="alert" hidden></p>
    <button class="btn btn-primary" id="save" ${d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : own() ? "Save order" : "Save and send to owner"}</button>
    <button class="btn btn-ghost" id="clr">Clear</button>`;
  wireBack(view);
  const keep = (id, fn) => { const el = $(id); if (!el) return; el.oninput = e => { fn(e.target.value); const p = e.target.selectionStart; renderNew(); const n = $(id); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (_) { } } }; };
  keep("#cq", v => {
    d.q = v.slice(0, 40);
    const dg = digits(v);
    // a full phone number that isn't in the list (staff can't see numbers): ask the database
    if (/^0\d{10}$/.test(dg) && !searchCustomers(v).length) {
      lookupFor = dg;
      sb.rpc("find_customer", { p_phone: dg }).then(({ data }) => {
        if (lookupFor !== dg || digits(d.q) !== dg || tab !== "new") return;
        const c = data && data[0];
        if (c) { d.cust = { id: c.id, name: c.name, mark: c.mark }; d.q = ""; }
        else { d.newMode = true; d.phone = dg; d.found = null; d.q = ""; }
        renderNew();
      });
    }
  });
  view.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const c = customers.find(x => x.id === b.dataset.pick); d.cust = { id: c.id, name: c.name, mark: c.mark }; d.q = ""; renderNew(); });
  if ($("#cchange")) $("#cchange").onclick = () => { d.cust = null; renderNew(); const q = $("#cq"); if (q) q.focus(); };
  if ($("#cnew")) $("#cnew").onclick = () => { d.newMode = true; const dg = digits(d.q); if (/^0\d{10}$/.test(dg)) { d.phone = dg; lookup(dg); } d.q = ""; renderNew(); const p = $("#ph"); if (p) p.focus(); };
  if ($("#cback")) $("#cback").onclick = () => { d.newMode = false; d.phone = ""; d.found = undefined; d.name = ""; d.hasMark = null; d.mark = ""; renderNew(); };
  if ($("#cuse")) $("#cuse").onclick = () => { const f = d.found; d.cust = { id: f.id, name: f.name, mark: f.mark }; d.newMode = false; d.phone = ""; d.found = undefined; renderNew(); };
  keep("#ph", v => { const nv = digits(v).slice(0, 11); if (nv !== d.phone) { d.phone = nv; d.found = undefined; if (nv.length === 11) lookup(nv); } });
  keep("#nm", v => d.name = v.replace(/[^a-z\s'-]/gi, ""));
  view.querySelectorAll("[data-gr]").forEach(b => b.onclick = () => { const v = b.dataset.gr; d.greetOther = v === "__other"; d.greet = d.greetOther ? "" : v; renderNew(); if (d.greetOther) { const t = $("#data-gr-txt"); if (t) t.focus(); } });
  const gt = $("#data-gr-txt"); if (gt) gt.oninput = e => { d.greet = cleanGreet(e.target.value); const pv = $("#gprev b"); if (pv) pv.textContent = d.greet ? `Hello ${d.greet},` : "Hello …,"; };
  keep("#mk", v => d.mark = v.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase());
  keep("#sp", v => d.specialName = v);
  const pd = $("#pd"); if (pd) pd.oninput = e => { const c = digits(e.target.value); const had = !!d.paid; d.paid = num(c); if (e.target.value !== c) e.target.value = c; if (had !== !!d.paid) { const p = e.target.selectionStart; renderNew(); const n = $("#pd"); n.focus(); try { n.setSelectionRange(p, p); } catch (_) { } } };
  view.querySelectorAll("[data-dm]").forEach(b => b.onclick = () => { d.method = b.dataset.dm; renderNew(); });
  if ($("#br")) $("#br").onchange = e => d.branch = e.target.value;
  $("#ex").onchange = e => { d.express = e.target.checked; };
  $("#pk").onchange = e => { d.pickup = e.target.checked; };
  view.querySelectorAll("[data-hm]").forEach(b => b.onclick = () => { d.hasMark = b.dataset.hm; renderNew(); });
  view.querySelectorAll("[data-svc]").forEach(b => b.onclick = () => { d.svc = b.dataset.svc; renderNew(); });
  view.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    if ((item(id) || {}).custom) { d.askSpecial = id; d.specialName = ""; d.specialPrice = 0; renderNew(); $("#sp").focus(); return; }
    const f = d.items.find(i => i.id === id && i.svc === d.svc && !i.label); f ? f.qty++ : d.items.push({ id, svc: d.svc, qty: 1 }); renderNew();
  });
  if ($("#spc")) $("#spc").onclick = () => { d.askSpecial = false; renderNew(); };
  const spp = $("#spp"); if (spp) spp.oninput = e => { const c = digits(e.target.value); d.specialPrice = num(c); if (e.target.value !== c) e.target.value = c; };
  if ($("#spa")) $("#spa").onclick = async () => {
    const name = tidy(d.specialName).slice(0, 40), price = own() ? d.specialPrice : 0;
    if (!price) { d.items.push({ id: d.askSpecial, svc: d.svc, qty: 1, label: name }); d.askSpecial = false; renderNew(); return; }
    // Owner gave a price: it becomes a normal item on the price list, so next time it's one tap.
    const btn = $("#spa"); btn.disabled = true; btn.textContent = "Adding…";
    const id = await toPriceList(name, d.svc, price);
    if (!id) { btn.disabled = false; btn.textContent = "Add item"; return; }
    try { await load(); } catch (_) { }
    d.items.push({ id, svc: d.svc, qty: 1 }); d.askSpecial = false; d.specialPrice = 0;
    toast(`${name} added to your price list at ${naira(price)}`); renderNew();
  };
  view.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => { d.items[+b.dataset.inc].qty++; renderNew(); });
  view.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const i = +b.dataset.dec; d.items[i].qty--; if (!d.items[i].qty) d.items.splice(i, 1); renderNew(); });
  $("#clr").onclick = () => { reset(); renderNew(); };
  $("#save").onclick = async () => {
    if (d.saving) return;
    const isNew = !d.cust && d.newMode && d.found === null;
    const clash = isNew && d.hasMark === "yes" && d.mark && markTaken(d.mark);
    const err = !d.cust && !d.newMode ? "Choose the customer first. Search their name, or tap “+ New customer”."
      : !d.cust && !d.phone ? "Enter the customer's phone number."
      : !d.cust && (d.phone.length !== 11 || d.phone[0] !== "0") ? "The phone number is not correct. It must be 11 digits and start with 0, like 0803 412 7790."
      : !d.cust && (d.found === undefined || d.found === "loading") ? "Still checking this number. Try again in a moment."
      : !d.cust && d.found ? `This number belongs to ${d.found.name}. Tap “Use” to log for them.`
      : (isNew && !d.name.trim()) ? "Enter the customer's name."
      : (isNew && !d.hasMark) ? "Choose if the customer already has a mark on their clothes."
      : (isNew && d.hasMark === "yes" && !d.mark) ? "Type the customer's mark."
      : clash ? `${clash.mark} is already used by ${clash.name}. Use a different mark.`
      : !d.items.length ? "Add at least one cloth to the order." : "";
    if (err) { showErr(err); if (!d.cust && d.newMode && d.found === undefined && d.phone.length === 11) lookup(d.phone); return; }
    const mark = d.cust ? d.cust.mark : (d.hasMark === "yes" ? d.mark : suggest(d.name));
    const base = { branch_id: d.branch, items: d.items.map(i => ({ ...i })), express: d.express, pickup: d.pickup, paid: d.paid || 0, method: d.method };
    const p = d.cust ? { ...base, customer_id: d.cust.id } : { ...base, phone: d.phone, name: d.name.trim(), mark, ...(own() ? { greet: d.greet || null } : {}) };
    d.saving = true; renderNew();
    const { data, error } = await sb.rpc("log_order", { p });
    d.saving = false;
    if (error) {
      const m = error.message || "";
      if (/MARK_TAKEN/.test(m)) { showErr(`${mark} is already used by ${m.split("MARK_TAKEN:")[1] || "another customer"}. Use a different mark.`); refresh(); }
      else showErr(failMsg(error));
      renderNew(); return;
    }
    reset(); filter = "all";
    try { await load(); } catch (_) { }
    if (own()) { go("order-" + data.no); toast(`Saved. Write ${data.mark} inside every cloth.`); }
    else { go("orders"); toast(`Saved. Write ${data.mark} inside every cloth. The owner has been told.`); }
  };
  function showErr(err) { const e = $("#saveerr"); e.textContent = err; e.hidden = false; toast(err); e.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

/* Names typed or pasted in: drop invisible characters WhatsApp copies along, squeeze spaces. */
const tidy = v => String(v || "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
const NAME_MAX = 50;

/* ---------- Messages ---------- */
function billLines(o) {
  const k = calc(o);
  return o.items.map((it, i) => `${it.qty} x ${pname(it)} ${naira(unitPrice(o, it, i) * it.qty)}`).join("\n")
    + (k.exp ? `\nExpress delivery: ${naira(k.exp)}` : "") + (o.m.delivery ? `\nPickup/delivery: ${naira(o.m.delivery)}` : "") + (o.m.discount ? `\nDiscount: -${naira(o.m.discount)}` : "");
}
function message(o, type) {
  const c = cust(o.cid), k = calc(o), hi = hello(c);
  if (type === "list") {
    const list = o.items.map(it => `${it.qty} x ${pname(it)} (${SERVICES[it.svc]})`).join("\n");
    return `${hi}, ${shopName()} has received your clothes.\nOrder #${o.no} · Mark ${c.mark} · ${k.count} items\n\n${list}${o.m.paid ? `\n\nPayment received: ${naira(o.m.paid)}` : ""}\n\nWe will let you know when your clothes are ready, and send your bill with it.\n\n_Sent with Tagbook_`;
  }
  const where = liveBranches().length > 1 && branchName(o.branch) ? `\nCollect at: ${branchName(o.branch)}` : "";
  if (type === "ready") return `${hi}, your clothes are ready at ${shopName()}.${where}\n\nINVOICE INV-${o.no}\nDropped: ${fmtDay(o.at)}\nDate: ${fmtDay(Date.now())}\nCustomer: ${c.greet ? "" : `${c.name} `}(Mark ${c.mark})\n${k.count} items\n\n${billLines(o)}\n\nTotal: ${naira(o.m.total)}${o.m.paid ? `\nPaid: ${naira(o.m.paid)}` : ""}${owed(o) ? `\nAmount to pay: ${naira(owed(o))}${payTo()}` : "\nFully paid. Thank you."}\n\n_Sent with Tagbook_`;
  return `${hi}, a reminder from ${shopName()}: invoice INV-${o.no} (clothes dropped ${fmtDay(o.at)}) has ${naira(owed(o))} still to pay.${payTo()}\n\nThank you.\n_Sent with Tagbook_`;
}
const waFmt = t => esc(t).replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<i>$2</i>").replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<b>$2</b>");
const wa = (o, t) => { const p = cust(o.cid).phone; return (p ? "https://wa.me/234" + p.slice(1) : "https://wa.me/") + "?text=" + encodeURIComponent(t); };
const MSG_NAMES = { list: "list of clothes", ready: "clothes ready, with invoice", owe: "payment reminder" };
function waBlock(o, type, markable) {
  const c = cust(o.cid);
  // Staff don't decide how a customer is greeted, so the owner answers once before the first message goes out.
  if (own() && c.id && !c.greet_asked) return `<div class="gask"><p class="wa-label" style="margin-top:0;color:var(--fg);font-size:15px">Before you send: how do you greet ${esc(c.name)} in messages?</p>
    ${greetChips("-", "data-og", ogOther)}${ogOther ? `<button class="btn btn-primary" id="og-save" style="margin-top:8px">Save</button>` : ""}<p class="hint">Asked once per customer. You can change it later under More, Edit customer.</p></div>`;
  return `<p class="wa-label">WhatsApp to customer: ${MSG_NAMES[type]}</p>
    <div class="wa" id="wamsg-${type}">${waFmt(message(o, type))}</div>
    <a class="btn btn-primary" href="${wa(o, message(o, type))}" target="_blank" rel="noopener">Open in WhatsApp</a>
    <div class="row"><button class="btn btn-ghost" data-copy="${type}">Copy</button>${markable ? `<button class="btn btn-ghost" data-done="${type}">I've sent it</button>` : ""}</div>
    ${(type === "ready" || type === "owe") && owed(o) && !hasBank() ? `<p class="bad">Add your bank account in Settings so the invoice tells the customer where to pay.</p>` : ""}
    ${markable ? `<p class="hint">After sending, tap “I've sent it”. Until then this message stays here.</p>` : ""}`;
}
const sentLine = (o, type, text) => o.again[type] ? waBlock(o, type, false) : `<div class="sent"><span>${text}</span><button data-again="${type}">Send again</button></div>`;

/* ---------- Payments ---------- */
const METHODS = [["cash", "Cash"], ["transfer", "Transfer"], ["pos", "POS"]];
let payMethod = null;
const methodChips = (cur, attr) => `<div class="chips" style="margin:8px 0 0" role="group" aria-label="How did they pay?">${METHODS.map(([k, l]) => `<button class="chip" data-${attr}="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;
const payForm = (ph, full) => `${full ? `<button class="btn btn-primary" id="ppall">${full === true ? "Paid in full" : `Paid in full · ${naira(full)}`}</button><p class="hint" style="margin:6px 0 2px">Paid only part? Type the amount below.</p>` : ""}<label for="pay">Amount received (₦)</label><input id="pay" ${moneyAttrs} placeholder="${ph}"><button class="btn ${full ? "btn-ghost" : "btn-primary"}" id="pp">Record payment</button>`;
/* ---------- Printed receipt (supermarket-style receipt printers, 80mm or 58mm) ---------- */
let paper = (() => { try { return localStorage.getItem("tb-paper") === "58" ? "58" : "80"; } catch (_) { return "80"; } })();
function receiptHtml(o) {
  const c = cust(o.cid), k = calc(o), priced = own() && o.billed;
  const row = (l, r, cls) => `<div class="rr${cls ? " " + cls : ""}"><span>${l}</span><span>${r}</span></div>`;
  const total = o.m.total || k.total, due = owed(o);
  const bank = priced && due && hasBank() ? (() => { const b = sPriv(); return `<div class="rsep"></div><div class="rc">Pay by transfer to<br><b>${esc(b.bank_name.trim())}</b><br><b>${esc(b.acct_no)}</b><br>${esc(b.acct_name.trim())}</div>`; })() : "";
  return `<div class="rhead"><b>${esc(shop.name)}</b>${liveBranches().length > 1 ? `<span>${esc(branchName(o.branch))}</span>` : ""}</div>
    <div class="rsep"></div>
    ${row("Receipt no.", "#" + o.no)}${row("Customer", esc(c.name))}${row("Tag mark", esc(c.mark))}${row("Dropped", fmtDay(o.at))}${row("Printed", fmtDay(Date.now()))}
    <div class="rsep"></div>
    ${o.items.map((it, i) => `<div class="ri"><div class="rr"><span>${it.qty} × ${esc(pname(it))}</span><span>${priced ? naira(unitPrice(o, it, i) * it.qty) : ""}</span></div><small>${SERVICES[it.svc]}</small></div>`).join("")}
    <div class="rsep"></div>
    ${priced ? `${k.exp ? row("Express delivery", naira(k.exp)) : ""}${o.m.delivery ? row("Pickup / delivery", naira(o.m.delivery)) : ""}${o.m.discount ? row("Discount", "-" + naira(o.m.discount)) : ""}
      ${row("<b>TOTAL</b>", `<b>${naira(total)}</b>`, "rbig")}${row("Paid", naira(o.m.paid))}${row(due ? "<b>Balance</b>" : "Balance", due ? `<b>${naira(due)}</b>` : "Fully paid")}`
      : row("<b>Clothes</b>", `<b>${k.count}</b>`, "rbig") + `<div class="rc">${own() ? "Bill to follow when your clothes are ready." : "Keep this slip for pickup."}</div>`}
    ${bank}
    <div class="rsep"></div><div class="rc">Thank you for your patronage.</div>`;
}
function printReceipt(o) {
  let r = document.getElementById("receipt");
  if (!r) { r = document.createElement("div"); r.id = "receipt"; document.body.appendChild(r); }
  r.className = "p" + paper; r.innerHTML = receiptHtml(o);
  let st = document.getElementById("receipt-page");
  if (!st) { st = document.createElement("style"); st.id = "receipt-page"; document.head.appendChild(st); }
  st.textContent = `@page{size:${paper}mm auto;margin:0}`;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
}
const printBlock = o => `<div class="prow"><button class="btn btn-ghost" id="prt">${own() && o.billed ? "Print receipt" : "Print drop-off slip"}</button>
  <div class="aseg" aria-label="Receipt paper width"><button data-paper="80" aria-pressed="${paper === "80"}">80mm</button><button data-paper="58" aria-pressed="${paper === "58"}">58mm</button></div></div>`;
const payList = o => (o.m.payments || []).length ? `<div class="paylist">${o.m.payments.map(p => `<div><span>${naira(p.amt)}</span><span>${p.by ? esc(p.by) + " · " : ""}${fmtDay(p.at)}</span></div>`).join("")}</div>` : "";

/* ---------- Owner only: edit clothes, edit customer, cancel an order (kept on record) ---------- */
let oFor = null, oMode = null, oMenu = false, oDraft = null, fxAdd = false, fxGreet = "", fxOther = false, ogOther = false;
const canFix = o => own() && !o.cancelled && o.status !== "picked";
const orderTop = o => `<div class="topbar otop"><button class="back" data-back>← All orders</button>${canFix(o) ? `<button class="omore" id="omore" aria-expanded="${oMenu}" aria-haspopup="menu">More ⋯</button>` : ""}
  ${oMenu && canFix(o) ? `<div class="omenu" role="menu"><button role="menuitem" data-om="items">Edit clothes</button><button role="menuitem" data-om="cust">Edit customer</button><button role="menuitem" class="red" data-om="cancel">Cancel order</button></div>` : ""}</div>`;
function wireFix(root, o) {
  const m = root.querySelector("#omore"); if (m) m.onclick = () => { oMenu = !oMenu; openOrder(o.no); };
  root.querySelectorAll("[data-om]").forEach(b => b.onclick = () => {
    oMenu = false; oMode = b.dataset.om; fxAdd = false; fxGreet = cust(o.cid).greet || ""; fxOther = false;
    if (oMode === "items") oDraft = o.items.map((it, i) => ({ ...it, from: i }));
    openOrder(o.no);
  });
}
// Turn the edited list back into items + the prices already agreed (kept for clothes that stayed).
function draftToOrder(o, d) {
  const kept = d.filter(x => x.qty > 0), unit = [], custom = {}; let missing = null;
  kept.forEach((x, i) => {
    const p = item(x.id) || {};
    if (p.custom) { const v = x.from != null ? +o.m.custom[x.from] || 0 : 0; if (v) custom[i] = v; else missing = missing || x; unit.push(null); }
    else unit.push(x.from != null && o.m.unit && o.m.unit[x.from] != null ? o.m.unit[x.from] : ((p.p || {})[x.svc] || 0));
  });
  return { items: kept.map(({ from, ...it }) => it), unit, custom, missing };
}
const draftPrice = (o, x) => { const p = item(x.id) || {}; if (p.custom) return x.from != null ? +o.m.custom[x.from] || 0 : 0; return x.from != null && o.m.unit && o.m.unit[x.from] != null ? o.m.unit[x.from] : ((p.p || {})[x.svc] || 0); };
function fixView(o) {
  const c = cust(o.cid), sh = $("#sheet"), first = c.name.split(" ")[0];
  const head = t => `<div class="topbar"><button class="back" id="fxback">← ${o.cancelled ? "All orders" : "Back to order"}</button></div><h2 class="ptitle" style="margin:8px 0 10px">${t}</h2>`;
  let body = "";
  if (o.cancelled) {
    body = `${head(`Order #${o.no}`)}
      <div class="dhead"><div class="mark">${esc(c.mark)}</div><div><b>${esc(c.name)}</b><span>${own() && c.phone ? fmtPhone(c.phone) + " · " : ""}dropped ${fmtDay(o.at)}</span></div></div>
      <div class="lines">${o.items.map((it, i) => `<div><span>${it.qty} × ${esc(pname(it))}</span><span>${own() ? naira(unitPrice(o, it, i) * it.qty) : ""}</span></div>`).join("")}</div>
      <p class="fxnote">Cancelled${o.cancelled_by ? ` by ${esc(o.cancelled_by)}` : ""} on ${fmtDay(o.cancelled)}. It is not counted in your orders or totals.${o.m.paid ? ` The ${naira(o.m.paid)} paid on it still shows in your money received.` : ""}</p>
      ${own() ? `<button class="btn btn-primary" id="fxrestore">Bring this order back</button>` : ""}`;
  } else if (oMode === "items") {
    const d = oDraft, n = draftToOrder(o, d);
    const tmp = { ...o, items: n.items, m: { ...o.m, unit: o.billed ? n.unit : null, custom: n.custom, express_amt: expManual() ? o.m.express_amt : 0 }, billed: false };
    const now = calc(o).total, next = n.items.length ? calc(tmp).total : 0;
    const changed = JSON.stringify(n.items) !== JSON.stringify(o.items);
    const pick = PRICES.filter(p => !p.hidden), addIt = item(fxAdd && fxAdd.id) || pick[0] || {};
    const svcs = (addIt.services && addIt.services.length ? addIt.services : Object.keys(SERVICES));
    body = `${head(`Edit clothes · #${o.no}`)}
      <div class="fxlist">${d.map((x, i) => x.qty ? `<div class="fxit"><div><b>${esc(pname(x))}</b><span>${SERVICES[x.svc] || ""} · ${(item(x.id) || {}).custom ? "price set on the bill" : naira(draftPrice(o, x)) + " each"}</span></div>
        <div class="qty"><button data-qm="${i}" aria-label="One less">−</button><b>${x.qty}</b><button data-qp="${i}" aria-label="One more">+</button></div></div>` : "").join("") || `<p class="hint">No clothes left. Add at least one, or cancel the order instead.</p>`}</div>
      ${fxAdd ? `<div class="check fxadd"><label for="fxi" style="margin-top:0">Item</label><select id="fxi">${pick.map(p => `<option value="${p.id}" ${p.id === addIt.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          ${addIt.custom ? `<label for="fxl">What is it?</label><input id="fxl" placeholder="e.g. Wedding gown" value="${esc(fxAdd.label || "")}" autocomplete="off">` : ""}
          <label for="fxs">Service</label><select id="fxs">${svcs.map(k => `<option value="${k}" ${k === fxAdd.svc ? "selected" : ""}>${SERVICES[k]}</option>`).join("")}</select>
          <div class="row"><button class="btn btn-ghost" id="fxaddx">Close</button><button class="btn btn-primary" id="fxaddgo">Add</button></div></div>`
        : `<button class="fxaddbtn" id="fxaddopen">+ Add another item</button>`}
      <div class="lines" style="margin-top:12px"><div><span>${n.items.reduce((s2, it) => s2 + it.qty, 0)} items</span><span></span></div><div><b>${changed ? "New total" : "Total"}</b><b>${naira(next)}</b></div></div>
      ${changed && now !== next ? `<p class="hint">Was ${naira(now)}.${o.m.paid > next ? ` The customer has already paid ${naira(o.m.paid)}, more than the new total.` : ""}</p>` : ""}
      ${n.missing ? `<p class="hint">Set the price for ${esc(pname(n.missing))} on the bill after saving.</p>` : ""}
      ${changed && (o.list_sent || o.status === "told") ? `<p class="fxnote">You already sent ${esc(first)} the ${o.status === "told" ? "bill" : "list of clothes"}. After saving, Tagbook will show the updated one so you can send it again.</p>` : ""}
      <div class="row"><button class="btn btn-ghost" id="fxundo" ${changed ? "" : "disabled"}>Undo changes</button><button class="btn btn-primary" id="fxsave" ${changed && n.items.length ? "" : "disabled"}>Save</button></div>`;
  } else if (oMode === "cust") {
    const others = orders.filter(x => x.cid === o.cid).length;
    body = `${head("Edit customer")}
      <p class="hint" style="margin-top:0">This changes the name and phone on ${others > 1 ? `all ${others} of ${esc(first)}'s orders` : `${esc(first)}'s orders`}.</p>
      <label for="fxn">Name</label><input id="fxn" value="${esc(c.name)}" autocomplete="off" maxlength="60">
      <label for="fxp">Phone</label><input id="fxp" type="text" inputmode="tel" value="${esc(c.phone)}" autocomplete="off">
      <label>How do you greet them in messages?</label>${greetChips(fxGreet, "data-fg", fxOther)}
      <p class="fxnote">Their mark stays <b>${esc(c.mark)}</b>, because it is already written inside their clothes.</p>
      <div class="row"><button class="btn btn-ghost" id="fxback2">Back</button><button class="btn btn-primary" id="fxcsave">Save</button></div>`;
  } else if (oMode === "cancel") {
    body = `${head(`Cancel order #${o.no}?`)}
      <p class="hint" style="margin-top:0">It leaves your order lists and totals. You can still find it under "Cancelled" and bring it back.</p>
      ${o.m.paid ? `<p class="fxnote warn">${naira(o.m.paid)} was already paid on this order. That payment stays on record. Refund the customer yourself if needed.</p>` : ""}
      <div class="row"><button class="btn btn-ghost" id="fxback2">Keep it</button><button class="btn btn-danger" id="fxcancel">Cancel order</button></div>`;
  }
  sh.innerHTML = `<div class="app">${body}</div>`; sh.hidden = false; sh.scrollTop = 0;
  const back = () => { if (o.cancelled) { go("orders"); return; } oMode = null; fxAdd = false; openOrder(o.no); };
  sh.querySelectorAll("#fxback,#fxback2").forEach(b => b.onclick = back);
  const rs = $("#fxrestore"); if (rs) rs.onclick = async () => {
    rs.disabled = true; const { error } = await sb.rpc("owner_cancel_order", { p_order: o.id, p_cancel: false });
    if (error) { toast(failMsg(error)); rs.disabled = false; return; }
    o.cancelled = 0; o.cancelled_by = ""; cancelledOrders = cancelledOrders.filter(x => x !== o); orders.push(o); orders.sort((a, b) => a.no - b.no);
    if (filter === "cx" && !cancelledOrders.length) filter = "all";
    toast(`Order #${o.no} is back`); oFor = null; openOrder(o.no); if (tab === "orders") renderOrders();
  };
  if (oMode === "items" && !o.cancelled) {
    sh.querySelectorAll("[data-qm]").forEach(b => b.onclick = () => { const x = oDraft[+b.dataset.qm]; x.qty = Math.max(0, x.qty - 1); fixView(o); });
    sh.querySelectorAll("[data-qp]").forEach(b => b.onclick = () => { oDraft[+b.dataset.qp].qty++; fixView(o); });
    const op = $("#fxaddopen"); if (op) op.onclick = () => { const p0 = PRICES.find(p => !p.hidden) || {}; fxAdd = { id: p0.id, svc: (p0.services || ["wi"])[0], label: "" }; fixView(o); };
    if ($("#fxi")) $("#fxi").onchange = e => { const p = item(e.target.value) || {}; fxAdd = { id: p.id, svc: (p.services || ["wi"]).includes(fxAdd.svc) ? fxAdd.svc : (p.services || ["wi"])[0], label: "" }; fixView(o); };
    if ($("#fxs")) $("#fxs").onchange = e => { fxAdd.svc = e.target.value; };
    if ($("#fxl")) $("#fxl").oninput = e => { fxAdd.label = e.target.value; };
    if ($("#fxaddx")) $("#fxaddx").onclick = () => { fxAdd = false; fixView(o); };
    if ($("#fxaddgo")) $("#fxaddgo").onclick = () => {
      const p = item(fxAdd.id) || {}, label = tidy(fxAdd.label || "").slice(0, 40);
      if (p.custom && !label) { toast("Type what the special item is"); return; }
      const same = !p.custom && oDraft.find(x => x.id === fxAdd.id && x.svc === fxAdd.svc);
      if (same) same.qty++; else oDraft.push({ id: fxAdd.id, svc: fxAdd.svc, qty: 1, ...(p.custom ? { label } : {}) });
      fxAdd = false; fixView(o);
    };
    if ($("#fxundo")) $("#fxundo").onclick = () => { oDraft = o.items.map((it, i) => ({ ...it, from: i })); fxAdd = false; fixView(o); };
    const sv = $("#fxsave"); if (sv) sv.onclick = async () => {
      const n = draftToOrder(o, oDraft); if (!n.items.length) return;
      sv.disabled = true; sv.textContent = "Saving…";
      const wasBilled = o.billed;
      o.items = n.items; o.checked = {}; o.checking = false; o.m.custom = n.custom;
      if (wasBilled) {
        o.m.unit = n.unit;
        if (n.missing) o.m.billed_at = null;
        else { if (!expManual()) o.m.express_amt = 0; const kk = calc({ ...o, billed: false }); o.m.express_amt = kk.exp; o.m.total = kk.total; }
      }
      const ok = await put("orders", { id: o.id }, { items: o.items, checked: {}, checking: false }) && await saveMoney(o);
      if (!ok) return;
      if (o.list_sent && o.status !== "told") o.again.list = true;
      if (o.status === "told" && o.billed) o.again.ready = true;
      oMode = null; oDraft = null; fxAdd = false;
      toast(n.missing ? `Clothes updated. Set the price for ${pname(n.missing)} and save the bill.` : o.again.list || o.again.ready ? "Clothes updated. Send the customer the updated message below." : "Clothes updated");
      openOrder(o.no); if (tab === "orders") renderOrders();
    };
  }
  sh.querySelectorAll("[data-fg]").forEach(b => b.onclick = () => { const n = $("#fxn").value, ph = $("#fxp").value; fxOther = b.dataset.fg === "__other"; fxGreet = fxOther ? "" : b.dataset.fg; fixView(o); $("#fxn").value = n; $("#fxp").value = ph; if (fxOther) $("#data-fg-txt").focus(); });
  if ($("#data-fg-txt")) $("#data-fg-txt").oninput = e => { fxGreet = cleanGreet(e.target.value); };
  const cs = $("#fxcsave"); if (cs) cs.onclick = async () => {
    const name = tidy($("#fxn").value), phone = digits($("#fxp").value);
    if (!name) { toast("Type the customer's name"); return; }
    if (fxOther && !fxGreet) { toast("Type how you greet them, or pick one"); return; }
    if (!/^0\d{10}$/.test(phone)) { toast("The phone number must be 11 digits and start with 0."); return; }
    cs.disabled = true; cs.textContent = "Saving…";
    const { data, error } = await sb.rpc("owner_edit_customer", { p_customer: o.cid, p_name: name, p_phone: phone });
    if (!error && ((fxGreet || "") !== (c.greet || "") || !c.greet_asked)) { const g = await sb.rpc("owner_set_greet", { p_customer: o.cid, p_greet: fxGreet || null }); if (g.error) { toast(failMsg(g.error)); cs.disabled = false; cs.textContent = "Save"; return; } }
    if (error) { const t = /PHONE_TAKEN:(.*)/.exec(error.message || ""); toast(t ? `That number already belongs to ${t[1]}.` : failMsg(error)); cs.disabled = false; cs.textContent = "Save"; return; }
    const cc = customers.find(x => x.id === o.cid); if (cc) { cc.name = data.name; cc.phone = data.phone; if ((fxGreet || "") !== (c.greet || "") || !c.greet_asked) { cc.greet = fxGreet || null; cc.greet_asked = true; } }
    oMode = null; toast("Customer updated"); openOrder(o.no); if (tab === "orders") renderOrders();
  };
  const cx = $("#fxcancel"); if (cx) cx.onclick = async () => {
    cx.disabled = true; cx.textContent = "Cancelling…";
    const { error } = await sb.rpc("owner_cancel_order", { p_order: o.id, p_cancel: true });
    if (error) { toast(/PICKED_UP/.test(error.message || "") ? "This order was already picked up." : failMsg(error)); cx.disabled = false; cx.textContent = "Cancel order"; return; }
    o.cancelled = Date.now(); o.cancelled_by = (me && me.name) || ""; orders = orders.filter(x => x !== o); cancelledOrders.push(o);
    oMode = null; oFor = null; toast(`Order #${o.no} cancelled. You can find it under "Cancelled".`); go("orders");
  };
}

/* ---------- Order detail ---------- */
function openOrder(no) {
  const o = orders.find(x => x.no === no) || cancelledOrders.find(x => x.no === no); if (!o) { go("orders"); return; }
  if (oFor !== no) { oFor = no; oMode = null; oMenu = false; oDraft = null; fxAdd = false; ogOther = false; }
  if (o.cancelled || oMode) { fixView(o); return; }
  const c = cust(o.cid), k = calc(o), sh = $("#sheet");
  if (own() && !o.notified) { o.notified = true; put("orders", { id: o.id }, { notified: true }); }
  const idx = STEPS.findIndex(s => s[0] === o.status);
  const allChecked = o.items.every((_, i) => o.checked[i]);
  const canEditBill = own() && o.status !== "picked";
  let html = "";
  const checkHtml = () => {
    if (!(o.status === "new" || o.status === "listed")) return "";
    return o.checking ? `<div class="check"><p><b>Check before bagging.</b> Gather every cloth with mark <b>${esc(c.mark)}</b> inside, and tick each one. If something is missing, you find out now, not when the customer comes.</p>
        ${o.items.map((it, i) => `<label class="ck"><input type="checkbox" data-ck="${i}" ${o.checked[i] ? "checked" : ""}> ${it.qty} × ${esc(pname(it))}</label>`).join("")}
        <button class="btn btn-primary" id="rd" ${allChecked ? "" : "disabled"}>All here. Mark ready</button></div>`
      : `<button class="btn ${own() ? "btn-ghost" : "btn-primary"}" id="washed" style="margin-top:16px">Clothes are washed and ironed</button>
        <p class="hint">Tap this when the work is done. You'll check every cloth with mark ${esc(c.mark)} before bagging.</p>`;
  };
  if (own()) {
    if (o.status === "new" && !o.list_sent) html += waBlock(o, "list", true); else if (o.list_sent) html += sentLine(o, "list", "List of clothes sent.");
    if (o.status === "ready") html += o.billed ? waBlock(o, "ready", true) : `<p class="bad">Clothes are packed and ready. Save the bill below first so the message can include it.</p>`;
    if (o.status === "told" || (o.status === "picked" && o.billed)) html += sentLine(o, "ready", "Ready message and invoice sent.");
    html += `<h2 style="margin-top:18px">Bill ${o.billed ? `<span class="pill p-ready" style="vertical-align:middle">Saved</span>` : ""}</h2>`;
    if (canEditBill) {
      html += `<div class="lines">
        ${o.items.map((it, i) => { const p = item(it.id) || {}; return `<div><span>${it.qty} × ${esc(pname(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}</small></span>${p.custom ? `<input data-cp="${i}" ${moneyAttrs} placeholder="Set price" value="${o.m.custom[i] || ""}" aria-label="Price for ${esc(pname(it))}">` : `<span>${naira(unitPrice(o, it, i) * it.qty)}</span>`}</div>`; }).join("")}
        <div><label class="ck" style="margin:0"><input type="checkbox" id="ex" ${o.express ? "checked" : ""}> Express delivery${expressLabel()}</label>${expManual() ? `<input id="exa" ${moneyAttrs} placeholder="Amount" value="${o.express && o.m.express_amt ? o.m.express_amt : ""}" aria-label="Express delivery amount">` : `<span id="exv">${naira(k.exp)}</span>`}</div>
        <div><span>Pickup / delivery${o.pickup ? "<br><small style='color:var(--muted)'>Customer asked for it</small>" : ""}</span><input id="dl" ${moneyAttrs} placeholder="0" value="${o.m.delivery || ""}" aria-label="Pickup or delivery cost"></div>
        <div><span>Discount</span><input id="dc" ${moneyAttrs} placeholder="0" value="${o.m.discount || ""}" aria-label="Discount"></div>
        <div><b>Total</b><b id="tot">${naira(k.total)}</b></div></div>
        <button class="btn ${o.billed ? "btn-ghost" : "btn-primary"}" id="bill">${o.billed ? "Update bill" : "Save bill"}</button>
        ${o.status === "new" || o.status === "listed" ? `<p class="hint">You can save or change the bill any time. It goes to the customer only when the clothes are packed and ready.</p>` : ""}`;
    } else {
      html += `<div class="lines">
        ${o.items.map((it, i) => `<div><span>${it.qty} × ${esc(pname(it))}</span><span>${naira(unitPrice(o, it, i) * it.qty)}</span></div>`).join("")}
        ${k.exp ? `<div><span>Express delivery</span><span>${naira(k.exp)}</span></div>` : ""}
        ${o.m.delivery ? `<div><span>Pickup / delivery</span><span>${naira(o.m.delivery)}</span></div>` : ""}
        ${o.m.discount ? `<div><span>Discount</span><span>−${naira(o.m.discount)}</span></div>` : ""}
        <div><b>Total</b><b>${naira(o.billed ? o.m.total : k.total)}</b></div></div>`;
    }
    html += `<h2 style="margin-top:18px">Payment</h2><div class="lines">
      ${o.billed ? `<div><span>Total</span><span>${naira(o.m.total)}</span></div>` : ""}
      <div><span>Paid so far</span><span>${naira(o.m.paid)}</span></div>
      ${o.billed ? `<div><b ${owed(o) ? 'style="color:var(--owes)"' : ""}>Still to pay</b><b ${owed(o) ? 'style="color:var(--owes)"' : ""}>${naira(owed(o))}</b></div>`
        : `<div><span style="color:var(--muted)">Balance shows once the bill is saved</span><span></span></div>`}</div>
      ${payList(o)}
      ${!o.billed || owed(o) ? payForm(owed(o) || "0", o.billed && owed(o) ? owed(o) : 0) + (!o.billed ? `<p class="hint">Use this when a customer pays before the clothes are ready.</p>` : "") : `<p class="hint">Fully paid.</p>`}`;
    if (o.status === "picked" && owed(o)) html += waBlock(o, "owe", false);
    html += checkHtml();
  } else {
    html += `<div class="lines">${o.items.map(it => `<div><span>${it.qty} × ${esc(pname(it))}</span><span style="color:var(--muted)">${SERVICES[it.svc]}</span></div>`).join("")}
      <div><b>Clothes</b><b>${k.count}</b></div>
      ${o.billed && (o.status === "told" || o.status === "picked") ? `<div><span>Payment</span><span class="pill ${owed(o) ? "p-owed" : "p-collected"}">${owed(o) ? "Not paid" : "Paid"}</span></div>` : ""}</div>`;
    html += `<h2 style="margin-top:18px">Payment</h2>` + (o.billed && o.settled ? `<p class="hint"><span class="pill p-collected">Paid in full</span></p>`
      : payForm("0", o.billed) + `<p class="hint">${o.billed ? "Tap Paid in full if the customer paid everything. Otherwise type what they gave you." : "Type what the customer gave you."} The owner sees it straight away.</p>`);
    html += checkHtml();
    if (o.status === "ready") html += `<p class="hint" style="margin-top:12px">Ready and bagged. Waiting for the owner to tell the customer.</p>`;
  }
  if (o.status === "ready" || o.status === "told") html += `<button class="btn btn-ghost" id="pick" style="margin-top:16px">Clothes picked up</button>
    <p class="hint">Mark this when the customer takes the clothes${own() ? ". Payment is recorded separately, because some customers pay later." : ". Payment is recorded by the owner."}</p>`;

  html += printBlock(o);
  const y = sh.hidden ? 0 : sh.scrollTop;
  sh.innerHTML = `<div class="app">
    ${orderTop(o)}
    <div class="dhead"><div class="mark">${esc(c.mark)}</div><div><b>${esc(c.name)}</b>
      <span>${own() && c.phone ? fmtPhone(c.phone) + " · " : ""}#${o.no}${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}${o.express ? " · express delivery" : ""}</span></div></div>
    <div class="steps"><span class="fill" style="width:${idx * 20}%"></span>${STEPS.map((s, i) => `<div class="st ${i === 1 && !o.list_sent && idx > 1 ? "" : i < idx || (i === idx && o.status === "picked") ? "done" : i === idx ? "cur" : ""}">${s[1]}</div>`).join("")}</div>
    <p class="hint">Dropped ${fmtDay(o.at)}</p>
    ${html}
  </div>`;
  const wasHidden = sh.hidden; sh.hidden = false; sh.scrollTop = wasHidden ? 0 : y;
  wireBack(sh); wireFix(sh, o);
  if ($("#prt")) $("#prt").onclick = () => printReceipt(o);
  sh.querySelectorAll("[data-paper]").forEach(b => b.onclick = () => { paper = b.dataset.paper; try { localStorage.setItem("tb-paper", paper); } catch (_) { } sh.querySelectorAll("[data-paper]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.paper === paper))); });
  const setGreet = async g => {
    sh.querySelectorAll("[data-og],#og-save").forEach(x => x.disabled = true);
    const { data, error } = await sb.rpc("owner_set_greet", { p_customer: o.cid, p_greet: g || null });
    if (error) { toast(failMsg(error)); sh.querySelectorAll("[data-og],#og-save").forEach(x => x.disabled = false); return; }
    const cc = customers.find(x => x.id === o.cid); if (cc) { cc.greet = (data && data.greet) || null; cc.greet_asked = true; }
    ogOther = false; openOrder(o.no);
  };
  sh.querySelectorAll("[data-og]").forEach(b => b.onclick = () => { if (b.dataset.og === "__other") { ogOther = true; openOrder(o.no); const t = $("#data-og-txt"); if (t) t.focus(); return; } setGreet(b.dataset.og); });
  const ogs = $("#og-save"); if (ogs) ogs.onclick = () => { const g = cleanGreet($("#data-og-txt").value); if (!g) { toast("Type how you greet them"); return; } setGreet(g); };
  const again = () => openOrder(no);
  const setStatus = (s, msg) => { o.status = s; toast(msg); again(); put("orders", { id: o.id }, { status: s }); };
  sh.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
    const t = message(o, b.dataset.copy);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Message copied")).catch(() => {
      const r = document.createRange(); r.selectNodeContents($("#wamsg-" + b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Message selected. Copy it.");
    });
  });
  sh.querySelectorAll("[data-done]").forEach(b => b.onclick = () => {
    const t = b.dataset.done; o.again[t] = false;
    if (t === "list" && !o.list_sent) { o.list_sent = true; const st = o.status === "new" ? "listed" : o.status; o.status = st; toast("List of clothes marked as sent"); again(); put("orders", { id: o.id }, { list_sent: true, status: st }); }
    else if (t === "ready" && o.status === "ready") setStatus("told", "Customer marked as told");
    else again();
  });
  sh.querySelectorAll("[data-again]").forEach(b => b.onclick = () => { o.again[b.dataset.again] = true; again(); });
  const live = () => { const kk = calc(o); $("#tot").textContent = naira(kk.total); if ($("#exv")) $("#exv").textContent = naira(kk.exp); };
  sh.querySelectorAll("[data-cp]").forEach(i => moneyInput(i, v => { o.m.custom[i.dataset.cp] = v; live(); }));
  moneyInput($("#dl"), v => { o.m.delivery = v; live(); });
  moneyInput($("#dc"), v => { o.m.discount = v; live(); });
  moneyInput($("#pay"), () => { });
  if ($("#ex")) $("#ex").onchange = e => { o.express = e.target.checked; if (!expManual()) o.m.express_amt = 0; else if (o.express && $("#exa")) $("#exa").focus(); live(); };
  if ($("#exa")) moneyInput($("#exa"), v => { o.m.express_amt = v; if (v && !o.express) { o.express = true; $("#ex").checked = true; } live(); });
  const bill = $("#bill"); if (bill) bill.onclick = async () => {
    const miss = o.items.find((it, i) => (item(it.id) || {}).custom && !o.m.custom[i]);
    if (miss) { toast(`Set a price for ${pname(miss)} first`); return; }
    if (o.express && expManual() && !(+o.m.express_amt > 0)) { toast("Type the express delivery amount"); $("#exa").focus(); return; }
    if (!o.billed) lockPrices(o);
    const kk = calc(o);
    o.m.express_amt = kk.exp; o.m.total = kk.total; o.m.billed_at = o.m.billed_at || new Date().toISOString();
    bill.disabled = true;
    if (await put("orders", { id: o.id }, { express: o.express }) && await saveMoney(o)) {
      // Special items priced here go on the price list too, so next time staff just tap them.
      const added = [];
      for (const [i, it] of o.items.entries()) {
        if (!(item(it.id) || {}).custom || !it.label || !+o.m.custom[i]) continue;
        const known = PRICES.find(x => !x.custom && x.name.toLowerCase() === it.label.toLowerCase() && (x.p || {})[it.svc] && !x.hidden);
        if (!known && await toPriceList(tidy(it.label).slice(0, 40), it.svc, +o.m.custom[i])) added.push(it.label);
      }
      toast(added.length ? `Bill saved. Added ${added.join(", ")} to your price list.` : "Bill saved");
    }
    again();
  };
  sh.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { payMethod = b.dataset.pm; sh.querySelectorAll("[data-pm]").forEach(x => x.setAttribute("aria-pressed", x.dataset.pm === payMethod)); });
  // Paid in full: we send the largest amount allowed and the server caps it at what's still owed.
  const doPay = async (pp, v) => {
    const label = pp.textContent; pp.disabled = true; pp.textContent = "Recording…";
    const { data, error } = await sb.rpc("record_payment", { p_order: o.id, p_amount: v, p_method: payMethod });
    if (error) { toast(/ALREADY_PAID/.test(error.message || "") ? "This order is already fully paid." : failMsg(error)); pp.disabled = false; pp.textContent = label; return; }
    v = data.added;
    try { await load(); } catch (_) { }
    if (own()) toast(data.billed && data.paid < data.total ? `Recorded ${naira(data.added)}. ${naira(data.total - data.paid)} still to pay.` : data.billed ? "Recorded. Fully paid." : `Recorded ${naira(data.added)} paid early`);
    else toast(data.settled ? "Recorded. The customer has now paid in full. The owner has been told." : `Recorded ${naira(v)}. The owner has been told.`);
    render();
  };
  const who = esc(cust(o.cid).name);
  const pp = $("#pp"); if (pp) pp.onclick = async () => { const v = num($("#pay").value); if (!v) { toast("Type the amount received"); return; }
    if (await askConfirm(`Record ${naira(v)}?`, `Payment from ${who}, order #${o.no}.`, "Yes, record it")) doPay(pp, v); };
  const pa = $("#ppall"); if (pa) pa.onclick = async () => {
    if (await askConfirm("Mark as paid in full?", `${o.billed && owed(o) ? `${naira(owed(o))} from ${who}` : `Full payment from ${who}`}, order #${o.no}.`, "Yes, paid in full")) doPay(pa, 100000000); };
  const w = $("#washed"); if (w) w.onclick = () => { o.checking = true; again(); put("orders", { id: o.id }, { checking: true }); };
  sh.querySelectorAll("[data-ck]").forEach(b => b.onchange = () => { o.checked = { ...o.checked, [b.dataset.ck]: b.checked }; again(); put("orders", { id: o.id }, { checked: o.checked }); });
  const rd = $("#rd"); if (rd) rd.onclick = () => setStatus("ready", own() ? "Marked ready. Send the ready message." : "Marked ready. The owner has been told.");
  const pk = $("#pick"); if (pk) pk.onclick = async () => {
    if (!await askConfirm(`Has ${cust(o.cid).name} picked up their clothes?`, `Order #${o.no}. After this, the bill can't be changed.${owed(o) ? ` They still owe ${naira(owed(o))}.` : ""}`, "Yes, picked up")) return;
    setStatus("picked", owed(o) ? "Picked up. Not fully paid yet." : "Picked up"); };
}

/* ---------- Reports (owner) ---------- */
function dkey(x) { return x.getFullYear() + "-" + (x.getMonth() + 1) + "-" + x.getDate(); }
function liveByDay() {
  const m = {}; const add = (ts, f, v) => { const k = dkey(new Date(ts)); (m[k] = m[k] || { orders: 0, clothes: 0, billed: 0, received: 0 })[f] += v; };
  orders.forEach(o => {
    add(o.at, "orders", 1); add(o.at, "clothes", calc(o).count);
    if (o.billed && o.m.billed_at) add(Date.parse(o.m.billed_at), "billed", o.m.total);
    (o.m.payments || []).forEach(p => add(p.at, "received", p.amt));
  });
  // Money really came in on cancelled orders too, so it stays in "received".
  cancelledOrders.forEach(o => (o.m.payments || []).forEach(p => add(p.at, "received", p.amt)));
  return m;
}
let rep = { type: "week", k: 0, sel: null };
function periodRange(type, k) {
  const t = new Date(); t.setHours(0, 0, 0, 0); let s, e;
  if (type === "day") { s = new Date(t); s.setDate(s.getDate() + k); e = new Date(s); e.setDate(e.getDate() + 1); }
  else if (type === "week") { s = new Date(t); s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + 7 * k); e = new Date(s); e.setDate(e.getDate() + 7); }
  else if (type === "month") { s = new Date(t.getFullYear(), t.getMonth() + k, 1); e = new Date(t.getFullYear(), t.getMonth() + k + 1, 1); }
  else { s = new Date(t.getFullYear() + k, 0, 1); e = new Date(t.getFullYear() + k + 1, 0, 1); }
  return { s, e };
}
function periodLabel(type, k, { s, e }) {
  if (type === "day") return k === 0 ? "Today" : k === -1 ? "Yesterday" : `${DOW[s.getDay()]} ${s.getDate()} ${MON[s.getMonth()]}`;
  if (type === "week") { const l = new Date(e); l.setDate(l.getDate() - 1); return (k === 0 ? "This week · " : k === -1 ? "Last week · " : "") + `${s.getDate()} ${MON[s.getMonth()]} to ${l.getDate()} ${MON[l.getMonth()]}`; }
  if (type === "month") return (k === 0 ? "This month · " : "") + `${MON[s.getMonth()]} ${s.getFullYear()}`;
  return (k === 0 ? "This year · " : "") + s.getFullYear();
}
function sumRange(s, e, live) {
  const tot = { orders: 0, clothes: 0, billed: 0, received: 0 }; const x = new Date(s); const now = new Date(); now.setHours(23, 59, 59, 999);
  while (x < e && x <= now) { const v = live[dkey(x)]; if (v) for (const f in tot) tot[f] += v[f]; x.setDate(x.getDate() + 1); }
  return tot;
}
function buckets(type, { s, e }, live) {
  const out = []; const now = new Date(); now.setHours(23, 59, 59, 999);
  if (type === "week" || type === "month") { const x = new Date(s); while (x < e) { const fut = x > now; out.push({ label: type === "week" ? DOW[x.getDay()] : String(x.getDate()), full: `${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`, v: fut ? null : ((live[dkey(x)] || {}).received || 0) }); x.setDate(x.getDate() + 1); } }
  else if (type === "year") { for (let mo = 0; mo < 12; mo++) { const a = new Date(s.getFullYear(), mo, 1), b = new Date(s.getFullYear(), mo + 1, 1); out.push({ label: MON[mo][0], full: `${MON[mo]} ${s.getFullYear()}`, v: a > now ? null : sumRange(a, b, live).received }); } }
  return out;
}
function renderReports() {
  const firstDay = (() => { const x = new Date(Math.min(Date.parse(shop.created_at), ...orders.map(o => o.at))); x.setHours(0, 0, 0, 0); return x; })();
  const live = liveByDay(), R = periodRange(rep.type, rep.k), P = periodRange(rep.type, rep.k - 1);
  const cur = sumRange(R.s, R.e, live);
  let pe = P.e; if (rep.k === 0 && rep.type !== "day") { const t = new Date(); t.setHours(0, 0, 0, 0); const days = Math.round((t - R.s) / 864e5) + 1; pe = new Date(P.s); pe.setDate(pe.getDate() + days); if (pe > P.e) pe = P.e; }
  const prev = sumRange(P.s, pe, live);
  const canBack = R.s > firstDay, canFwd = rep.k < 0;
  const owingNow = orders.reduce((s, o) => s + ((o.status === "told" || o.status === "picked") ? owed(o) : 0), 0);
  const prevName = rep.k === 0 && rep.type !== "day" ? { week: "the same days last week", month: "the same days last month", year: "the same days last year" }[rep.type] : { day: rep.k === 0 ? "yesterday" : "the day before", week: "the week before", month: "the month before", year: "the year before" }[rep.type];
  const diff = prev.received ? Math.round((cur.received - prev.received) / prev.received * 100) : null;
  const bars = buckets(rep.type, R, live), max = Math.max(1, ...bars.map(b => b.v || 0));
  const sel = rep.sel != null && bars[rep.sel] && bars[rep.sel].v != null ? bars[rep.sel] : null;
  const partial = rep.k === 0 && rep.type !== "day" ? " so far" : "";
  view.innerHTML = `${backBtn("Orders")}<h2>Reports</h2>
    <div class="chips">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([k, l]) => `<button class="chip" data-rt="${k}" aria-pressed="${rep.type === k}">${l}</button>`).join("")}</div>
    <div class="rnav"><button class="rbtn" id="rprev" aria-label="Previous" ${canBack ? "" : "disabled"}>‹</button><b>${periodLabel(rep.type, rep.k, R)}</b><button class="rbtn" id="rnext" aria-label="Next" ${canFwd ? "" : "disabled"}>›</button></div>
    <div class="rhero"><span>Money received${partial}</span><b>${naira(cur.received)}</b>
      <small>${diff == null ? "" : `${diff >= 0 ? "Up" : "Down"} ${Math.abs(diff)}% on ${prevName} (${naira(prev.received)})`}</small></div>
    ${bars.length ? `<div class="rchart" role="img" aria-label="Money received by ${rep.type === "year" ? "month" : "day"}">
      <p class="rsel">${sel ? `${sel.full}: <b>${naira(sel.v)}</b>` : "Tap a bar to see that " + (rep.type === "year" ? "month" : "day")}</p>
      <div class="rbars ${bars.length > 12 ? "dense" : ""}">${bars.map((b, i) => `<button class="rbar ${rep.sel === i ? "on" : ""}" data-bi="${i}" ${b.v == null ? "disabled" : ""} aria-label="${b.full}: ${b.v == null ? "not yet" : naira(b.v)}"><i style="height:calc((100% - 20px) * ${b.v == null ? 0 : Math.max(0.02, b.v / max).toFixed(3)})"></i><span>${bars.length > 12 && (i % 5 !== 0) ? "" : b.label}</span></button>`).join("")}</div></div>` : ""}
    <div class="stats rstats">
      <div class="stat"><b>${naira(cur.billed)}</b><span>Billed</span></div>
      <div class="stat"><b>${cur.orders}</b><span>Orders</span></div>
      <div class="stat"><b>${cur.clothes}</b><span>Clothes</span></div>
    </div>
    <div class="lines"><div><span>Owed to you right now</span><b style="color:${owingNow ? "var(--owes)" : "inherit"}">${naira(owingNow)}</b></div></div>
    <p class="hint">Money received counts payments on the day they came in. Billed counts bills on the day they were made, paid or not.</p>`;
  wireBack(view);
  view.querySelectorAll("[data-rt]").forEach(b => b.onclick = () => { rep = { type: b.dataset.rt, k: 0, sel: null }; renderReports(); });
  $("#rprev").onclick = () => { rep.k--; rep.sel = null; renderReports(); };
  $("#rnext").onclick = () => { rep.k++; rep.sel = null; renderReports(); };
  view.querySelectorAll("[data-bi]").forEach(b => b.onclick = () => { rep.sel = +b.dataset.bi; renderReports(); });
}

/* ---------- Settings ---------- */
async function callAdmin(body) {
  const { data, error } = await sb.functions.invoke("admin", { body });
  if (!error) return { ok: true, data };
  let code = ""; try { code = (await error.context.json()).error; } catch (_) { }
  const msgs = {
    PHONE_IN_USE: "This phone number already has a Tagbook login.", NAME_TOO_LONG: "The shop name is too long. Keep it to 50 letters.", BAD_PHONE: "The phone number must be 11 digits and start with 0.",
    BAD_PIN: "The PIN must be 6 digits.", MISSING_NAME: "Type the name.", OWNER_ONLY: "Only the owner can do that.", CANNOT_REMOVE_SELF: "You can't remove yourself.",
  };
  return { ok: false, msg: msgs[code] || "Something went wrong. Check your internet and try again." };
}
const pinAttrs = 'type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"';
/* PINs we hand out are made up for the person, and shown so they can be sent on */
const newPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); let p = String(a[0] % 1000000).padStart(6, "0"); if (/^(\d)\1+$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p)) p = String((a[0] >> 3) % 900000 + 100000); return p; };
const genPinAttrs = () => `type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" value="${newPin()}"`;
let resetFor = null, setTab = "business", priceOpen = null, priceQ = "", addOpen = false;
const wide = window.matchMedia("(min-width: 900px)");
wide.addEventListener("change", () => { if (me && tab === "prices") renderSettings(); });
const SET_TABS = [["business", "Business"], ["plan", "Plan & billing"], ["prices", "Price list"], ["staff", "Staff"], ["branches", "Branches"], ["account", "My account"]];
const card = (title, sub, body) => `<section class="scard"><h3 class="stitle">${title}</h3>${sub ? `<p class="hint" style="margin-top:-4px">${sub}</p>` : ""}${body}</section>`;
const shortSvc = { wi: "Wash & iron", wo: "Wash", io: "Iron", wsi: "Starch" };
function renderSettings() {
  if (!own()) setTab = "account";
  const meLine = `<p class="who-me">Signed in as <b>${esc(me.name)}</b> (${own() ? "owner" : "staff"}) · ${fmtPhone(me.phone)}</p>`;
  const tabsList = isAdmin ? SET_TABS.concat([["shops", "Tagbook shops"]]) : SET_TABS;
  const nav = own() ? `<nav class="stabs" aria-label="Settings sections">${tabsList.map(([k, l]) => `<button data-st="${k}" aria-current="${setTab === k ? "page" : "false"}">${l}</button>`).join("")}</nav>` : "";
  let body = "";
  if (setTab === "account") body = (!own() && shop.staff_prices ? staffPriceHtml() : "") + (own() ? card("Notifications", "Your phone buzzes when staff log clothes or mark them ready, even when Tagbook is closed.", `<div id="pushbox"><p class="hint">Checking…</p></div>`) : "") + card("Change my PIN", "You'll use the new PIN next time you log in.",
      `<label for="np">New 6-digit PIN</label><input id="np" class="pin" ${pinAttrs}><button class="btn btn-ghost" id="npb">Save new PIN</button>`)
    + `<button class="logout" id="out"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>Log out</button>`;
  if (setTab === "business") { const p = sPriv(); body =
    card("Business name", "Shown at the top of the app and in every WhatsApp message.",
      `<input id="sn" maxlength="${NAME_MAX}" value="${esc(shop.name)}" placeholder="e.g. BrightWash Laundry" autocomplete="off" aria-label="Business name">`)
    + card("Bank account for payments", "Added to every invoice and payment reminder, so customers know where to pay.",
      `<label for="bn">Bank name</label><input id="bn" list="banks-shop" value="${esc(p.bank_name)}" placeholder="Start typing, e.g. GTBank or Opay" autocomplete="off">${bankList("banks-shop")}
       <label for="an">Account number</label><input id="an" ${moneyAttrs} maxlength="10" value="${esc(p.acct_no)}" placeholder="10 digits">
       <p class="hint" id="anx">${p.acct_no.length === 10 ? "" : "Account number must be 10 digits."}</p>
       <label for="am">Account name</label><input id="am" value="${esc(p.acct_name)}" placeholder="Name on the account" autocomplete="off">`)
    + card("Express delivery charge", "Added to the bill when an order is marked express delivery.",
      `<div class="chips" style="margin:0 0 4px"><button class="chip" data-et="manual" aria-pressed="${p.express_type === "manual"}">Type it each time</button><button class="chip" data-et="percent" aria-pressed="${p.express_type === "percent"}">Percentage extra</button><button class="chip" data-et="times" aria-pressed="${p.express_type === "times"}">Times the bill (2×)</button><button class="chip" data-et="fixed" aria-pressed="${p.express_type === "fixed"}">Fixed amount</button></div>
       ${p.express_type === "manual" ? `<p class="hint">You type the express amount on each order's bill, depending on the job.</p>` : `<label for="ev">${p.express_type === "percent" ? "Extra percentage (%)" : p.express_type === "times" ? "Multiply the bill by" : "Extra amount per order (₦)"}</label>
       <input id="ev" ${moneyAttrs} value="${p.express_value}"><p class="hint" id="evx">${exampleExpress()}</p>`}`); }
  if (setTab === "branches") body = card("Branches", "Where customers drop clothes. With one branch, the app doesn't ask.",
      `${liveBranches().map(b => `<div class="row srow"><input data-bn="${b.id}" value="${esc(b.name)}" autocomplete="off" aria-label="Branch name">${liveBranches().length > 1 ? `<button class="mini danger" data-brm="${b.id}">Remove</button>` : ""}</div>`).join("")}
       <div class="row srow"><input id="nb" placeholder="New branch name" autocomplete="off" aria-label="New branch name"><button class="mini" id="nbb">Add</button></div>`);
  if (setTab === "staff") body = card("Staff logins", `Staff log clothes and check them before bagging. They never see bills, payments or customer numbers${shop.staff_prices ? ", but they can see your price list to answer customers" : ""}.`,
      staffList.map(s => `<div class="staff-row"><div><b>${esc(s.name)}${s.user_id === me.user_id ? " (you)" : ""}</b><span>${s.role === "owner" ? "Owner" : "Staff"} · ${fmtPhone(s.phone)}</span></div>
        ${s.user_id === me.user_id ? "" : `<div class="acts"><button class="mini" data-rp="${s.user_id}">New PIN</button><button class="mini danger" data-srm="${s.user_id}">Remove</button></div>`}</div>
        ${resetFor === s.user_id ? `<div class="row srow"><input id="rpi" class="pin" ${pinAttrs} placeholder="6 digits" aria-label="New PIN for ${esc(s.name)}"><button class="mini" id="rpb">Save</button></div>` : ""}`).join(""))
    + (newStaff ? card(`Send ${esc(newStaff.name.split(" ")[0])} their login`, "They need this to open Tagbook on their phone.",
      `<div class="wa">${esc(newStaff.msg)}</div>
       <a class="btn btn-primary" id="nsfwa" target="_blank" rel="noopener" href="${waLink(newStaff.phone, newStaff.msg)}">Send on WhatsApp</a>
       <div class="row"><button class="btn btn-ghost" id="nsfcopy">Copy message</button><button class="btn btn-ghost" id="nsfdone">Done</button></div>`)
    : card("Add a staff login", "After adding, you can send them their login on WhatsApp. They can change their PIN in their own Settings.",
      `<div class="sgrid"><div><label for="sfn">Name</label><input id="sfn" placeholder="e.g. Grace" autocomplete="off"></div>
       <div><label for="sfp">Phone number</label><input id="sfp" type="text" inputmode="tel" placeholder="0803 412 7790" autocomplete="off"></div>
       <div><label for="sfk">6-digit PIN for them</label><input id="sfk" class="pin" ${genPinAttrs()}></div></div>
       <button class="btn btn-primary" id="sfa">Add staff login</button>`))
    + card("Price list for staff", "Lets staff see your prices so they can answer customers who ask. They can't change prices or see any bill.",
      `<div class="chips" style="margin:0"><button class="chip" data-sp="1" aria-pressed="${!!shop.staff_prices}">Staff can see prices</button><button class="chip" data-sp="0" aria-pressed="${!shop.staff_prices}">Hide prices from staff</button></div>`);
  if (setTab === "prices") body = priceListHtml();
  if (setTab === "plan" && own()) body = planHtml();
  if (setTab === "shops" && isAdmin) body = shopsHtml();
  view.innerHTML = `${backBtn("Orders")}<h2 class="ptitle">Settings</h2>${meLine}<div class="${own() ? "slayout" : ""}">${nav}<div class="sbody">${body}</div></div><p class="foot">Tagbook by Ordiventa · version ${String(window.TB_BUILD || "").slice(4, 12)} · <a href="/privacy">Privacy policy</a></p>`;
  wireBack(view);
  view.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { setTab = b.dataset.st; if (setTab === "prices") markSetup("prices"); if (setTab === "plan") loadPlan().then(() => { if (tab === "prices" && setTab === "plan") renderSettings(); }); priceOpen = null; resetFor = null; addOpen = false; renderSettings(); });
  if (setTab === "account") wireAccount();
  if (setTab === "business") wireBusiness();
  if (setTab === "branches") wireBranches();
  if (setTab === "staff") wireStaff();
  if (setTab === "prices") wirePrices();
  if (setTab === "plan" && own()) wirePlan();
  if (setTab === "shops" && isAdmin) wireShops();
}
const savedToast = ok => { if (ok) toast("Saved"); };
async function drawPushBox() {
  const box = $("#pushbox"); if (!box) return;
  const st = await pushState();
  const html = {
    on: `<p class="pushon">On for this phone</p><button class="btn btn-ghost" id="pushoff">Turn off on this phone</button>`,
    off: `<button class="btn btn-primary" id="pushgo">Turn on notifications</button>`,
    blocked: `<p class="hint">Notifications are blocked for Tagbook on this phone. Allow them in your phone's settings (Site settings → Notifications), then come back here.</p>`,
    "ios-install": `<p class="hint">On iPhone: tap Share (or ⋯ then Share), then “Add to Home Screen”. Open Tagbook from the Home Screen and turn notifications on here.</p>`,
    unsupported: `<p class="hint">This browser can't show notifications. Use Chrome on your phone.</p>`,
  }[st];
  if (!$("#pushbox")) return;
  box.innerHTML = html;
  if ($("#pushgo")) $("#pushgo").onclick = async () => { $("#pushgo").disabled = true; await enablePush(); drawPushBox(); };
  if ($("#pushoff")) $("#pushoff").onclick = async () => { await disablePush(); toast("Notifications off for this phone"); drawPushBox(); };
}
function wireAccount() {
  drawPushBox();
  const spq = $("#spq"); if (spq) spq.oninput = e => { priceQ = e.target.value; const p = e.target.selectionStart; renderSettings(); const n = $("#spq"); n.focus(); n.setSelectionRange(p, p); };
  $("#npb").onclick = async () => {
    const pin = digits($("#np").value); if (pin.length !== 6) { toast("The PIN must be 6 digits."); return; }
    $("#npb").disabled = true;
    const r = await callAdmin({ action: "change_my_pin", pin });
    $("#npb").disabled = false;
    if (!r.ok) { toast(r.msg); return; }
    $("#np").value = ""; toast("New PIN saved. Use it next time you log in.");
  };
  $("#out").onclick = async () => { if (!$("#out").dataset.sure) { $("#out").dataset.sure = "1"; $("#out").textContent = "Tap again to log out"; return; } try { await disablePush(); } catch (_) { } await sb.auth.signOut(); location.hash = ""; location.reload(); };
}
function wireBusiness() {
  const p = sPriv();
  $("#sn").onchange = async e => { const v = tidy(e.target.value).slice(0, NAME_MAX); if (!v) { e.target.value = shop.name; return; } shop.name = v; $("#shopname").textContent = shopName(); savedToast(await put("shops", { id: shop.id }, { name: v })); };
  const savePriv = async fields => { Object.assign(priv, fields); savedToast(await put("shop_private", { shop_id: shop.id }, fields)); };
  $("#bn").onchange = e => savePriv({ bank_name: e.target.value.trim().slice(0, 40) });
  $("#am").onchange = e => savePriv({ acct_name: e.target.value.trim().slice(0, 60) });
  moneyInput($("#an"), () => { const el = $("#an"); if (el.value.length > 10) el.value = el.value.slice(0, 10); $("#anx").textContent = el.value.length === 10 ? "" : "Account number must be 10 digits."; });
  $("#an").onchange = e => savePriv({ acct_no: e.target.value });
  view.querySelectorAll("[data-et]").forEach(b => b.onclick = async () => { await savePriv({ express_type: b.dataset.et, express_value: b.dataset.et === "percent" ? 50 : b.dataset.et === "times" ? 2 : b.dataset.et === "fixed" ? 1000 : 0 }); renderSettings(); });
  if ($("#ev")) { moneyInput($("#ev"), v => { priv.express_value = p.express_type === "percent" ? Math.min(v, 300) : p.express_type === "times" ? Math.min(Math.max(v, 1), 5) : v; $("#evx").textContent = exampleExpress(); });
  $("#ev").onchange = () => savePriv({ express_value: priv.express_value }); }
}
function wireBranches() {
  view.querySelectorAll("[data-bn]").forEach(i => i.onchange = async () => { const v = i.value.trim().slice(0, 40); if (!v) return; const b = BRANCHES.find(x => x.id === i.dataset.bn); b.name = v; savedToast(await put("branches", { id: b.id }, { name: v })); });
  view.querySelectorAll("[data-brm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again"; return; } const br = BRANCHES.find(x => x.id === b.dataset.brm); br.active = false; renderSettings(); savedToast(await put("branches", { id: br.id }, { active: false })); });
  $("#nbb").onclick = async () => { const v = $("#nb").value.trim().slice(0, 40); if (!v) { toast("Type the branch name first"); return; } const { error } = await sb.from("branches").insert({ shop_id: shop.id, name: v, sort: BRANCHES.length }); if (error) { toast(failMsg(error)); return; } toast(`${v} added`); await load(); renderSettings(); };
}
let newStaff = null;
function wireStaff() {
  view.querySelectorAll("[data-sp]").forEach(b => b.onclick = async () => { const v = b.dataset.sp === "1"; if (v === !!shop.staff_prices) return; shop.staff_prices = v; renderSettings(); savedToast(await put("shops", { id: shop.id }, { staff_prices: v })); });
  view.querySelectorAll("[data-rp]").forEach(b => b.onclick = () => { resetFor = resetFor === b.dataset.rp ? null : b.dataset.rp; renderSettings(); const i = $("#rpi"); if (i) i.focus(); });
  if ($("#rpb")) $("#rpb").onclick = async () => { const pin = digits($("#rpi").value); if (pin.length !== 6) { toast("The PIN must be 6 digits."); return; } $("#rpb").disabled = true; const r = await callAdmin({ action: "reset_pin", user_id: resetFor, pin }); toast(r.ok ? "New PIN saved. Tell them in person." : r.msg); if (r.ok) { resetFor = null; renderSettings(); } else $("#rpb").disabled = false; };
  view.querySelectorAll("[data-srm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again"; return; } b.disabled = true; const r = await callAdmin({ action: "remove_staff", user_id: b.dataset.srm }); toast(r.ok ? "Staff login removed" : r.msg); if (r.ok) { await load(); renderSettings(); } });
  if ($("#nsfcopy")) $("#nsfcopy").onclick = async () => toast(await copyText(newStaff.msg) ? "Message copied" : "Couldn't copy");
  if ($("#nsfdone")) $("#nsfdone").onclick = () => { newStaff = null; renderSettings(); };
  if (!$("#sfa")) return;
  $("#sfa").onclick = async () => {
    const name = tidy($("#sfn").value), phone = digits($("#sfp").value), pin = digits($("#sfk").value);
    const err = !name ? "Type the staff member's name." : !/^0\d{10}$/.test(phone) ? "The phone number must be 11 digits and start with 0." : pin.length !== 6 ? "The PIN must be 6 digits." : "";
    if (err) { toast(err); return; }
    $("#sfa").disabled = true; $("#sfa").textContent = "Adding…";
    const r = await callAdmin({ action: "add_staff", name, phone, pin });
    if (!r.ok) { toast(r.msg); $("#sfa").disabled = false; $("#sfa").textContent = "Add staff login"; return; }
    newStaff = { name, phone, msg: `Hello ${name.split(" ")[0]}, you've been added to ${shopName()} on Tagbook.\n\nOpen tagbook.ordiventa.com and log in with:\nPhone: ${fmtPhone(phone)}\nPIN: ${pin}\n\nTip: add it to your Home Screen so it opens like an app. You can change your PIN in Settings.` };
    toast(`${name} added`); await load(); renderSettings();
  };
}

/* ---------- Ordiventa only: add shops and see every shop ---------- */
let newShop = null, shopRows = null, refOpts = null, teamOpts = null;
const agentMode = () => tab === "agent";
const rerenderShops = () => agentMode() ? renderAgent() : renderSettings();
let myEarn = null, myEarnBusy = false, bankEdit = false;
function earningsHtml() {
  if (!myEarn) return "";
  const e = myEarn, th = e.threshold || 10000, wait = e.max_wait || 60;
  const pct = Math.min(100, Math.round((e.due || 0) / th * 100));
  const payLine = !e.due ? `We pay once you're owed ${naira(th)}, or once money has waited ${wait} days.`
    : e.ready ? `<b>Ready to be paid.</b> Bolu will send ${naira(e.due)} soon.`
    : `${naira(e.due)} of ${naira(th)}. We pay once you reach ${naira(th)}${e.oldest_due ? `, or on ${longDay(isoDay(new Date(Date.parse(e.oldest_due) + wait * 864e5)))} at the latest` : ""}.`;
  const role = s => [s.brought ? "Agent" : "", s.setup ? "Helper" : ""].filter(Boolean).join(" and ") || "Set up by you";
  const claim = s => s.claim === "pending" ? " · waiting for Bolu to confirm who found it" : s.claim === "changed" ? " · Bolu changed who found it" : "";
  return `<section class="scard"><h3 class="stitle">Your earnings</h3>
    <p class="ssub">You're paid when a shop you worked on pays for Tagbook. Helper (demo and setup): ₦1,500 when the shop first pays, ₦1,500 more from day 30 if it's still logging orders. Agent (found the shop): ₦3,000 once the shop has paid ₦6,000, plus ₦500 for each paid month, up to 12. Pay from a shop never goes above half of what that shop has paid; anything above that waits until it pays more.</p>
    <div class="dpay"><div><b>${naira(e.due)}</b><span>owed to you</span></div>${e.held ? `<div><b>${naira(e.held)}</b><span>waiting on shops</span></div>` : ""}<div><b>${naira(e.paid)}</b><span>paid so far</span></div></div>
    <div class="paybar"><i style="width:${e.ready ? 100 : pct}%"></i></div><p class="hint">${payLine}</p>
    ${(e.items || []).map(i => `<div class="staff-row"><div><b>${naira(i.amount)} · ${esc(i.shop)}</b><span>${esc(i.what)} · ${longDay(i.due_on)}</span></div><span class="pill ${i.status === "paid" ? "p-collected" : i.status === "held" ? "p-billed" : "p-ready"}">${i.status === "paid" ? "Paid" : i.status === "held" ? "Waiting" : "Owed"}</span></div>`).join("") || `<p class="hint">Nothing yet. You'll see money here once a shop you worked on starts paying.</p>`}
    ${bankHtml(e)}
    ${(e.shops || []).length ? `<h3 class="stitle" style="margin-top:14px">Your shops</h3>${e.shops.map(s => `<div class="staff-row"><div><b>${esc(s.name)}</b><span>${role(s)}${claim(s)}</span></div><span class="pill ${s.paying ? "p-ready" : "p-billed"}">${s.paying ? "Paying" : "On trial"}</span></div>`).join("")}` : ""}
  </section>`;
}
function bankHtml(e) {
  const b = e.bank;
  if (b && !bankEdit) return `<h3 class="stitle" style="margin-top:14px">Where we pay you</h3>
    <div class="staff-row"><div><b>${esc(b.no)} · ${esc(b.bank)}</b><span>${esc(b.name)}</span></div><button class="btn btn-ghost" id="bk-edit" style="width:auto;margin:0;padding:9px 14px">Change</button></div>`;
  return `<h3 class="stitle" style="margin-top:14px">Where we pay you</h3>
    <p class="hint">${b ? "Bolu gets a message when you change this." : "Add the account we should send your money to."}</p>
    <label for="bk-b">Bank</label><input id="bk-b" list="banks-agent" placeholder="Start typing, e.g. Opay or GTBank" autocomplete="off" value="${esc(b ? b.bank : "")}">${bankList("banks-agent")}
    <label for="bk-n">Account number</label><input id="bk-n" type="text" inputmode="numeric" maxlength="10" placeholder="10 digits" autocomplete="off" value="${esc(b ? b.no : "")}">
    <label for="bk-a">Account name</label><input id="bk-a" placeholder="Name on the account" autocomplete="off" value="${esc(b ? b.name : "")}">
    <div class="row">${b ? `<button class="btn btn-ghost" id="bk-no">Cancel</button>` : ""}<button class="btn btn-primary" id="bk-go">Save bank details</button></div>`;
}
function wireBank() {
  if ($("#bk-edit")) $("#bk-edit").onclick = () => { bankEdit = true; renderAgent(); };
  if ($("#bk-no")) $("#bk-no").onclick = () => { bankEdit = false; renderAgent(); };
  if (!$("#bk-go")) return;
  $("#bk-go").onclick = async () => {
    const bank = $("#bk-b").value.trim(), no = digits($("#bk-n").value), name = $("#bk-a").value.trim();
    if (!bank || !name) return toast("Fill in the bank and the account name.");
    if (!/^\d{10}$/.test(no)) return toast("The account number must be 10 digits.");
    $("#bk-go").disabled = true;
    const { error } = await sb.rpc("set_my_bank", { p_bank: bank, p_no: no, p_name: name });
    if (error) { $("#bk-go").disabled = false; return toast("Not saved. Check your internet and try again."); }
    myEarn = { ...myEarn, bank: { bank, no, name } }; bankEdit = false; toast("Bank details saved"); renderAgent();
  };
}
function renderAgent() {
  if (!isAgent) return go("orders");
  if (!myEarnBusy) { myEarnBusy = true; sb.rpc("my_earnings").then(({ data, error }) => { myEarnBusy = false; if (!error && data && JSON.stringify(data) !== JSON.stringify(myEarn)) { myEarn = data; if (tab === "agent") keepTyped(renderAgent); } }).catch(() => { myEarnBusy = false; }); }
  view.innerHTML = `<h2 class="ptitle">Set up shops</h2>${earningsHtml()}<p class="hint" style="margin-top:0">Shops you set up appear below. The free trial is 1 month.</p>` + shopsHtml(); wireShops(); wireBank();
}
const isoDay = d => d.toISOString().slice(0, 10);
function shopsHtml() {
  const trial = (() => { const x = new Date(); x.setMonth(x.getMonth() + 1); return isoDay(x); })();
  const done = newShop ? card("Shop created", "Send the owner their login. Tell them the PIN in person if you can.",
      `<div class="wa" id="nsmsg">${esc(newShop.msg)}</div>
       <a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234${newShop.phone.slice(1)}?text=${encodeURIComponent(newShop.msg)}">Send on WhatsApp</a>
       <div class="row"><button class="btn btn-ghost" id="nscopy">Copy</button><button class="btn btn-ghost" id="nsagain">Add another shop</button></div>`) : "";
  const form = newShop ? "" : card("Add a shop", "Creates the shop with the standard price list. The owner can change prices, add branches and staff in their own Settings.",
      `<label for="as-n">Shop name</label><input id="as-n" placeholder="e.g. Saheed Dry Cleaners" autocomplete="off" maxlength="${NAME_MAX}"><p class="hint">Up to ${NAME_MAX} letters. It shows at the top of their app and on every bill, so shorter reads better ("&amp;" instead of "and", no "services").</p>
       <label for="as-b">Branches</label><input id="as-b" placeholder="Main branch" autocomplete="off"><p class="hint">Separate with commas, e.g. Main branch, Awule point, Oke-Ijebu point.</p>
       <div class="sgrid"><div><label for="as-on">Owner's name</label><input id="as-on" placeholder="e.g. Saheed" autocomplete="off" maxlength="40"></div>
       <div><label for="as-op">Owner's phone</label><input id="as-op" type="text" inputmode="tel" placeholder="0803 412 7790" autocomplete="off"></div>
       <div><label for="as-pin">6-digit PIN for the owner</label><input id="as-pin" class="pin" ${genPinAttrs()}></div></div>
       <div class="sgrid">${agentMode() ? "" : `<div><label for="as-t">Free trial ends</label><input id="as-t" type="date" value="${trial}"></div>`}
       <div><label for="as-no">First order number</label><input id="as-no" ${moneyAttrs} value="1"><p class="hint">Use their book's next number if they want to continue it.</p></div></div>
       ${agentMode() ? `<label for="as-cf">Who found this shop?</label><select id="as-cf"><option value="ordiventa">Ordiventa sent me to this shop</option><option value="self">I found it myself</option>${(teamOpts || []).filter(t => t.id !== (me && me.user_id)).map(t => `<option value="${t.id}">${esc(t.name)} found it</option>`).join("")}</select>
       <p class="hint">You are the helper for every shop you set up. If you say you or someone else found it, Bolu checks before any agent pay.</p>`
       : `<div class="sgrid"><div><label for="as-ab">Agent (found the shop)</label><select id="as-ab"><option value="">Ordiventa (no agent pay)</option>${(teamOpts || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div>
       <div><label for="as-as">Helper (demo and setup)</label><select id="as-as"><option value="">Ordiventa (no helper pay)</option>${(teamOpts || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div></div>`}
       <label for="as-r">Referred by</label><select id="as-r"><option value="">Nobody (we found them)</option>${(refOpts || []).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>
       <p class="hint">The shop that brought them gets 1 free month once this shop pays.</p>
       <button class="btn btn-primary" id="as-go">Create shop</button>`);
  const list = card(agentMode() ? "Shops you set up" : "All shops", "", shopRows === null ? `<p class="hint">Loading…</p>` : !shopRows.length ? `<p class="hint">No shops yet.</p>`
      : shopRows.map(r => `<div class="staff-row"><div><b>${esc(r.name)}</b><span>${esc(r.owner_name || "")} · ${fmtPhone(r.owner_phone || "")} · ${r.staff} login${r.staff === 1 ? "" : "s"}</span>
        <span>${r.orders} order${r.orders === 1 ? "" : "s"}${r.last_order ? ` · last ${fmtDay(Date.parse(r.last_order))}` : ""}${r.trial_ends ? ` · trial ends ${fmtDay(Date.parse(r.trial_ends))}` : ""}</span>
        ${r.referred_by_name || r.referrals ? `<span class="refline">${r.referred_by_name ? `Referred by ${esc(r.referred_by_name)}` : ""}${r.referred_by_name && r.referrals ? " · " : ""}${r.referrals ? `Brought ${r.referrals} shop${r.referrals === 1 ? "" : "s"}` : ""}</span>` : ""}</div></div>`).join(""));
  return done + form + list;
}
async function loadShops() {
  const [a, b, c] = await Promise.all([sb.rpc(agentMode() ? "agent_shops" : "admin_shops"), sb.rpc("agent_ref_options"), sb.rpc("team_options")]);
  shopRows = a.data || []; refOpts = b.data || []; teamOpts = c.data || [];
  if (agentMode() || (tab === "prices" && setTab === "shops")) keepTyped(rerenderShops);
}
function wireShops() {
  if (shopRows === null) loadShops();
  if ($("#nscopy")) $("#nscopy").onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(newShop.msg) : Promise.reject()).then(() => toast("Copied")).catch(() => toast("Select the message and copy it")); };
  if ($("#nsagain")) $("#nsagain").onclick = () => { newShop = null; rerenderShops(); };
  if ($("#as-no")) moneyInput($("#as-no"), () => { });
  if (!$("#as-go")) return;
  $("#as-go").onclick = async () => {
    const shopName = tidy($("#as-n").value), owner = tidy($("#as-on").value), phone = digits($("#as-op").value), pin = digits($("#as-pin").value);
    const branches = $("#as-b").value.split(",").map(x => x.trim()).filter(Boolean);
    const err = !shopName ? "Type the shop name." : shopName.length > NAME_MAX ? `Shop name is too long. Keep it to ${NAME_MAX} letters.` : !owner ? "Type the owner's name." : !/^0\d{10}$/.test(phone) ? "The owner's phone must be 11 digits and start with 0." : pin.length !== 6 ? "The PIN must be 6 digits." : "";
    if (err) { toast(err); return; }
    $("#as-go").disabled = true; $("#as-go").textContent = "Creating…";
    const r = await callAdmin({ action: "create_shop", shop: shopName, branches, owner: { name: owner, phone, pin }, trial_ends: $("#as-t") ? $("#as-t").value || null : null, start_no: num($("#as-no").value) || 1, founding: $("#as-f") ? $("#as-f").checked : true, referred_by: $("#as-r").value || null,
      ...(agentMode() ? (v => v === "ordiventa" || v === "self" ? { claim_kind: v } : { claim_kind: "team", claim_for: v })($("#as-cf").value) : { brought_by: $("#as-ab").value || null, setup_by: $("#as-as").value || null }) });
    if (!r.ok) { toast(r.msg); $("#as-go").disabled = false; $("#as-go").textContent = "Create shop"; return; }
    const installVid = ((tuts || []).find(t => t.step_key === "install") || {}).youtube_id || "chuV8thnvrE";
    newShop = { phone, msg: `Your Tagbook is ready, ${owner.split(" ")[0]}.\n\nOpen this link on your phone: tagbook.ordiventa.com\nPhone: ${phone}\nPIN: ${pin}\n\nTip: add it to your Home Screen so it opens like an app. You can change your PIN in Settings.\n\nThis short video shows how to put Tagbook on your phone so it opens like an app: https://youtu.be/${installVid}\n\nOnce you log in, a short checklist will guide you through the rest.\n\nIf you get stuck, just message us here.\n\nWelcome, and thank you for starting with us.` };
    shopRows = null; rerenderShops();
  };
}

/* Price list: a table on a laptop, a short list on a phone where you tap an item to change it */
// Read-only price list for staff, so they can answer "how much?" at the counter.
function staffPriceHtml() {
  const all = PRICES.filter(x => !x.custom && !x.hidden && Object.keys(x.p || {}).some(k => x.p[k] != null));
  if (!all.length) return "";
  const q = priceQ.trim().toLowerCase();
  const list = q ? all.filter(x => x.name.toLowerCase().includes(q)) : all;
  const line = x => Object.keys(SERVICES).filter(k => x.p[k] != null).map(k => `${shortSvc[k]} ${naira(x.p[k])}`).join(" · ");
  return card("Price list", "To answer customers. Only the owner can change prices.",
    `${all.length > 8 ? `<input class="search" id="spq" placeholder="Search items" value="${esc(priceQ)}" aria-label="Search items" style="margin:4px 0 10px">` : ""}
     <div class="plist">${list.length ? list.map(x => `<div class="pli ro"><b>${esc(x.name)}</b><span>${line(x)}</span></div>`).join("") : `<p class="hint">No item matches “${esc(priceQ)}”.</p>`}</div>`);
}
function priceListHtml() {
  const all = PRICES.filter(x => !x.custom && !x.hidden);
  const q = priceQ.trim().toLowerCase();
  const list = q ? all.filter(x => x.name.toLowerCase().includes(q)) : all;
  const cell = (x, k) => `<input data-pp="${x.id}" data-k="${k}" ${moneyAttrs} value="${x.p[k] != null ? x.p[k] : ""}" placeholder="—" aria-label="${esc(x.name)}, ${SERVICES[k]}">`;
  const editor = x => `<div class="pedit">
      <label for="pn-${x.id}">Item name</label><input id="pn-${x.id}" data-pn="${x.id}" value="${esc(x.name)}" autocomplete="off">
      <div class="pgrid">${Object.entries(SERVICES).map(([k, l]) => `<div><label for="pp-${x.id}-${k}">${l} (₦)</label><input id="pp-${x.id}-${k}" data-pp="${x.id}" data-k="${k}" ${moneyAttrs} value="${x.p[k] != null ? x.p[k] : ""}" placeholder="Not offered"></div>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="mini danger" data-prm="${x.id}">Remove item</button><button class="mini" data-pclose>Done</button></div></div>`;
  const summary = x => Object.keys(SERVICES).filter(k => x.p[k] != null).map(k => `${shortSvc[k]} ${naira(x.p[k])}`).join(" · ") || "No prices yet";
  const rows = wide.matches
    ? `<div class="ptable" role="table"><div class="ph" role="row"><span>Item</span>${Object.values(SERVICES).map(l => `<span>${l}</span>`).join("")}<span></span></div>
        ${list.map(x => `<div class="pr" role="row"><input data-pn="${x.id}" value="${esc(x.name)}" autocomplete="off" aria-label="Item name">${Object.keys(SERVICES).map(k => cell(x, k)).join("")}<button class="plink" data-prm="${x.id}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join("")}</div>`
    : `<div class="plist">${list.map(x => priceOpen === x.id ? `<div class="pli open">${editor(x)}</div>`
        : `<button class="pli" data-popen="${x.id}"><b>${esc(x.name)}</b><span>${summary(x)}</span></button>`).join("")}</div>`;
  return card("Price list", `${all.length} item${all.length === 1 ? "" : "s"}. ${wide.matches ? "Click any name or price to change it." : "Tap an item to change it."} Leave a price empty if you don't offer that service. Saved bills keep their prices.`,
      `${all.length > 8 ? `<input class="search" id="pq" placeholder="Search items" value="${esc(priceQ)}" aria-label="Search items" style="margin:4px 0 10px">` : ""}
       ${list.length ? rows : `<p class="hint">No item matches “${esc(priceQ)}”.</p>`}`)
    + (!addOpen ? `<button class="btn btn-ghost" id="addopen">+ Add an item</button><p class="hint">Special items, like a wedding gown, get their price when you make the bill.</p>`
    : card("Add an item", "Special items, like a wedding gown, get their price when you make the bill.",
      `<label for="ni">Item name</label><input id="ni" placeholder="e.g. Curtain (per panel)" autocomplete="off">
       <div class="pgrid">${Object.entries(SERVICES).map(([k, l]) => `<div><label for="na-${k}">${l} (₦)</label><input id="na-${k}" data-na="${k}" ${moneyAttrs} placeholder="Not offered"></div>`).join("")}</div>
       <div class="row"><button class="btn btn-ghost" id="addclose">Cancel</button><button class="btn btn-primary" id="nadd">Add to price list</button></div>`));
}
function wirePrices() {
  const savePrice = async x => {
    x.services = Object.keys(SERVICES).filter(k => x.p[k] != null);
    const a = await put("items", { id: x.id }, { name: x.name, services: x.services });
    const { error } = await sb.from("item_prices").upsert({ item_id: x.id, shop_id: shop.id, prices: x.p });
    if (error) { toast(failMsg(error)); refresh(); return; }
    savedToast(a);
  };
  const pq = $("#pq"); if (pq) pq.oninput = e => { priceQ = e.target.value; const p = e.target.selectionStart; renderSettings(); const n = $("#pq"); n.focus(); n.setSelectionRange(p, p); };
  view.querySelectorAll("[data-popen]").forEach(b => b.onclick = () => { priceOpen = b.dataset.popen; renderSettings(); });
  view.querySelectorAll("[data-pclose]").forEach(b => b.onclick = () => { priceOpen = null; renderSettings(); });
  view.querySelectorAll("[data-pn]").forEach(i => i.onchange = () => { const x = item(i.dataset.pn); const v = i.value.trim().slice(0, 40); if (!v) { i.value = x.name; return; } x.name = v; savePrice(x); });
  view.querySelectorAll("[data-pp]").forEach(i => { moneyInput(i, () => { }); i.onchange = () => { const x = item(i.dataset.pp); x.p = { ...x.p, [i.dataset.k]: i.value === "" ? null : num(i.value) }; savePrice(x); }; });
  view.querySelectorAll("[data-prm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = wide.matches ? "Sure?" : "Tap again to remove"; return; } const x = item(b.dataset.prm); x.hidden = true; priceOpen = null; renderSettings(); if (await put("items", { id: x.id }, { hidden: true })) toast("Item removed from the price list"); });
  if ($("#addopen")) { $("#addopen").onclick = () => { addOpen = true; renderSettings(); $("#ni").focus(); }; return; }
  $("#addclose").onclick = () => { addOpen = false; renderSettings(); };
  view.querySelectorAll("[data-na]").forEach(i => moneyInput(i, () => { }));
  $("#nadd").onclick = async () => {
    const n = $("#ni").value.trim(); if (!n) { toast("Type the item name first"); $("#ni").focus(); return; }
    const pr = {}; let any = false; view.querySelectorAll("[data-na]").forEach(i => { pr[i.dataset.na] = i.value === "" ? null : num(i.value); if (i.value !== "") any = true; });
    if (!any) { toast("Set a price for at least one service"); return; }
    $("#nadd").disabled = true;
    const sort = Math.max(0, ...PRICES.filter(x => !x.custom).map(x => x.sort)) + 1;
    const { data, error } = await sb.from("items").insert({ shop_id: shop.id, name: n.slice(0, 40), services: Object.keys(pr).filter(k => pr[k] != null), sort }).select("id").single();
    if (error) { toast(failMsg(error)); $("#nadd").disabled = false; return; }
    const r2 = await sb.from("item_prices").insert({ item_id: data.id, shop_id: shop.id, prices: pr });
    if (r2.error) toast(failMsg(r2.error)); else toast(`${n} added`);
    addOpen = false; await load(); renderSettings();
  };
}
function exampleExpress() { return `Example: a ${naira(5000)} order marked express delivery costs ${naira(5000 + expressFor(5000))}.`; }

/* ---------- Login: remembers who used this phone; number pad for phone and PIN ---------- */
const LAST_KEY = "tb-last";
const lastUser = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (_) { return null; } };
const saveLast = v => { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch (_) { } };
const ART_MACHINE = `<svg class="art machine" viewBox="0 0 200 200" aria-hidden="true">
  <circle cx="100" cy="104" r="92" fill="var(--accent-soft)"/>
  <circle class="bub b1" cx="34" cy="70" r="7" fill="none" stroke="var(--accent)" stroke-width="2.5" opacity=".5"/>
  <circle class="bub b2" cx="170" cy="58" r="5" fill="none" stroke="var(--accent)" stroke-width="2.5" opacity=".45"/>
  <circle class="bub b3" cx="164" cy="150" r="8" fill="none" stroke="var(--accent)" stroke-width="2.5" opacity=".35"/>
  <rect x="50" y="36" width="100" height="132" rx="14" fill="var(--card)" stroke="var(--accent-deep)" stroke-width="3.5"/>
  <line x1="50" y1="62" x2="150" y2="62" stroke="var(--accent-deep)" stroke-width="3"/>
  <circle cx="66" cy="49" r="4.5" fill="var(--accent)"/><circle cx="80" cy="49" r="4.5" fill="var(--accent-soft)" stroke="var(--accent-deep)" stroke-width="2"/>
  <rect x="112" y="45" width="26" height="8" rx="4" fill="var(--accent-soft)" stroke="var(--accent-deep)" stroke-width="2"/>
  <circle cx="100" cy="113" r="36" fill="var(--accent-soft)" stroke="var(--accent-deep)" stroke-width="3.5"/>
  <g class="drum"><circle cx="100" cy="113" r="27" fill="var(--card)"/>
    <path d="M73 118c9-7 18 7 27 0s18 7 27 0v6a27 27 0 0 1-54 0z" fill="var(--accent)" opacity=".85"/>
    <path d="M86 98h10M104 92l7 5" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity=".6"/></g>
  <rect x="62" y="160" width="12" height="8" rx="3" fill="var(--accent-deep)"/><rect x="126" y="160" width="12" height="8" rx="3" fill="var(--accent-deep)"/>
</svg>`;
const loadingHtml = (msg) => `<div class="loading washing"><div class="lart big">${ART_MACHINE}</div><p>${msg}</p></div>`;
let L = null;
function confirmPin(st) {
  $("#app").classList.remove("is-loading"); $("#app").hidden = true; $("#tabsnav").hidden = true;
  L = { step: "pin", phone: st.phone, pin: "", err: "", busy: false, help: false, last: { name: st.name, phone: st.phone }, confirm: true };
  drawLogin();
}
function showLogin(msg) {
  me = null;
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = true; $("#tabsnav").hidden = true; $("#sheet").hidden = true; document.body.classList.remove("has-sheet");
  const last = lastUser();
  L = { step: last ? "pin" : "phone", phone: last ? last.phone : "", pin: "", err: msg || "", busy: false, help: false, last };
  drawLogin();
}
function drawLogin() {
  const box = $("#login"); box.hidden = false;
  const pinStep = L.step === "pin";
  const boxes = pinStep
    ? `<div class="pinboxes${L.err && !L.pin ? " shake" : ""}" aria-label="PIN, ${L.pin.length} of 6 digits entered">${[0, 1, 2, 3, 4, 5].map(i => `<span class="pb ${i < L.pin.length ? "full" : ""} ${i === L.pin.length ? "cur" : ""}"></span>`).join("")}</div>`
    : `<div class="phonebox ${L.phone ? "" : "empty"}" aria-live="polite">${L.phone ? fmtPhone(L.phone) : "0803 412 7790"}</div>`;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  box.innerHTML = `<div class="lwrap">
    <aside class="lside"><div class="lart">${ART_MACHINE}</div>
      <p class="lbrand">Tagbook</p><p class="ltag">Every cloth, accounted for.</p></aside>
    <main class="lmain">
      <button class="lhelp" id="lhelp" aria-label="Help" aria-expanded="${L.help}">?</button>
      <div class="lart small">${ART_MACHINE}</div>
      ${L.confirm ? `<p class="lhi">One quick safety step,</p><h1 class="lname">${esc(L.last.name)}</h1>`
        : pinStep && L.last ? `<p class="lhi">Welcome back,</p><h1 class="lname">${esc(L.last.name)}</h1>${L.last.shop ? `<p class="lshop">${esc(L.last.shop)}</p>` : ""}`
        : `<h1 class="lname">${pinStep ? "Enter your PIN" : "Welcome to Tagbook"}</h1>`}
      <p class="lask">${L.confirm ? "Enter your PIN once to switch on Tagbook's new login protection. You only do this once." : pinStep ? (L.last ? "Enter your 6-digit PIN to continue" : `PIN for ${fmtPhone(L.phone)}`) : "Enter your phone number"}</p>
      ${L.help ? `<p class="lhelptext">Forgot your PIN? Ask the shop owner to set a new one in Settings.${pinStep && !L.confirm ? ` <button class="llink" id="lswitch">Log in with a different number</button>` : ""}</p>` : ""}
      ${boxes}
      <p class="lerr" role="alert">${esc(L.err)}</p>
      <div class="keypad">${keys.map(k => k === "" ? `<span></span>` : k === "back"
        ? `<button class="key" data-k="back" aria-label="Delete"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6zM12 10l4 4m0-4-4 4"/></svg></button>`
        : `<button class="key" data-k="${k}" ${L.busy ? "disabled" : ""}>${k}</button>`).join("")}</div>
      ${!pinStep ? `<button class="btn btn-primary lgo" id="lgo" ${L.phone.length === 11 ? "" : "disabled"}>Continue</button>`
        : L.confirm ? `<p class="lfoot"><button class="llink" id="llater">Not now</button></p>`
        : L.last ? "" : `<p class="lfoot"><button class="llink" id="lswitch">Change phone number</button></p>`}
      ${L.busy ? `<p class="lbusy">${L.confirm ? "Checking…" : "Logging in…"}</p>` : ""}
      <p class="lpriv"><a href="/privacy">Privacy policy</a></p>
    </main></div>`;
  box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => press(b.dataset.k));
  $("#lhelp").onclick = () => { L.help = !L.help; drawLogin(); };
  if ($("#lgo")) $("#lgo").onclick = () => next();
  if ($("#llater")) $("#llater").onclick = () => { try { sessionStorage.setItem("tb-pin-later", "1"); } catch (_) { } L = null; start(); };
  if ($("#lswitch")) $("#lswitch").onclick = () => { if (L.last) { try { localStorage.removeItem(LAST_KEY); } catch (_) { } } L = { step: "phone", phone: "", pin: "", err: "", busy: false, help: false, last: null }; drawLogin(); };
}
function press(k) {
  if (!L || L.busy) return;
  if (L.step === "phone") {
    if (k === "back") L.phone = L.phone.slice(0, -1); else if (L.phone.length < 11) L.phone += k;
    L.err = ""; drawLogin(); return;
  }
  if (k === "back") L.pin = L.pin.slice(0, -1); else if (L.pin.length < 6) L.pin += k;
  L.err = ""; drawLogin();
  if (L.pin.length === 6) tryLogin();
}
function next() {
  if (!/^0\d{10}$/.test(L.phone)) { L.err = "Type your 11-digit phone number, starting with 0."; drawLogin(); return; }
  L.step = "pin"; L.pin = ""; L.err = ""; drawLogin();
}
const waitWords = s => { const m = Math.ceil(s / 60); return m >= 60 ? `${Math.ceil(m / 60)} hour${m > 60 ? "s" : ""}` : `${m} minute${m === 1 ? "" : "s"}`; };
async function tryLogin() {
  L.busy = true; drawLogin();
  let res = null, code = "";
  try {
    const r = await fetch(`${SB_URL}/functions/v1/login`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ phone: L.phone, pin: L.pin }) });
    res = await r.json().catch(() => ({})); code = r.ok ? "" : (res.error || "TRY_LATER");
  } catch (_) { code = "NETWORK"; }
  if (!code) { const { error } = await sb.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token }); if (error) code = "TRY_LATER"; }
  L.busy = false;
  if (code) {
    L.pin = "";
    L.err = code === "NETWORK" ? "Can't reach Tagbook. Check your internet and try again."
      : code === "LOCKED" ? `Too many wrong PINs. For your safety, wait ${waitWords(res.wait || 900)} and try again, or ask your shop owner for a new PIN.`
      : code === "BAD_LOGIN" ? "Wrong phone number or PIN. Try again."
      : "Tagbook is busy. Try again in a minute.";
    drawLogin(); if (navigator.vibrate) try { navigator.vibrate(120); } catch (_) { }
    return;
  }
  await start();
}
document.addEventListener("keydown", e => {
  if (!L || $("#login").hidden) return;
  if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
  else if (e.key === "Backspace") { press("back"); e.preventDefault(); }
  else if (e.key === "Enter" && L.step === "phone") { next(); e.preventDefault(); }
});

// A saved login stays until the person logs out or the owner removes them. A weak or missing
// connection must never look like being logged out: show "can't reach" with a retry instead.
const hasSavedLogin = () => { try { return !!localStorage.getItem("tagbook-auth"); } catch (_) { return false; } };
function cantReach(msg) {
  $("#app").classList.remove("is-loading");
  $("#login").hidden = true; $("#app").hidden = false;
  view.innerHTML = `<div class="loading" style="flex-direction:column;gap:14px;text-align:center">${msg}<button class="btn btn-primary" id="retry" style="max-width:220px">Try again</button></div>`;
  $("#retry").onclick = () => start();
}
async function start() {
  view.innerHTML = loadingHtml("Loading your shop…"); $("#app").classList.add("is-loading"); $("#app").hidden = false; $("#login").hidden = true;
  const timeout = new Promise(r => setTimeout(() => r({ data: null, error: new Error("timeout") }), 9000));
  const { data, error: se } = await Promise.race([sb.auth.getSession(), timeout]);
  const user = data && data.session && data.session.user;
  if (!user) {
    if (hasSavedLogin() && (se || !navigator.onLine)) return cantReach("Can't reach Tagbook. Check your internet and try again.");
    return showLogin();
  }
  const { data: st, error } = await sb.from("staff").select("user_id,shop_id,role,name,phone,active").eq("user_id", user.id).maybeSingle();
  if (error) {
    if (/JWT|token|401/i.test(error.message || "") ) { const r = await sb.auth.refreshSession(); if (!r.error) return start(); }
    return cantReach("Can't reach Tagbook. Check your internet and try again.");
  }
  if (!st || !st.active) { await sb.auth.signOut(); return showLogin("This login has been removed. Ask the shop owner."); }
  // Accounts made before the PIN lockout still have the old password until the person types their PIN once.
  // Ask them once (they can say "Not now"; we ask again next time they open Tagbook).
  let later = false; try { later = sessionStorage.getItem("tb-pin-later") === "1"; } catch (_) { }
  if (!later && !(L && L.confirm) && st.phone) {
    const fresh = await sb.auth.getUser().catch(() => null);
    const u = fresh && fresh.data && fresh.data.user;
    if (u && !(u.app_metadata && u.app_metadata.pin_v2)) return confirmPin(st);
  }
  me = st; role = st.role === "owner" ? "own" : "sec";
  try { const r = await sb.rpc("is_platform_admin"); isAdmin = r.data === true; } catch (_) { isAdmin = false; }
  try { const r = await sb.rpc("is_agent"); isAgent = !isAdmin && r.data === true; } catch (_) { isAgent = false; }
  $("#login").hidden = true; L = null;
  try { await load(); } catch (e) { return cantReach("Can't load your shop. Check your internet and try again."); }
  saveLast({ phone: st.phone, name: st.name, shop: shop.name });
  reset(); subscribe(); route(); syncPush(); checkPaystackReturn();
}

(async function boot() {
  $("#offline").hidden = navigator.onLine !== false;
  if (!hasSavedLogin()) return showLogin();
  await start();
})();
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && me && !hasSavedLogin()) { location.hash = ""; location.reload(); } });

/* ---------- Phones: #app is the scroll area (see extra.css). If the keyboard nudged the page, put it back. ---------- */
const mainScroll = () => window.matchMedia("(max-width: 899px)").matches ? document.getElementById("app") : document.scrollingElement;
document.addEventListener("focusout", () => setTimeout(() => { if (window.matchMedia("(max-width: 899px)").matches && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) window.scrollTo(0, 0); }, 150));
