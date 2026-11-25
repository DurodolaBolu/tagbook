/* Tagbook: the real app. Same screens as the approved demo, backed by Supabase. */
import { createClient } from "@supabase/supabase-js";
import MACHINE_SVG from "./machine.svg";

const SB_URL = "https://uungxatdvelljmaugzuz.supabase.co";
const SB_KEY = "sb_publishable_oE_-Yt6fovcOpIC01tnrpw_ueK-Zx7v";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "tagbook-auth" } });
// Logins are phone + 6-digit PIN, checked by the "login" server function, which counts wrong PINs
// and pauses a login after 5. The app never builds the real password itself.

const SERVICES = { wi: "Wash and iron", wo: "Wash only", io: "Iron only", wsi: "Wash, starch and iron", si: "Starch and iron" };
const newOpts = () => true; // order options are live for every shop (17 Nov 2026)
const STEPS = [["new", "Logged"], ["listed", "List sent"], ["ready", "Ready"], ["told", "Told"], ["picked", "Picked up"]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const naira = n => "₦" + Math.round(n || 0).toLocaleString("en-NG");
const fmtPhone = p => String(p || "").replace(/(\d{4})(\d{3})(\d{4})/, "$1 $2 $3");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const digits = v => String(v ?? "").replace(/\D/g, "");
const num = v => +digits(v) || 0;
const fmtDay = ts => new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
// Collection date (shops that turn it on): time is optional, stored as midnight when not given.
const fmtCollect = ts => { const t = new Date(ts); return fmtDay(ts) + (t.getHours() || t.getMinutes() ? ", " + t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(":00", "") : ""); };
const localDate = ts => { const t = new Date(ts); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const localTime = ts => { const t = new Date(ts); return t.getHours() || t.getMinutes() ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : ""; };
const collectIso = (date, time) => date ? new Date(`${date}T${time || "00:00"}`).toISOString() : null;
const speedLabel = o => o.wait ? "wait & get" : o.express ? "express delivery" : "";
const moneyAttrs = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"';
function moneyInput(el, fn) { if (!el) return; el.addEventListener("input", () => { const c = digits(el.value); if (el.value !== c) el.value = c; fn(num(c)); }); }
const $ = s => document.querySelector(s);
const view = $("#view");
// Sideways-scrolling menus (order filters, Settings sections, lead cities and statuses) are redrawn on every tap,
// which used to jump them back to the start and hide the item just tapped. Keep the picked item in view, centred.
function showPicked(root) {
  root.querySelectorAll(".chips, .stabs").forEach(row => {
    if (row.scrollWidth <= row.clientWidth + 2) return;
    const pick = row.querySelector('[aria-pressed="true"], [aria-current="page"]');
    if (!pick) return;
    const r = row.getBoundingClientRect(), p = pick.getBoundingClientRect();
    row.scrollLeft = Math.max(0, row.scrollLeft + (p.left - r.left) - (r.width - p.width) / 2);
  });
}
new MutationObserver(() => showPicked(view)).observe(view, { childList: true });
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2800); }
const busy = () => { const a = document.activeElement; return !!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); };

/* ---------- State, loaded from the database ---------- */
let me = null, role = "sec", shop = null, priv = null, isAdmin = false, isAgent = false;
let BRANCHES = [], PRICES = [], customers = [], orders = [], cancelledOrders = [], staffList = [], expenses = [];
let tab = "orders", filter = "all", query = "", openNo = null, page = 0;
const PER_PAGE = 20;
const own = () => role === "own";
// Owner, or a staff member the owner allowed to send lists and bills and take payments (no discounts, no reports).
const canBill = () => own() || (!!me && !!me.can_bill && billLive());
const theme = () => { try { return localStorage.getItem("tb-theme") || "light"; } catch (_) { return "light"; } };
const shopName = () => (shop && shop.name.trim()) || "Your laundry";
const branchName = id => (BRANCHES.find(b => b.id === id) || {}).name || "";
const liveBranches = () => BRANCHES.filter(b => b.active);
// Long marks (existing tag numbers, up to 8) get a smaller badge so the name beside them keeps its room.
const markCls = m => String(m || "").length > 4 ? "mark long" : "mark";
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
// Sets the shop's price for one item and service (from the log screen or a bill), and ticks the prices step.
async function setPrice(id, svc, price) {
  const it = item(id); if (!it || !price) return false;
  const pr = { ...(it.p || {}), [svc]: price }, svcs = [...new Set([...(it.services || []), svc])];
  const { error } = await sb.from("item_prices").upsert({ item_id: id, shop_id: shop.id, prices: pr });
  if (error) { toast(failMsg(error)); return false; }
  if (!(it.services || []).includes(svc)) await put("items", { id }, { services: svcs });
  it.p = pr; it.services = svcs; markSetup("prices");
  return true;
}
const hasPrice = (id, svc) => { const it = item(id) || {}; return !!it.custom || !!(it.p || {})[svc]; };
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
const pname = it => (it.label || (item(it.id) || {}).name || "Item") + (it.note ? ` (${it.note})` : "");
// Pieces: a cloth charged as one but made of several pieces (a senator top and trouser = 2, a bed sheet with 5 pillow cases = 6).
const pcsOf = it => Math.max(1, +it.pcs || 1);
const pcsTag = it => pcsOf(it) > 1 ? `, ${it.qty * pcsOf(it)} pcs` : "";
const pieceCount = items => (items || []).reduce((s, it) => s + it.qty * pcsOf(it), 0);
const countTxt = o => { const n = o.items.reduce((s, it) => s + it.qty, 0), p = pieceCount(o.items); return `${n} item${n === 1 ? "" : "s"}${p > n ? `, ${p} pieces` : ""}`; };
const andList = a => a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " & " + a[a.length - 1];
// Who was on duty when the order was logged (names only, picked on the shop's phone each day).
// The cashier who prepares and sends the bill: whoever is on duty on this phone now, else whoever sent it last.
const billBy = o => (canBill() && typeof dutyNow === "function" && dutyNow() && dutyNow().by) || (o.duty && o.duty.bill) || "";
const dutyText = (o, bill) => { const u = o.duty || {}, w = (u.w || []).filter(Boolean), by = bill ? billBy(o) : u.by;
  return [by ? `${bill ? "Prepared by" : "Received by"} ${by}` : "", w.length ? `Laundry attendant${w.length > 1 ? "s" : ""}: ${andList(w)}` : ""].filter(Boolean).join("\n"); };
// When a bill goes out, remember which cashier sent it.
const stampBill = o => { const by = canBill() && dutyNow() && dutyNow().by; if (!by || !o || o.id === "sample" || (o.duty && o.duty.bill === by)) return; o.duty = { ...(o.duty || {}), bill: by }; put("orders", { id: o.id }, { duty: o.duty }); };
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
    sb.from("shops").select("id,name,created_at,is_test,staff_prices,collect_dates,wait_get_on,pay_token,crew").single(),
    fetchAll("branches", "id,name,sort,active", "sort"),
    fetchAll("items", "id,name,custom,services,sort,hidden,pieces", "sort"),
    fetchAll("customers", "id,name,mark,greet,greet_asked,inv_name"),
    fetchAll("orders", "id,no,customer_id,branch_id,pair_id,items,express,wait_get,pickup,collect_at,remarks,money_found,status,checking,checked,notified,billed,settled,list_sent,created_at,cancelled_at,cancelled_by,duty,track_token", "no"),
  ]);
  if (base[0].error) throw base[0].error;
  shop = base[0].data; BRANCHES = base[1]; customers = base[3];
  if (newOpts()) sb.from("shop_remarks").select("text").order("created_at").then(({ data }) => { if (data) shopRemarks = data.map(r => r.text); });
  loadPlan().then(() => { if (me && (tab === "orders" || tab === "new" || (tab === "prices" && setTab === "plan"))) render(); });
  let prices = {}, phones = {}, money = {};
  if (canBill()) {
    const [p, ip, ph, om, st] = await Promise.all([
      sb.from("shop_private").select("*").single(),
      fetchAll("item_prices", "item_id,prices"),
      fetchAll("customer_phones", "customer_id,phone"),
      fetchAll("order_money", "order_id,unit,custom,delivery,discount,total,billed_at,paid,payments,express_amt"),
      fetchAll("staff", "user_id,name,phone,role,created_at,can_bill", "created_at"),
    ]);
    if (p.error) throw p.error;
    priv = p.data; staffList = st;
    // Record that the owner uses the installed app, even if the checklist is hidden, so Bolu can see it.
    if (priv && standalone() && !(priv.setup || {}).installed) markSetup("installed");
    ip.forEach(r => prices[r.item_id] = r.prices);
    ph.forEach(r => phones[r.customer_id] = r.phone);
    om.forEach(r => money[r.order_id] = r);
    if (expOn()) { try { expenses = await fetchAll("expenses", "id,amount,kind,note,spent_on,created_by,created_at", "spent_on"); } catch (_) { expenses = []; } }
  } else if (shop.staff_prices) {
    (await fetchAll("item_prices", "item_id,prices")).forEach(r => prices[r.item_id] = r.prices);
  }
  PRICES = base[2].map(i => ({ ...i, p: prices[i.id] || {} }));
  customers.forEach(c => c.phone = phones[c.id] || "");
  const all = base[4].map(o => ({
    id: o.id, no: o.no, cid: o.customer_id, branch: o.branch_id, pair: o.pair_id || null, items: o.items || [], express: o.express, wait: !!o.wait_get, pickup: o.pickup, collect: o.collect_at ? Date.parse(o.collect_at) : 0, remarks: o.remarks || "", money: o.money_found || 0,
    status: o.status, checking: o.checking, checked: o.checked || {}, notified: o.notified, billed: o.billed, settled: o.settled, list_sent: o.list_sent,
    at: Date.parse(o.created_at), m: { ...emptyMoney(), ...(money[o.id] || {}) }, again: {},
    cancelled: o.cancelled_at ? Date.parse(o.cancelled_at) : 0, cancelled_by: o.cancelled_by || "", duty: o.duty || null, track: o.track_token || "",
  }));
  // Cancelled orders stay on record but are left out of every list, total and report.
  orders = all.filter(o => !o.cancelled); cancelledOrders = all.filter(o => o.cancelled);
}

/* ---------- Saving: change the screen first, then the database; on failure reload what is really saved ---------- */
function failMsg(e) {
  const m = (e && (e.message || e.error_description)) || "";
  if (/fetch|network|Failed to/i.test(m)) return "Not saved. Check your internet and try again.";
  if (/DISCOUNT_OWNER_ONLY/.test(m)) return "Only the owner can give a discount.";
  if (/PAYMENT_OWNER_ONLY/.test(m)) return "Only the owner can change a payment that is already recorded.";
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
  const tables = ["orders", "customers", "items", "branches", "shops"].concat(canBill() ? ["order_money", "customer_phones", "item_prices", "shop_private"] : shop.staff_prices ? ["item_prices"] : []);
  tables.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: t === "shops" ? `id=eq.${shop.id}` : `shop_id=eq.${shop.id}` }, refresh));
  channel.subscribe();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) refresh(); });

/* ---------- Money ---------- */
const sPriv = () => priv || { express_type: "manual", express_value: 0, wait_type: "manual", wait_value: 0, bank_name: "", acct_no: "", acct_name: "", inv_logo: "", inv_color: "", inv_tagline: "", inv_address: "", inv_phone: "", inv_email: "", inv_terms: "" };
const hasBank = () => { const p = sPriv(); return p.bank_name.trim() && p.acct_no.length === 10 && p.acct_name.trim(); };
const payTo = () => { const p = sPriv(); return hasBank() ? `\n\nPay by transfer to:\n${p.bank_name.trim()}\n${p.acct_no}\n${p.acct_name.trim()}\nPlease send your payment receipt here.` : ""; };
const expManual = () => sPriv().express_type === "manual";
// Express delivery and Wait & get each have their own charge setting; an order has one or the other, kept in express_amt.
const chargeFor = (sub, type, v) => type === "manual" ? 0 : type === "times" ? sub * Math.max(1, v) - sub : type === "percent" ? Math.round(sub * v / 100 / 50) * 50 : v;
const chargeLabel = (type, v) => type === "manual" ? "" : type === "times" ? ` (${v}× the bill)` : type === "percent" ? ` (+${v}%)` : ` (+${naira(v)})`;
function expressFor(sub) { const p = sPriv(); return chargeFor(sub, p.express_type, p.express_value); }
const expressLabel = () => { const p = sPriv(); return chargeLabel(p.express_type, p.express_value); };
const spName = o => o.wait ? "Wait & get" : "Express delivery";
// Shown under the order or invoice number in messages, so an express order is plain to the customer.
const spTag = o => o.wait ? "\nWait & get" : o.express ? "\n⚡ EXPRESS" : "";
const pairLine = o => { const q = partner(o); if (!q) return ""; const n = q.items.reduce((s, it) => s + it.qty, 0); return `\n\nAlso dropped with these: Order #${q.no}${q.express ? " (⚡ express)" : ""}, ${n} item${n === 1 ? "" : "s"}.`; };
const spManual = o => o.wait ? sPriv().wait_type === "manual" : expManual();
const spFor = (o, sub) => { const p = sPriv(); return o.wait ? chargeFor(sub, p.wait_type, p.wait_value) : expressFor(sub); };
const spLabel = o => { const p = sPriv(); return o.wait ? chargeLabel(p.wait_type, p.wait_value) : expressLabel(); };
function unitPrice(o, it, i) {
  if (o.m.unit && o.m.unit[i] != null) return o.m.unit[i];
  const p = item(it.id) || {};
  if (p.custom) return +o.m.custom[i] || 0;
  return (p.p && p.p[it.svc]) || 0;
}
function lockPrices(o) { o.m.unit = o.items.map((it, i) => (item(it.id) || {}).custom ? null : unitPrice({ ...o, m: { ...o.m, unit: null } }, it, i)); }
function calc(o) {
  const count = o.items.reduce((s, it) => s + it.qty, 0);
  if (!canBill()) return { sub: 0, exp: 0, total: 0, count };
  const sub = o.items.reduce((s, it, i) => s + unitPrice(o, it, i) * it.qty, 0);
  const exp = o.express || o.wait ? (spManual(o) || (o.billed && o.m.express_amt) ? (+o.m.express_amt || 0) : spFor(o, sub)) : 0;
  const total = Math.max(0, sub + exp + (+o.m.delivery || 0) - (+o.m.discount || 0));
  return { sub, exp, total, count };
}
const owed = o => canBill() ? (o.billed ? Math.max(0, o.m.total - o.m.paid) : 0) : (o.billed && !o.settled ? 1 : 0);

const MOON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g></svg>';
/* ---------- Ordiventa dashboard (platform admin only) ---------- */
let sendStats = [];
// Bolu's goal: 1,000 active shops (an order in the last 30 days) by 31 May 2027. Per month: sign-ups, and active shops by month end.
// Reset 16 Nov 2026 to a pace 2 people can hold now, growing as agents, referrals and self sign-up add shops from February.
// Each month: [sign-ups that month, active shops by month end]. About 6 in 10 sign-ups stay active.
const GOAL = { total: 1000, by: "31 Dec 2027", start: 0, months: {
  "2026-11": [45, 30], "2026-12": [70, 70], "2027-01": [70, 110], "2027-02": [85, 160], "2027-03": [100, 220], "2027-04": [120, 290],
  "2027-05": [135, 370], "2027-06": [135, 450], "2027-07": [150, 540], "2027-08": [150, 630], "2027-09": [170, 730], "2027-10": [170, 830],
  "2027-11": [150, 920], "2027-12": [135, 1000] } };
// The 1,000 goal in steps of 100, each with the date to reach it (from the monthly plan above).
const GOAL_STEPS = [[100, "2027-01-31"], [200, "2027-03-20"], [300, "2027-05-05"], [400, "2027-06-15"], [500, "2027-07-20"], [600, "2027-08-20"], [700, "2027-09-20"], [800, "2027-10-20"], [900, "2027-11-25"], [1000, "2027-12-31"]];
// Weekly team target, set 16 Nov 2026: 8 new active shops a week (about 4 each for Bolu and Tolu) keeps us on track for 100 by 31 Jan.
const WEEK_TARGET = 8, WEEK_CALLS = 8;
const stepDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// active = shops with an order in the last 30 days; signups = new shops this month. Shown to Bolu and the team.
function goalHtml(g) {
  const active = g.active, signups = g.signups;
  const now = new Date(Date.now() + 3600e3); // Lagos time
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), key = `${y}-${String(m + 1).padStart(2, "0")}`, t = GOAL.months[key];
  const pctAll = Math.min(100, Math.round(active / GOAL.total * 100));
  const todayIso = now.toISOString().slice(0, 10);
  const nextI = GOAL_STEPS.findIndex(([n]) => active < n), next = GOAL_STEPS[nextI];
  const ladder = `<ol class="gsteps">${GOAL_STEPS.map(([n, d], i) => { const done = active >= n, cur = i === nextI, late = !done && d < todayIso;
      return `<li class="${done ? "done" : cur ? "cur" : ""}${late ? " late" : ""}"><span class="gdot">${done ? TICK : ""}</span><b>${n.toLocaleString()}</b><span>${done ? "Reached" : `by ${stepDay(d)}`}</span></li>`; }).join("")}</ol>`;
  let nextLine = "";
  if (next) {
    const daysLeft = Math.max(1, Math.round((Date.parse(next[1] + "T23:00:00Z") - Date.now()) / 864e5)), gap = next[0] - active;
    const perWeek = Math.max(1, Math.round(gap / daysLeft * 7));
    nextLine = `<div class="gnext"><span>Next stop</span><b>${next[0].toLocaleString()} active shops by ${stepDay(next[1])}</b><p>${gap} more to go in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. That's about <b>${perWeek} new active shop${perWeek === 1 ? "" : "s"} a week</b>.</p></div>`;
  }
  let monthPart = "";
  if (t) {
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), day = now.getUTCDate(), left = days - day;
    const prevKey = Object.keys(GOAL.months).filter(k => k < key).pop(), prevActive = prevKey ? GOAL.months[prevKey][1] : GOAL.start;
    const signPace = Math.round(t[0] * day / days), actPace = Math.round(prevActive + (t[1] - prevActive) * day / days);
    const line = (label, got, goal, pace) => { const diff = got - pace;
      return `<div class="gline"><div class="gtop"><span>${label}</span><b>${got} <i>of ${goal}</i></b></div>
        <div class="gbar"><span style="width:${Math.min(100, Math.round(got / goal * 100))}%"></span><em style="left:${Math.min(100, Math.round(pace / goal * 100))}%"></em></div>
        <p class="${diff >= 0 ? "gok" : "glate"}">${diff >= 0 ? `On pace${diff ? `, ${diff} ahead` : ""}` : `Behind by ${-diff}. We should be at ${pace} today`}</p></div>`; };
    const month = new Date(Date.UTC(y, m, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
    const perDay = Math.max(1, Math.ceil(Math.max(0, t[0] - signups) / Math.max(1, left)));
    monthPart = `<h4>This month (${month}): ${left} day${left === 1 ? "" : "s"} left</h4>
      ${line("New shops signed up", signups, t[0], signPace)}
      ${line("Active shops by month end", active, t[1], actPace)}
      <p class="hint">That's about ${perDay} sign-up${perDay === 1 ? "" : "s"} a day for the rest of ${month}.</p>`;
  }
  return `<section class="scard dgoal">
    <h3 class="stitle">Our goal: ${GOAL.total.toLocaleString()} active shops by ${GOAL.by}</h3>
    <div class="gbar big"><span style="width:${Math.max(1, pctAll)}%"></span></div>
    <p class="ssub"><b>${active}</b> active shops now (${pctAll}%). Active means the shop logged clothes in the last 30 days.</p>
    ${g.week_active != null ? (() => { const dow = (now.getUTCDay() + 6) % 7, daysLeft = 7 - dow, got = g.week_active;
      return `<div class="gweek"><div class="gtop"><span>This week: new active shops</span><b>${got} <i>of ${WEEK_TARGET}</i></b></div>
        <div class="gbar"><span style="width:${Math.min(100, Math.round(got / WEEK_TARGET * 100))}%"></span></div>
        <p class="hint" style="margin:6px 0 0">${got >= WEEK_TARGET ? "Weekly target reached. Well done!" : `${WEEK_TARGET - got} more by Sunday (${daysLeft} day${daysLeft === 1 ? "" : "s"} left). That's about 4 each for Bolu and Tolu.`} ${g.week_signups} signed up this week; a shop counts once it logs its first clothes.</p></div>`; })() : ""}
    ${nextLine}
    <h4>The road to ${GOAL.total.toLocaleString()}, 100 at a time</h4>
    ${ladder}
    ${monthPart}
  </section>`;
}
let dSeg = "all", dQ = "", dOpen = null;
let dash = null, dashAt = 0, dashBusy = false, leads = [], leadForm = false, agents = [], agentForm = false, newAgent = null, nCopy = null, markFor = null, markPlan = 1, teamPay = [], editFor = null, payOpen = null, ologFor = null, ologDone = null;
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); if (m < 2) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago"; };
const daysTo = d => d ? Math.ceil((Date.parse(d + "T23:59:59") - Date.now()) / 864e5) : null;
async function loadDash() { if (dashBusy) return; dashBusy = true; try { const [{ data, error }, L, A] = await Promise.all([sb.rpc("admin_dashboard"), sb.from("ref_leads").select("*").order("created_at"), sb.rpc("admin_agents")]); if (!error) { dash = data || []; dashAt = Date.now(); } if (!L.error) leads = L.data || []; if (!A.error) agents = A.data || []; try { const T = await sb.rpc("admin_team_pay"); if (!T.error) teamPay = T.data || []; } catch (_) { } try { const B = await sb.rpc("admin_send_stats", { p_days: 30 }); if (!B.error) sendStats = B.data || []; } catch (_) { } try { const F = await sb.from("shop_followups").select("*"); if (!F.error) follows = Object.fromEntries((F.data || []).map(x => [x.shop_id, x])); } catch (_) { } } finally { dashBusy = false; } if (tab === "admin") keepTyped(renderAdmin); }
/* Quiet shops you've messaged leave "Call these shops" until the next follow-up is due:
   3 days after the first message, 7 days after that. Logging clothes again clears it. */
let follows = {};
function followState(r) {
  const f = follows[r.id]; if (!f) return null;
  if (r.last_order && Date.parse(r.last_order) > Date.parse(f.at)) return null; // they're logging again: start fresh
  const next = Date.parse(f.at) + (f.times >= 2 ? 7 : 3) * 864e5;
  return { times: f.times, at: f.at, next, waiting: Date.now() < next };
}
function markFollow(id) {
  const r = dash && dash.find(x => x.id === id); if (!r) return;
  const st = followState(r), row = { shop_id: id, at: new Date().toISOString(), times: st ? st.times + 1 : 1 };
  follows[id] = row;
  sb.from("shop_followups").upsert(row).then(({ error }) => { if (error) toast("Couldn't save the follow-up. Check your internet."); });
}
const daysLeft = d => d ? Math.round((Date.parse(String(d).slice(0, 10) + "T00:00:00Z") - Date.parse(lagosDay(Date.now()) + "T00:00:00Z")) / 864e5) : null;
const coveredUntil = r => [r.trial_ends, r.paid_until].filter(Boolean).sort().pop() || null;
const ownerPush = r => (r.owner_push != null ? r.owner_push : r.push) > 0;
// WhatsApp message asking an owner to turn on Tagbook alerts, with steps for iPhone and Android.
const alertsMsg = r => `Hello${(r.owner_name || "").split(/\s+/).find(w => w.length > 2) ? " " + (r.owner_name || "").split(/\s+/).find(w => w.length > 2) : ""}, this is Bolu from Tagbook. 😊\n\nPlease turn on Tagbook notifications, so your phone tells you when staff log clothes or mark them ready, even when the app is closed.\n\nHow to turn it on:\n1. Open Tagbook from your Home Screen (iPhone: if it's not there yet, open tagbook.ordiventa.com in Safari, tap Share, then "Add to Home Screen")\n2. Tap the ⚙️ at the top right\n3. Tap Account\n4. Tap "Turn on notifications" and choose Allow\n\nIt takes less than a minute. Thank you! 🙏`;
const waTo = (p, t) => "https://wa.me/234" + String(p || "").replace(/\D/g, "").replace(/^0/, "") + "?text=" + encodeURIComponent(t);
// Shop list segments on the admin dashboard, so Bolu doesn't scroll through every shop.
const D_SEGS = [["all", "All"], ["new", "New this week"], ["trial", "On trial"], ["paying", "Paying"], ["call", "Need a call"], ["alerts", "Alerts off"], ["noapp", "App not installed"]];
function inSeg(r, k) {
  if (k === "new") return Date.now() - Date.parse(r.created_at) < 7 * 864e5;
  if (k === "trial") return daysTo(r.trial_ends) >= 0 && !r.paid_total;
  if (k === "paying") return r.paid_total > 0;
  if (k === "call") return shopFlags(r).some(f => f[1] === "owes");
  if (k === "alerts") return !ownerPush(r);
  if (k === "noapp") return !r.installed;
  return true;
}
function shopFlags(r) {
  const f = [], age = (Date.now() - Date.parse(r.created_at)) / 864e5, left = daysTo(r.trial_ends);
  if (!r.orders && age > 1) f.push(["No orders yet, " + Math.floor(age) + " day" + (Math.floor(age) === 1 ? "" : "s") + " in", "owes"]);
  else if (!r.orders) f.push(["No orders yet", "warn"]);
  else if (r.last_order && Date.now() - Date.parse(r.last_order) > 3 * 864e5) f.push(["No orders for " + ago(r.last_order).replace(" ago", ""), "owes"]);
  const cov = coveredUntil(r), cl = daysLeft(cov);
  if (cl !== null && cl < 0) f.push([cl < -2 ? "Plan ended, orders paused" : "Plan ended, in 2-day grace", "owes"]);
  else if (cl !== null && cl <= 7) f.push([(r.paid_until && r.paid_until >= cov ? "Plan" : "Trial") + (cl === 0 ? " ends today" : " ends in " + cl + " day" + (cl === 1 ? "" : "s")), "warn"]);
  if (!r.staff) f.push(["No staff login", "warn"]);
  if (!r.installed) f.push(["App not installed", "warn"]);
  if (!ownerPush(r)) f.push(["Owner alerts off", "warn"]);
  return f;
}
let adminView = (() => { try { return localStorage.getItem("tb-admin-view") || "shops"; } catch (_) { return "shops"; } })();
const adminSeg = () => `<div class="aseg" role="tablist"><button data-av="shops" aria-pressed="${adminView === "shops"}">Shops</button><button data-av="leads" aria-pressed="${adminView === "leads"}">Leads</button><button data-av="replies" aria-pressed="${adminView === "replies"}">Replies</button></div>`;
function wireAdminSeg() { view.querySelectorAll("[data-av]").forEach(b => b.onclick = () => { adminView = b.dataset.av; try { localStorage.setItem("tb-admin-view", adminView); } catch (_) { } renderAdmin(); }); }

/* ---------- Replies: ready answers to questions shops ask, one tap to copy (admin only; new ones can be added here or by SQL) ---------- */
let qr = null, qrQ = "", qrTopic = "all", qrEdit = null, qrDel = null, qrBusy = false;
async function loadReplies() {
  if (qrBusy) return; qrBusy = true;
  try { const r = await sb.from("quick_replies").select("*").order("sort").order("created_at"); if (!r.error) qr = r.data || []; else qr = qr || []; }
  finally { qrBusy = false; }
  if (tab === "admin" && adminView === "replies") keepTyped(renderAdmin);
}
function replyForm(r) {
  const topics = [...new Set((qr || []).map(x => x.topic))];
  return `<section class="scard dlead"><h3 class="stitle">${r ? "Edit reply" : "Add a reply"}</h3>
    <label for="qr-q">Their question</label><input id="qr-q" maxlength="200" value="${r ? esc(r.question) : ""}" placeholder="e.g. Can I use it on 2 phones?" autocomplete="off">
    <label for="qr-t">Topic</label><input id="qr-t" maxlength="40" list="qr-topics" value="${r ? esc(r.topic) : ""}" placeholder="e.g. How it works" autocomplete="off"><datalist id="qr-topics">${topics.map(t => `<option value="${esc(t)}">`).join("")}</datalist>
    <label for="qr-a">Your answer</label><textarea id="qr-a" rows="7" maxlength="3000">${r ? esc(r.answer) : ""}</textarea>
    <div class="row"><button class="btn btn-ghost" id="qr-no">Cancel</button><button class="btn btn-primary" id="qr-go">${r ? "Save changes" : "Save reply"}</button></div></section>`;
}
function renderReplies() {
  if (qr === null) { loadReplies(); view.innerHTML = `${adminSeg()}<p class="hint">Loading replies…</p>`; wireAdminSeg(); return; }
  const topics = [...new Set(qr.map(x => x.topic))];
  if (qrTopic !== "all" && !topics.includes(qrTopic)) qrTopic = "all";
  const q = qrQ.trim().toLowerCase();
  const list = qr.filter(r => (qrTopic === "all" || r.topic === qrTopic) && (!q || (r.question + " " + r.answer + " " + r.topic).toLowerCase().includes(q)));
  view.innerHTML = `${adminSeg()}
    <div class="dtop"><div><h2 class="ptitle">Replies</h2><p class="hint">Answers to what shops ask. Tap Copy, then paste in WhatsApp.</p></div><div class="row"><button class="btn btn-ghost" id="qradd">+ Add a reply</button></div></div>
    ${qrEdit === "new" ? replyForm(null) : ""}
    <input id="qrq" class="search" placeholder="Search: price, staff, PIN…" value="${esc(qrQ)}" autocomplete="off">
    <div class="chips ochips">${[["all", "All", qr.length]].concat(topics.map(t => [t, t, qr.filter(r => r.topic === t).length])).map(([k, v, n]) => `<button class="chip" data-qt="${esc(k)}" aria-pressed="${qrTopic === k}">${esc(v)} <span class="n">${n}</span></button>`).join("")}</div>
    <div class="dlist">${list.map(r => qrEdit === r.id ? replyForm(r) : `<section class="olead qreply">
      <div class="ohead"><div><b>${esc(r.question)}</b><span>${esc(r.topic)}</span></div></div>
      <p class="qans">${esc(r.answer)}</p>
      <div class="oact"><button class="btn btn-primary" data-qcopy="${r.id}">Copy</button><span class="row"><button class="mini" data-qedit="${r.id}">Edit</button><button class="mini danger" data-qdel="${r.id}">${qrDel === r.id ? "Delete?" : "Delete"}</button></span></div>
    </section>`).join("") || `<p class="hint" style="margin-top:16px">${q ? "No reply matches that. Add it with + Add a reply." : "No replies yet."}</p>`}</div>`;
  wireAdminSeg();
  $("#qradd").onclick = () => { qrEdit = qrEdit === "new" ? null : "new"; renderAdmin(); if (qrEdit) $("#qr-q").focus(); };
  $("#qrq").oninput = e => { qrQ = e.target.value; clearTimeout(window.__qrT); window.__qrT = setTimeout(() => { const pos = e.target.selectionStart; renderAdmin(); const el = $("#qrq"); el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { } }, 250); };
  view.querySelectorAll("[data-qt]").forEach(b => b.onclick = () => { qrTopic = b.dataset.qt; renderAdmin(); });
  view.querySelectorAll("[data-qcopy]").forEach(b => b.onclick = async () => {
    const r = qr.find(x => x.id === b.dataset.qcopy); if (!r) return;
    if (!(await copyText(r.answer))) return toast("Couldn't copy. Try again.");
    toast("Copied. Paste it in WhatsApp."); b.textContent = "Copied ✓"; setTimeout(() => { b.textContent = "Copy"; }, 2000);
    r.uses = (r.uses || 0) + 1; sb.from("quick_replies").update({ uses: r.uses }).eq("id", r.id).then(() => { });
  });
  view.querySelectorAll("[data-qedit]").forEach(b => b.onclick = () => { qrEdit = b.dataset.qedit; qrDel = null; renderAdmin(); });
  view.querySelectorAll("[data-qdel]").forEach(b => b.onclick = async () => {
    if (qrDel !== b.dataset.qdel) { qrDel = b.dataset.qdel; return renderAdmin(); }
    const { error } = await sb.from("quick_replies").delete().eq("id", qrDel);
    if (error) return toast("Couldn't delete. Check your internet.");
    qr = qr.filter(x => x.id !== qrDel); qrDel = null; toast("Reply deleted"); renderAdmin();
  });
  if ($("#qr-no")) $("#qr-no").onclick = () => { qrEdit = null; renderAdmin(); };
  if ($("#qr-go")) $("#qr-go").onclick = async () => {
    const row = { question: $("#qr-q").value.trim(), topic: $("#qr-t").value.trim() || "Other", answer: $("#qr-a").value.trim() };
    if (!row.question) return toast("Type their question");
    if (!row.answer) return toast("Type your answer");
    $("#qr-go").disabled = true;
    const res = qrEdit === "new"
      ? await sb.from("quick_replies").insert({ ...row, sort: (qr.reduce((m, x) => Math.max(m, x.sort), 0) + 10) }).select().single()
      : await sb.from("quick_replies").update(row).eq("id", qrEdit).select().single();
    if (res.error) { $("#qr-go").disabled = false; return toast("Couldn't save. Check your internet."); }
    if (qrEdit === "new") qr.push(res.data); else qr = qr.map(x => x.id === res.data.id ? res.data : x);
    qrEdit = null; toast("Reply saved"); renderAdmin();
  };
}

/* ---------- Leads: shops to reach, with one-tap WhatsApp messages ---------- */
let linkFor = null; // a called lead marked Joined: Bolu picks which shop it became, so the caller gets the caller fee
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
// Good times to send a first WhatsApp to a laundry owner (Lagos time): when they're likely to check their phone and reply.
// Weekdays 9-11am, 1-3pm, 7-8:30pm; Saturday 1-4pm (mornings are busy); Sunday from 3pm to 7pm.
function msgTiming() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  const d = now.getDay(), m = now.getHours() * 60 + now.getMinutes();
  const slots = d === 0 ? [[900, 1140]] : d === 6 ? [[780, 960]] : [[540, 660], [780, 900], [1140, 1230]];
  const fmt = x => { const h = Math.floor(x / 60), mm = x % 60; return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };
  const cur = slots.find(([a, b]) => m >= a && m < b);
  if (cur) return { ok: true, text: `Good time to message now, until ${fmt(cur[1])}.` };
  const next = slots.find(([a]) => m < a);
  if (next) return { ok: false, text: `Owners are busy now. Next good time to message: ${fmt(next[0])} to ${fmt(next[1])}.` };
  return { ok: false, text: m >= 1260 || m < 480 ? "Too late to message strangers. Carry on tomorrow." : "Done for today. Carry on tomorrow." };
}
function callScriptHtml(who = "Bolu", caller = false) {
  const t = callTiming(), l = oCall && olead && olead.find(x => x.id === oCall), shop = l ? `<b>${esc(l.name)}</b>` : "[Shop name]";
  return `<section class="scard oscript">
    <button class="oscript-top" id="oscript" aria-expanded="${oScriptOpen}"><span><b>Call script</b><span class="otime ${t.ok ? "ok" : ""}">${t.text}</span></span><span aria-hidden="true">${oScriptOpen ? "▴" : "▾"}</span></button>
    ${oScriptOpen ? `<div class="oscript-body">
      ${l ? `<p class="ocalling">Calling ${esc(l.name)}${l.phone ? ` · ${fmtPhone(l.phone)}` : ""}</p>` : ""}
      <ol>
        <li><b>Opening</b><p>"Good ${new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false }) < 12 ? "morning" : "afternoon"}. Am I speaking with the owner of ${shop}?"</p><p class="hint">Not the owner? "Please, when is the best time to reach the owner?" Write it in the note and call back then.</p></li>
        <li><b>Check if they can talk</b><p>"Do you have 1 minute?"</p><p class="hint">Busy, driving or in the market? Skip to the video: "No problem, I'll be quick. Is this your WhatsApp number? We'll send you a short video of what we do." Then send the after-call message and the video. Most people won't call back, so don't wait for that.</p></li>
        <li><b>Who you are, then ask</b><p>"My name is ${esc(who)}, from Tagbook. We work with laundry shops. Quick question: how do you keep track of your customers' clothes right now? Do you write them in a book, or use tags?"</p><p class="hint">End on the question, not on the pitch. If you explain first, they just say "okay" and the call stops there.</p></li>
        <li><b>Listen, then connect</b><p>"Okay. We built a simple app that helps laundry shops track their customers' clothes, send bills on WhatsApp, and see who still owes."</p><p class="hint">Use their answer: "So no more searching through the book" or "So the tags and the record match".</p></li>
        <li><b>Offer the video</b><p>"Do you mind if we send you a 2-minute video on WhatsApp, so you can see how it works and decide if it's something you'd like to try? Is this your WhatsApp number?"</p><p class="hint">Show before you sell: no price yet, they haven't seen what they'd pay for. After the call, tap "Called them? Send after-call message" below and send the video right after it.</p></li>
        <li><b>If they ask the price</b><p>"The first month is free, then ₦3,000 a month, and you can stop anytime. Watch the video first, and if you like it we'll set it up for you."</p></li>
        <li><b>If they already use a system</b><p>"That's good to hear! Can I ask which one you use? We're always learning from shops that already have a system. Thank you."</p><p class="hint">Most are accounting apps (sales and expenses). Tagbook is about the clothes: who brought what, what's ready, and the bill on WhatsApp. If theirs does all of that, thank them and ask if they know a shop still using a book.</p></li>
        ${caller ? "" : `        <li><b>When they reply to the video</b><p>If they like it, don't send a link. Offer to set it up: "Just send your shop name, your full name, your town and your state, and we'll set it up for you."</p></li>`}
      </ol>
      <p class="hint">Keep it under 3 minutes. ${caller ? "After the call, tap “Log call”, pick what happened and write what they said. Bolu sends the WhatsApp follow-up." : "After the call, set the status below and add a one-line note."}</p>
    </div>` : ""}
  </section>`;
}
const O_STATUS = { new: "To contact", called: "Follow up", nopick: "Didn't pick up", unreachable: "Not reachable", messaged: "Messaged", replied: "Replied", demo: "Demo booked", joined: "Joined", no: "Said no" };
const O_PILL = { new: "p-new", called: "p-ready", nopick: "p-billed", unreachable: "p-owed", messaged: "p-billed", replied: "p-ready", demo: "p-ready", joined: "p-collected", no: "p-owed" };
const DAILY_SAFE = 3; // cold messages a day, sent from the router line; raise slowly once the line has a good history
const lagosDay = t => new Date(new Date(t).getTime() + 3600e3).toISOString().slice(0, 10);
// Smaller shops first: big laundries (many Google reviews) usually already have their own system (17 Nov 2026).
// Under 30 reviews, then no count, then 30 to 99, then 100+. Within each group the order stays as added.
const leadReviews = l => { const m = /(\d[\d,]*)\s+Google reviews?/i.exec(l.notes || ""); return m ? +m[1].replace(/,/g, "") : null; };
const sizeRank = l => { const n = leadReviews(l); return n === null ? 1 : n < 30 ? 0 : n < 100 ? 2 : 3; };
const SIZE_HEAD = ["Smaller shops (under 30 Google reviews): call these first", "Size not known", "Medium shops (30 to 99 reviews)", "Big laundries (100+ reviews): may already have a system"];
// Lists already come smallest first, so a heading goes in wherever the size group changes.
const bySize = (ls, cardFn) => ls.map((l, i) => { const r = sizeRank(l), head = i === 0 || sizeRank(ls[i - 1]) !== r; return `${head ? `<p class="osize">${SIZE_HEAD[r]} <span class="n">${ls.filter(x => sizeRank(x) === r).length}</span></p>` : ""}${cardFn(l)}`; }).join("");
const smallFirst = rows => rows.map((l, i) => [sizeRank(l), i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
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
    if (!a.error) olead = smallFirst(a.data || []); if (!b.error) olog = b.data || [];
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
// After a phone call: warm, not cold. Says which number this is, since calls go out from another line.
const LEAD_CALLED = [
  (g, n, visit) => `${g}. This is Bolu from Tagbook. Thank you for your time on the phone earlier. We called from a different line, this is our WhatsApp number.\n\nHere's the 2-minute video we talked about. It shows how a shop records customers' clothes, sends bills on WhatsApp and sees who still owes.\n\nLet us know what you think after watching.`,
  (g, n, visit) => `${g}. It's Bolu from Tagbook. We spoke on the phone earlier about ${n}. This is our WhatsApp number.\n\nAs promised, here's the short video of how Tagbook works.\n\nWatch it when you have 2 minutes, and let us know what you think.`,
  (g, n, visit) => `${g}. Bolu here, from Tagbook, following up on our call earlier. Thank you for your time.\n\nHere's the video you asked for. It shows how Tagbook helps a laundry keep track of every customer's clothes and payments.\n\nWe'd love to hear what you think after watching.`,
];
// A team member (e.g. Tolu) made the call and Bolu takes over on WhatsApp.
const LEAD_HANDOFF = [
  (g, n, c) => `${g}. This is Bolu from the Tagbook team. My colleague ${c} spoke with you earlier today about ${n}, and I'll be your contact from here.\n\nAs promised, here's the 2-minute video. It shows how a shop records customers' clothes, sends bills on WhatsApp and sees who still owes.\n\nWatch it when you have a moment, and let me know what you think.`,
  (g, n, c) => `${g}. It's Bolu from Tagbook. Thank you for your time on the phone with ${c} today. I'll be taking it from here, and this is our WhatsApp number.\n\nHere's the short video ${c} told you about. It shows how Tagbook helps a laundry keep track of every customer's clothes and payments.\n\nLet me know what you think after watching.`,
  (g, n, c) => `${g}. Bolu here, I look after new shops at Tagbook. ${c} from our team called you earlier about ${n}. Thank you for your time.\n\nHere's the video we promised. It's 2 minutes and shows exactly how it works.\n\nI'm here for any questions, and I'd love to hear what you think.`,
];
// They didn't pick up: still cold, but it explains the missed call.
const LEAD_MISSED = [
  (g, n, visit) => `${g}. This is Bolu from Tagbook. We tried to call you earlier about ${n}.\n\nWe help laundry shops keep track of customers' clothes and payments from their phone, and send the bill on WhatsApp.\n\nCan we send you a 2 minute video of how it works?${visit}`,
  (g, n, visit) => `${g}. Bolu from Tagbook here. Sorry we missed you on the phone earlier.\n\nWe built a simple app for laundry shops: it records each customer's clothes, sends the bill on WhatsApp and shows who still owes.\n\nWould you like a short video of how it works?${visit}`,
  (g, n, visit) => `${g}. We called ${n} earlier but couldn't reach you. This is Bolu from Tagbook.\n\nHow do you keep track of your customers' clothes right now? We made an app that does it on your phone. Can we send you a quick video?${visit}`,
];
const leadPick = {}; let leadTurn = Math.floor(Math.random() * 15);
function leadMsg(l, kind) {
  const handoff = kind === "called" && l.called_by && !/^bolu/i.test(l.called_by);
  const list = kind === "follow" ? LEAD_FOLLOW : handoff ? LEAD_HANDOFF : kind === "called" ? LEAD_CALLED : kind === "missed" ? LEAD_MISSED : LEAD_FIRST, key = l.id + ":" + kind;
  if (leadPick[key] == null) leadPick[key] = leadTurn++ % list.length; // next version in turn, so neighbours never match
  if (kind === "follow") return list[leadPick[key]](greet());
  if (kind === "missed") return list[leadPick[key]](greet(), l.name, l.city === "Akure" ? "\n\nWe're here in Akure, so we can also come by and set it up for you." : "");
  if (handoff) return list[leadPick[key]](greet(), l.name, l.called_by.split(" ")[0]);
  if (kind === "called") return list[leadPick[key]](greet(), l.name, l.city === "Akure" ? "\n\nWe can also come by and set it up for you." : "");
  const akure = l.city === "Akure", near = akure ? " We're based here in Akure." : ONDO_NEAR.includes(l.city) ? " We're in Akure, not far from you." : "";
  return list[leadPick[key]](greet(), l.name, near, akure ? "\n\nSince we're in Akure, we can also come by and set it up for you." : "");
}
/* Message for a live shop that hasn't started, or has gone quiet */
/* Welcome for a new shop from Bolu's line: thanks them, names the team member who set them up, and asks them to save the number for updates. */
function welcomeMsg(r) {
  const first = String(r.owner_name || "").trim().split(/\s+/).find(w => w.replace(/[^a-z]/gi, "").length >= 3) || "";
  const hi = `${greet()}${first ? " " + first : ""}. This is Bolu from Tagbook. 👋`;
  const vid = ((tuts || []).find(t => t.step_key === "order") || {}).youtube_id || "SiUDE8sCSQ4";
  const helper = String(r.setup_by_name || r.claim_by_name || "").trim().split(/\s+/)[0];
  const inst = ((tuts || []).find(t => t.step_key === "install") || {}).youtube_id || "chuV8thnvrE";
  const start = `To get started:\n1. Put Tagbook on your phone so it opens like an app.\n   *Android:* open tagbook.ordiventa.com in Chrome, tap the 3 dots (⋮) at the top right, then \"Install app\" or \"Add to Home screen\".\n   *iPhone:* watch this short video: https://youtu.be/${inst}\n2. Add your prices: ⚙️ → Price list\n3. Log your first customer's clothes: tap + Log clothes\n4. Turn on notifications: ⚙️ → Account\n\nThis short video shows how to log clothes: https://youtu.be/${vid}`;
  const save = `Please save this number. If anything is not clear, or you need help with anything, just message us here or send a voice note, and we'll guide you step by step. We'll also send you Tagbook updates here.`;
  if (r.self_signup) return `${hi}\n\nThank you for signing up ${r.name} on Tagbook! Your first month is free.\n\n${start}\n\n${save}\n\nBolu, Tagbook team`;
  if (helper && helper.toLowerCase() !== "bolu") return `${hi}\n\nThank you for signing up ${r.name} on Tagbook through ${helper}! 🙏 Your first month is free.\n\n${save}\n\n${start}\n\nBolu, Tagbook team`;
  return `${hi}\n\nWelcome to Tagbook! Your account for ${r.name} is ready. Were you able to log in?\n\n${start}\n\n${save}\n\nBolu, Tagbook team`;
}
async function markWelcomed(id) {
  const { error } = await sb.rpc("admin_mark_welcomed", { p_shop: id });
  if (error) { toast("Couldn't save. Try again."); return false; }
  const r = dash.find(x => x.id === id); if (r) r.welcomed_at = new Date().toISOString(); return true;
}
function nudgeMsg(r) {
  // Skip initials like "O A Matthew" -> "Matthew"
  const first = String(r.owner_name || "").trim().split(/\s+/).find(w => w.replace(/[^a-z]/gi, "").length >= 3) || "";
  const hi = `${greet()}${first ? " " + first : ""}. This is Bolu from Tagbook.`;
  const cl = daysLeft(coveredUntil(r));
  if (cl !== null && cl < 0) return `${hi}\n\nYour Tagbook plan ended on ${longDay(coveredUntil(r))}.${cl >= -2 ? " You can still log clothes for a short while, but it will pause soon." : " New orders are paused for now, but all your records are safe."}\n\nYou can pay in the app under Settings, Plan & billing. Paying for 1 year gives you 2 months free.\n\nIf you'd rather pay us directly, just reply here.\n\nBolu, Tagbook team`;
  const vid = ((tuts || []).find(t => t.step_key === "order") || {}).youtube_id || "SiUDE8sCSQ4";
  if (!r.orders) return `${hi}\n\nWe noticed no clothes have gone into Tagbook yet. Is anything stopping you, or is something not clear?\n\nThis short video shows how to log your first customer's clothes. It takes less than a minute: https://youtu.be/${vid}\n\nIf you'd like us to walk you through it, just reply and we'll give you a quick call.\n\nBolu, Tagbook team`;
  const days = Math.floor((Date.now() - Date.parse(r.last_order)) / 864e5);
  return `${hi}\n\nWe noticed nothing has been logged in Tagbook for ${days} days. Is everything okay with the app?\n\nIf something is not working well for you, tell us and we will fix it. We can also give you a quick call to help.\n\nBolu, Tagbook team`;
}
/* ---------- Plan & billing ---------- */
let plan = null, planPick = null, planBusy = false, planFailed = false;
// 1 year leads (picked first, shown first) from 20 Nov, 8am. BrightWash sees it now.
const YEAR_LIVE = Date.parse("2026-11-20T08:00:00+01:00");
const yearFirst = () => (!!shop && shop.id === "eb2f4c6c-ad86-42b4-bb8d-2a88ecf9e9b0") || Date.now() >= YEAR_LIVE || location.hostname === "localhost";
const pickNow = () => planPick || (yearFirst() ? "m12" : "m6");
const PRICE_MONTH = 3000;
const PLAN_INFO = { m1: ["1 month", 1, ""], m6: ["6 months", 6, "1 month free"], m12: ["1 year", 12, "2 months free"] };
const longDay = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const TAGBOOK_LINE = "2348120756325";
async function loadPlan() {
  try { const { data, error } = await sb.rpc("my_plan"); if (!error) plan = data; } catch (_) { }
  return plan;
}
const planEnded = () => !!plan && plan.state === "ended";
// Opened from the Google Play app (start URL has ?src=play, or Android hands over the referrer). The Play version
// shows no payment screen or prices (Google's rules for apps that don't use Play billing); paying stays on the website.
const inPlay = (() => {
  const hit = /[?&]src=play\b/.test(location.search) || String(document.referrer || "").startsWith("android-app://");
  try { if (hit) localStorage.setItem("tb-play", "1"); return localStorage.getItem("tb-play") === "1"; } catch (_) { return hit; }
})();
function planBanner() {
  if (!plan || plan.state === "free") return "";
  const d = plan.days_left, pay = own() ? `<button data-gopay>Pay now</button>` : "";
  let t = "";
  if (plan.state === "ended") t = own() ? "New orders are paused. Your records are safe. Pay to start logging clothes again." : "New orders are paused. Ask the owner to pay for Tagbook.";
  else if (plan.state === "grace") t = own() ? `Your Tagbook plan ended on ${longDay(plan.until)}. Pay by ${longDay(plan.grace_until)} to keep logging clothes.` : `The Tagbook plan has ended. Ask the owner to pay by ${longDay(plan.grace_until)}, or logging will pause.`;
  else if (own() && d <= 7) t = plan.state === "trial" ? `Your free trial ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}. ${yearFirst() ? `Pay ${naira(plan.prices && plan.prices.m12 || PRICE_MONTH * 10)} once for the whole year and get 2 months free, or ${naira(PRICE_MONTH)} a month.` : `It's ${naira(PRICE_MONTH)} a month, or pay for 6 months or 1 year and get free months.`}` : `Your Tagbook plan ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}.`;
  if (inPlay && t) t = plan.state === "ended" ? (own() ? "New orders are paused. Your records are safe. See your plan." : "New orders are paused. Ask the owner.")
    : plan.state === "grace" ? `Your Tagbook plan ended on ${longDay(plan.until)}. Logging pauses after ${longDay(plan.grace_until)}.`
    : `Your ${plan.state === "trial" ? "free trial" : "plan"} ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}.`;
  return t ? `<div class="alert ${plan.state === "ended" || plan.state === "grace" ? "planwarn" : ""}"><span>${t}</span>${inPlay && pay ? `<button data-gopay>See plan</button>` : pay}</div>` : "";
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
  const pick = pickNow(), yf = yearFirst();
  const opts = (yf ? ["m12", "m6", "m1"] : ["m1", "m6", "m12"]).filter(k => p.prices[k]).map(k => `<button class="popt" data-plan="${k}" aria-pressed="${pick === k}">
      <span class="pname">${PLAN_INFO[k][0]}${k === "m12" ? ` <em>Best value</em>` : ""}</span>
      <b>${naira(p.prices[k])}</b>
      <span class="hint">${k === "m1" ? "Pay every month" : `${PLAN_INFO[k][2]} (save ${naira(save(k))})`}</span></button>`).join("");
  const refs = p.referrals || [];
  return card("Your plan", "", `<p class="pstate"><b>${status[0]}</b><span>${status[1]}</span></p>`)
    + (inPlay || (p.state === "free" && !isAdmin) ? "" : card("Choose a plan", p.state === "free" ? "Test shop: paying here is only for trying the payment. It doesn't change anything for real shops." : "",
      `<p class="hint" style="margin-top:0">${yf && p.prices.m12 ? `Pay once for the whole year and get 2 months free. Or pay ${naira(p.prices.m1)} every month. No extra charges.` : `${naira(p.prices.m1)} a month for every shop, with no extra charges. Pay ahead and get free months.`}</p>
       <div class="plans">${opts}</div>
       <button class="btn btn-primary" id="paygo">Pay ${naira(p.prices[pick])} with Paystack</button>
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
    const r = await billingCall({ action: "start", plan: pickNow() });
    if (r.url) { location.href = r.url; return; }
    go_.disabled = false; go_.textContent = `Pay ${naira(plan.prices[pickNow()])} with Paystack`;
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
  // Cold messages today, one per shop. A shop you also spoke to on the phone today is warm, so it doesn't count,
  // even if the plain message button was tapped for it first. Tapping the same button twice counts once.
  const todays = olog.filter(x => lagosDay(x.sent_at) === today), warm = new Set(todays.filter(x => x.kind === "called").map(x => x.lead_id));
  const sentToday = new Set(todays.filter(x => x.kind !== "called" && !warm.has(x.lead_id)).map(x => x.lead_id)).size;
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
    const called = `<a class="btn btn-ghost" data-wa="${l.id}" data-kind="called" href="${waLink(l.phone, leadMsg(l, "called"))}" target="_blank" rel="noopener">Called them? Send after-call message</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="called">Copy after-call message</button>` : ""}`;
    if (!l.phone) act = `<span class="hint">No phone yet</span>`;
    else if (l.status === "new") act = `<a class="btn btn-primary" data-wa="${l.id}" data-kind="first" href="${waLink(l.phone, leadMsg(l, "first"))}" target="_blank" rel="noopener">Message on WhatsApp</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="first">Copy message instead</button>` : ""}` + called;
    else if (l.status === "called") act = called.replace('class="btn btn-ghost" data-wa', 'class="btn btn-primary" data-wa').replace("Called them? Send after-call message", "Send after-call message");
    else if (l.status === "nopick" || l.status === "unreachable") act = `<a class="btn btn-primary" data-wa="${l.id}" data-kind="missed" href="${waLink(l.phone, leadMsg(l, "missed"))}" target="_blank" rel="noopener">Message: missed call</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="missed">Copy message instead</button>` : ""}`;
    else if (l.status === "messaged") act = days !== null && days >= 2 ? `<a class="btn btn-ghost" data-wa="${l.id}" data-kind="follow" href="${waLink(l.phone, leadMsg(l, "follow"))}" target="_blank" rel="noopener">Send follow-up</a>${iosBiz() ? `<button class="btn btn-ghost" data-wacopy="${l.id}" data-kind="follow">Copy follow-up instead</button>` : ""}` : `<span class="hint">Messaged ${ago(new Date(last).toISOString())}</span>`
    else if (l.status !== "no") act = `<a class="btn btn-ghost" href="${waLink(l.phone)}" target="_blank" rel="noopener">Open chat</a>`;
    if (l.phone && l.status === "messaged") act += called;
    return `<section class="olead${l.status === "no" ? " is-no" : ""}">
      <div class="ohead"><div><b>${esc(l.name)}</b><span>${esc(l.area || "")}${l.phone ? ` · ${fmtPhone(l.phone)}` : ""}${l.called_by ? ` · called by ${esc(l.called_by)} ${fmtDay(Date.parse(l.called_at))}` : ""}</span></div><span class="pill ${O_PILL[l.status]}">${O_STATUS[l.status]}</span></div>
      ${l.notes ? `<p class="onote">${esc(l.notes)}</p>` : ""}
      ${l.shop_id && dash ? `<p class="hint">Joined as <b>${esc((dash.find(r => r.id === l.shop_id) || {}).name || "a shop")}</b>${l.called_by && !/^bolu/i.test(l.called_by) ? ` · caller fee to ${esc(l.called_by.split(" ")[0])} once it has paid ₦6,000` : ""}</p>` : ""}
      ${linkFor === l.id ? `<div class="ocopy"><p><b>Which shop did ${esc(l.name)} become?</b> ${esc(l.called_by.split(" ")[0])} called them, so they get the ₦1,500 caller fee once the shop has paid ₦6,000.</p>
        ${dash ? `<select data-lshop aria-label="Shop"><option value="">Pick the shop</option>${dash.filter(r => !r.is_test).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>` : `<p class="hint">Loading shops…</p>`}
        <div class="row"><button class="btn btn-primary" data-lsave="${l.id}">Save</button><button class="btn btn-ghost" data-lnot>Not set up yet</button></div></div>` : ""}
      ${oCopy && oCopy.id === l.id ? `<div class="ocopy"><p><b>Message copied.</b> Now open <b>WhatsApp Business</b>, start a new chat with <b>${fmtPhone(l.phone)}</b> and paste the message.</p>
        <div class="row"><button class="btn btn-ghost" data-copynum="${l.id}">Copy number</button><button class="btn btn-ghost" data-recopy="${l.id}">Copy message again</button></div>
        <div class="row"><button class="btn btn-primary" data-sent="${l.id}">I've sent it</button><button class="btn btn-ghost" data-nocopy>Not now</button></div></div>` : ""}
      <div class="oact">${l.phone && l.status !== "no" ? `<a class="btn btn-ghost ocall" data-call="${l.id}" href="tel:${l.phone}">Call</a>` : ""}${act}<select data-ost="${l.id}" aria-label="Change status for ${esc(l.name)}">${Object.entries(O_STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </section>`;
  };
  view.innerHTML = `${adminSeg()}
    <div class="dtop"><div><h2 class="ptitle">Leads</h2><p class="hint">${olead.length} shops · tap a button to open WhatsApp with the message ready</p></div><div class="row"><button class="btn btn-ghost" id="oadd">+ Add a lead</button></div></div>
    ${(() => { const left = olead.filter(l => l.status === "new").length, joined = olead.filter(l => l.status === "joined").length, talking = olead.filter(l => l.status === "replied").length;
      return `<div class="stats lstats"><button class="stat ${left ? "hot" : ""}" data-lsum="new"><b>${left}</b><span>Left to contact</span></button><button class="stat" data-lsum="replied"><b>${talking}</b><span>Replied</span></button><button class="stat" data-lsum="joined"><b>${joined}</b><span>Joined</span></button></div>
        <p class="hint" style="margin:6px 0 0">${olead.length - left} of ${olead.length} leads contacted so far${oCity !== "all" ? ` · ${inCity.filter(l => l.status === "new").length} left in ${esc(oCity)}` : ""}.</p>`; })()}
    <div class="owa"><span>Open chats in</span><div class="aseg"><button data-wapp="business" aria-pressed="${waApp === "business"}">WhatsApp Business</button><button data-wapp="normal" aria-pressed="${waApp === "normal"}">WhatsApp</button></div></div>
    <section class="scard osent"><div class="osent-top"><b>${sentToday} of ${DAILY_SAFE}</b><span>messages sent today</span></div><div class="obar"><i style="width:${pct}%" class="${sentToday >= DAILY_SAFE ? "full" : ""}"></i></div>
      <p class="hint" style="margin:8px 0 0">${sentToday >= DAILY_SAFE ? "That's today's safe limit. Carry on tomorrow so WhatsApp doesn't flag the router line." : `${DAILY_SAFE - sentToday} more today keeps the router line safe.`}</p>
      ${(() => { const t = msgTiming(); return `<p class="otime ${t.ok ? "ok" : ""}" style="margin:6px 0 0">${t.text}</p>`; })()}</section>
    ${callScriptHtml()}
    ${oAdd ? `<section class="scard dlead"><h3 class="stitle">Add a lead</h3>
      <label for="ol-n">Shop name</label><input id="ol-n" autocomplete="off">
      <div class="sgrid"><div><label for="ol-a">Area</label><input id="ol-a" placeholder="e.g. Oba Ile" autocomplete="off"></div>
      <div><label for="ol-c">City</label><input id="ol-c" list="ol-cities" value="${oCity === "all" ? "Akure" : esc(oCity)}" autocomplete="off"><datalist id="ol-cities">${cities.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div></div>
      <label for="ol-p">Phone</label><input id="ol-p" type="text" inputmode="tel" autocomplete="off">
      <label for="ol-x">Note (optional)</label><input id="ol-x" autocomplete="off">
      <div class="row"><button class="btn btn-ghost" id="ol-no">Cancel</button><button class="btn btn-primary" id="ol-go">Save lead</button></div></section>` : ""}
    <div class="chips ochips">${[["all", "All", olead.length]].concat(cities.map(c => [c, c, olead.filter(l => l.city === c).length])).map(([k, v, n]) => `<button class="chip" data-oc="${esc(k)}" aria-pressed="${oCity === k}">${esc(v)} <span class="n">${n}</span></button>`).join("")}</div>
    <div class="chips ochips">${[["new", "To contact"], ["called", "Follow up"], ["nopick", "Didn't pick up"], ["unreachable", "Not reachable"], ["messaged", "Messaged"], ["replied", "Replied"], ["demo", "Demo booked"], ["joined", "Joined"], ["no", "Said no"], ["all", "All"]].map(([k, v]) => `<button class="chip" data-os="${k}" aria-pressed="${oStatus === k}">${v} <span class="n">${k === "all" ? inCity.length : inCity.filter(l => l.status === k).length}</span></button>`).join("")}</div>
    <input id="oq" class="search" placeholder="Search name, area or phone" value="${esc(oQ)}" autocomplete="off">
    ${groups.length ? groups.map(([c, ls]) => {
      // On "All" with no search, show a few per city so the page stays quick on a phone.
      const cut = oCity === "all" && !q && ls.length > 6;
      return `<h3 class="stitle dtest">${esc(c)} <span class="hint">${ls.length}</span></h3><div class="dlist">${cut ? ls.slice(0, 6).map(card).join("") : bySize(ls, card)}</div>${cut ? `<button class="btn btn-ghost omore" data-oc="${esc(c)}">See all ${ls.length} in ${esc(c)}</button>` : ""}`;
    }).join("") : `<p class="hint" style="margin-top:16px">No leads here.</p>`}`;
  wireAdminSeg();
  $("#oscript").onclick = () => { oScriptOpen = !oScriptOpen; try { localStorage.setItem("tb-script-open", oScriptOpen ? "1" : "0"); } catch (_) { } renderAdmin(); };
  // Tapping Call opens the phone's dialer and opens the script for that shop, so it's there when you come back.
  view.querySelectorAll("[data-call]").forEach(a => a.onclick = () => { oCall = a.dataset.call; oScriptOpen = true; setTimeout(() => { renderAdmin(); const sc = $(".oscript"); if (sc) sc.scrollIntoView({ block: "start" }); }, 300); });
  view.querySelectorAll("[data-wapp]").forEach(b => b.onclick = () => { waApp = b.dataset.wapp; try { localStorage.setItem("tb-wa-app", waApp); } catch (_) { } renderAdmin(); });
  view.querySelectorAll("[data-oc]").forEach(b => b.onclick = () => { oCity = b.dataset.oc; renderAdmin(); if (b.classList.contains("omore")) mainScroll().scrollTo(0, 0); });
  view.querySelectorAll("[data-os]").forEach(b => b.onclick = () => { oStatus = b.dataset.os; renderAdmin(); });
  view.querySelectorAll("[data-lsum]").forEach(b => b.onclick = () => { oStatus = b.dataset.lsum; renderAdmin(); });
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
    if (["new", "nopick", "unreachable", "called"].includes(l.status)) { l.status = "messaged"; sb.from("outreach_leads").update({ status: "messaged" }).eq("id", l.id).then(() => { }); }
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
  view.querySelectorAll("[data-lsave]").forEach(b => b.onclick = async () => {
    const l = olead.find(x => x.id === b.dataset.lsave), shop = (view.querySelector("[data-lshop]") || {}).value;
    if (!shop) return toast("Pick the shop first");
    b.disabled = true;
    const { error } = await sb.rpc("admin_link_lead", { p_lead: l.id, p_shop: shop });
    if (error) { b.disabled = false; return toast("Couldn't save. Check your internet."); }
    l.shop_id = shop; l.status = "joined"; linkFor = null; toast(`${l.name}: linked. ${l.called_by.split(" ")[0]} gets the caller fee once it has paid ₦6,000.`); renderAdmin();
  });
  view.querySelectorAll("[data-lnot]").forEach(b => b.onclick = () => { linkFor = null; toast("OK. Set the status to Joined again once the shop is set up."); renderAdmin(); });
  view.querySelectorAll("[data-nocopy]").forEach(b => b.onclick = () => { oCopy = null; renderAdmin(); });
  view.querySelectorAll("[data-ost]").forEach(sel => sel.onchange = async () => {
    const l = olead.find(x => x.id === sel.dataset.ost); const status = sel.value;
    if (status === "joined" && l.called_by && !/^bolu/i.test(l.called_by) && !l.shop_id) { linkFor = l.id; if (!dash) loadDash().then(() => tab === "admin" && renderAdmin()); }
    const { error } = await sb.from("outreach_leads").update({ status }).eq("id", l.id);
    if (error) return toast("Couldn't save. Check your internet.");
    l.status = status; toast(`${l.name}: ${O_STATUS[status]}`); renderAdmin();
  });
}

let followN = 0, followAt = 0;
function renderAdmin() {
  if (!isAdmin) return go("orders");
  if (adminView === "leads") return renderLeads();
  if (adminView === "replies") return renderReplies();
  if (dash === null || Date.now() - dashAt > 60e3) loadDash();
  if (dash === null) { view.innerHTML = `<h2 class="ptitle">Shops</h2><p class="hint">Loading…</p>`; return; }
  const real = dash.filter(r => !r.is_test), test = dash.filter(r => r.is_test);
  const sum = k => real.reduce((s, r) => s + (+r[k] || 0), 0);
  const active = real.filter(r => r.week > 0).length, trial = real.filter(r => daysTo(r.trial_ends) >= 0).length;
  const needAll = real.map(r => [r, shopFlags(r).filter(f => f[1] === "owes")]).filter(x => x[1].length);
  const need = needAll.filter(([r]) => { const st = followState(r); return !st || !st.waiting || nCopy === r.id; });
  const resting = needAll.filter(([r]) => { const st = followState(r); return st && st.waiting && nCopy !== r.id; }).sort((a, b) => followState(a[0]).next - followState(b[0]).next);
  const wa = p => p ? "https://wa.me/234" + String(p).replace(/^0/, "") : "";
  const shopCard = r => {
    const left = daysTo(r.trial_ends), trend = r.prev_week ? Math.round((r.week - r.prev_week) / r.prev_week * 100) : null;
    const open = dOpen === r.id || r.is_test === "never";
    if (!open) { const fl = r.is_test ? [] : shopFlags(r);
      return `<section class="dshop dmini${r.is_test ? " is-test" : ""}">
      <div class="dhead"><div><b>${esc(r.name)}</b><span>${esc(r.owner_name || "")}${r.owner_phone ? ` · <a href="${wa(r.owner_phone)}" target="_blank" rel="noopener">${fmtPhone(r.owner_phone)}</a>` : ""}</span>
        <span>${r.week} order${r.week === 1 ? "" : "s"} this week · ${r.orders} in all${r.area || r.state ? " · " + esc([r.area, r.state].filter(Boolean).join(", ")) : ""}</span></div>
        <span class="pill ${r.is_test ? "p-collected" : r.paid_total ? "p-ready" : left !== null && left >= 0 ? "p-billed" : "p-ready"}">${r.is_test ? "Test" : r.paid_total ? "Paying" : left !== null && left >= 0 ? "Trial" : "Live"}</span></div>
      ${fl.length ? `<div class="dflags">${fl.map(([t, k]) => `<span class="pill p-${k === "owes" ? "owed" : "new"}">${t}</span>`).join("")}</div>` : ""}
      <div class="row dminirow">${!r.is_test && !ownerPush(r) && r.owner_phone ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${waTo(r.owner_phone, alertsMsg(r))}">Remind on WhatsApp</a>` : ""}<button class="btn btn-ghost" data-dopen="${r.id}">Details</button></div>
    </section>`; }
    return `<section class="dshop${r.is_test ? " is-test" : ""}">
      <button class="btn btn-ghost dclose" data-dopen="">Hide details</button>
      <div class="dhead"><div><b>${esc(r.name)}</b><span>${esc(r.owner_name || "")}${r.owner_phone ? ` · <a href="${wa(r.owner_phone)}" target="_blank" rel="noopener">${fmtPhone(r.owner_phone)}</a>` : ""}</span></div>
        <span class="pill ${r.is_test ? "p-collected" : left !== null && left >= 0 ? "p-billed" : "p-ready"}">${r.is_test ? "Test" : left !== null && left >= 0 ? "Trial" : "Live"}</span></div>
      <div class="dnums"><div><b>${r.today}</b><span>Today</span></div><div><b>${r.week}</b><span>7 days${trend !== null ? ` <em class="${trend >= 0 ? "up" : "down"}">${trend >= 0 ? "+" : ""}${trend}%</em>` : ""}</span></div><div><b>${r.orders}</b><span>All orders</span></div><div><b>${r.clothes_week}</b><span>Clothes this week</span></div></div>
      <dl class="dmeta">
        <div><dt>Last order</dt><dd>${r.last_order ? ago(r.last_order) : "none yet"}</dd></div>
        <div><dt>Last opened</dt><dd>${ago(r.last_active)}</dd></div>
        <div><dt>Logins</dt><dd>${r.owners} owner, ${r.staff} staff</dd></div>
        <div><dt>App installed</dt><dd>${r.installed ? "Yes" : "No"}</dd></div>
        <div><dt>Owner alerts</dt><dd>${r.push ? "On" : "Off"}</dd></div>
        <div><dt>Joined</dt><dd>${fmtDay(Date.parse(r.created_at))}${r.self_signup ? ` · signed up themselves${r.confirmed ? "" : " · <b>not confirmed</b>"}` : ""}</dd></div>
        <div><dt>Location</dt><dd>${esc([r.area, r.state].filter(Boolean).join(", ") || "not set")}</dd></div>
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
      ${r.is_test ? "" : ologFor === r.id ? `<div class="dlead dmark">
          <label for="ol-p">Owner's login phone</label><input id="ol-p" type="tel" inputmode="numeric" maxlength="11" value="${esc(r.owner_phone || "")}">
          <label for="ol-n">New 6-digit PIN</label><input id="ol-n" ${genPinAttrs()}>
          <p class="hint">Fix the phone if it was typed wrong. They log in with this phone and PIN.</p>
          <div class="row"><button class="btn btn-ghost" data-olno>Cancel</button><button class="btn btn-primary" data-olgo="${r.id}">Save</button></div></div>`
        : ologDone && ologDone.id === r.id ? `<div class="dlead dmark"><p><b>Saved.</b> Send them their login:</p><a class="btn btn-primary" target="_blank" rel="noopener" href="${waTo(ologDone.phone, ologDone.msg)}">Send on WhatsApp</a><button class="btn btn-ghost" data-olno>Done</button></div>`
        : `<button class="btn btn-ghost dmarkbtn" data-olog="${r.id}">New PIN or fix login phone</button>`}
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
    <p class="ssub">Your team demo Tagbook on their own copy of BrightWash and set shops up. They can't see this page or any shop's money. Helper (demo and setup): ₦1,500 when the shop first pays, ₦1,500 more from day 30 if it's still logging orders. Agent (found and closed it): ₦3,000 once the shop has paid ₦6,000, plus ₦500 for each paid month, up to 12. Caller (a shop from our list you called): ₦1,500 once the shop has paid ₦6,000, plus a ₦2,000 bonus for every 5 called shops that become paying shops. Pay from a shop never goes above half of what that shop has paid; anything above that waits until it pays more. Pay out once someone is owed ${naira((teamPay[0] || {}).threshold || 10000)}, or once money has waited ${(teamPay[0] || {}).max_wait || 60} days. You get a notification when someone is ready.</p>
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
  // Search sits at the top: while something is typed, only matching shops show.
  const qOn = !!dQ.trim(), dHit = r => { const q = dQ.trim().toLowerCase(), dg = q.replace(/\D/g, ""); return [r.name, r.owner_name, r.area, r.state].some(v => String(v || "").toLowerCase().includes(q)) || (dg.length >= 3 && String(r.owner_phone || "").includes(dg.replace(/^234/, "0").replace(/^0/, ""))); };
  if (Date.now() - followAt > 60e3) { followAt = Date.now(); sb.from("outreach_leads").select("id", { count: "exact", head: true }).eq("status", "called").then(({ count }) => { if (count != null && count !== followN) { followN = count; if (tab === "admin" && adminView === "shops") renderAdmin(); } }); }
  view.innerHTML = `${adminSeg()}${followN ? `<div class="alert"><span><b>${followN} shop${followN > 1 ? "s" : ""} to follow up.</b> Called and interested. Send the after-call message on WhatsApp.</span><button id="gofollow">Open</button></div>` : ""}<div class="dtop"><div><h2 class="ptitle">Shops</h2><p class="hint">Updated ${ago(new Date(dashAt).toISOString())} · test shops not counted</p></div>
      <div class="row"><button class="btn btn-ghost" id="dref">Refresh</button><button class="btn btn-primary" id="dadd">Add a shop</button></div></div>
    <input id="dq" class="dq" type="search" placeholder="Search a shop: name, owner or phone" value="${esc(dQ)}" autocomplete="off" style="margin:4px 0 14px">
    ${qOn ? (() => { const list = dash.filter(dHit); return `<p class="hint">${list.length} shop${list.length === 1 ? "" : "s"} found</p><div class="dlist">${list.map(shopCard).join("") || `<p class="hint">No shop matches “${esc(dQ.trim())}”. Try part of the name or the last 4 digits of the phone.</p>`}</div>`; })() : `
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
    ${(nw => nw.length ? `<section class="scard dcall"><h3 class="stitle">New shops to welcome</h3><p class="ssub">Send each new shop the welcome message, or call. Once you've sent it, they leave this list.</p>${nw.map(r => `<div class="staff-row dwel"><div><b>${esc(r.name)}</b><span>${esc(r.owner_name || "")} · ${fmtPhone(r.owner_phone || "")}${r.area || r.state ? " · " + esc([r.area, r.state].filter(Boolean).join(", ")) : ""}</span><span>${r.self_signup ? `Signed up themselves${r.confirmed ? " · number confirmed" : " · number not confirmed"}` : `Set up by ${esc(r.setup_by_name || r.claim_by_name || "Bolu")}`} · ${ago(r.created_at)}</span></div>
      ${r.owner_phone ? `<div class="row"><a class="btn btn-primary" data-wwa="${r.id}" href="${waLink(r.owner_phone, welcomeMsg(r))}" target="_blank" rel="noopener">Send welcome</a><a class="btn btn-ghost" href="tel:${esc(r.owner_phone)}">Call</a>${iosBiz() ? `<button class="btn btn-ghost" data-wcopy="${r.id}">Copy</button>` : ""}</div>` : ""}
      <div class="row dwelmore">${r.self_signup && !r.confirmed ? `<button class="btn btn-ghost" data-sconf="${r.id}">Number confirmed</button>` : ""}<button class="btn btn-ghost" data-wdone="${r.id}">Already welcomed</button></div></div>`).join("")}</section>` : "")(real.filter(r => !r.welcomed_at && Date.now() - Date.parse(r.created_at) < 14 * 864e5))}
    ${need.length ? `<section class="scard dcall"><h3 class="stitle">Call these shops</h3><p class="ssub">A call works best. If you can't call, send the message.</p>${need.map(([r, f]) => `<div class="staff-row"><div><b>${esc(r.name)}</b><span>${f.map(x => x[0]).join(" · ")}${(st => st ? ` · messaged ${st.times}×, last ${ago(st.at)}` : "")(followState(r))}</span></div>${r.owner_phone ? `<div class="row"><a class="btn btn-ghost" href="tel:${esc(r.owner_phone)}">Call</a>${`<a class="btn btn-primary" data-nwa="${r.id}" href="${waLink(r.owner_phone, nudgeMsg(r))}" target="_blank" rel="noopener">WhatsApp</a>${iosBiz() ? `<button class="btn btn-ghost" data-ncopy="${r.id}">Copy</button>` : ""}`}</div>` : ""}</div>${iosBiz() && nCopy === r.id ? `<div class="ocopy"><p><b>Message copied.</b> Open <b>WhatsApp Business</b>, open the chat with ${fmtPhone(r.owner_phone)} and paste it.</p><div class="row"><button class="btn btn-ghost" data-nnum="${r.id}">Copy number</button><button class="btn btn-ghost" data-nclose>Done</button></div></div>` : ""}`).join("")}</section>` : ""}
    ${resting.length ? `<details class="scard drest"><summary><b>Messaged, waiting for a reply</b> <span class="hint">${resting.length} · they come back above when the next follow-up is due</span></summary>${resting.map(([r]) => { const st = followState(r); return `<div class="staff-row"><div><b>${esc(r.name)}</b><span>Messaged ${st.times}×, last ${ago(st.at)} · next follow-up ${new Date(st.next).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span></div><button class="mini" data-nback="${r.id}">Follow up now</button></div>`; }).join("")}</details>` : ""}
    ${teamGoalHtml()}
    ${(() => { const noApp = real.filter(r => !r.installed), noPush = real.filter(r => !ownerPush(r)), names = l => l.map(r => `<span class="dname">${esc(r.name)}</span>`).join("");
      return real.length ? `<section class="scard dstates"><h3 class="stitle">App and alerts</h3>
        <p class="ssub"><span class="dstate"><b>${real.length - noApp.length}</b> of ${real.length} installed the app</span><span class="dstate"><b>${real.length - noPush.length}</b> of ${real.length} have alerts on</span></p>
        ${noApp.length ? `<p class="dfollow"><b>Not installed:</b> ${names(noApp)}</p>` : ""}
        ${noPush.length ? `<p class="dfollow"><b>Alerts off:</b> ${names(noPush)}</p><button class="btn btn-ghost" data-dseg="alerts">Remind them to turn alerts on</button>` : ""}</section>` : ""; })()}
    ${(st => { const n = k => st.filter(x => x.kind === k).reduce((a, x) => a + Number(x.sends), 0), sh = k => Math.max(0, ...st.filter(x => x.kind === k).map(x => Number(x.shops))); const bills = st.filter(x => x.stage !== "list"), list = st.filter(x => x.stage === "list"); st = bills; const pdf = n("pdf"), txt = n("text"), ln = list.reduce((a, x) => a + Number(x.sends), 0), ls = Math.max(0, ...list.map(x => Number(x.shops)));
      return `<section class="scard dstates"><h3 class="stitle">Bills sent, last 30 days</h3>${pdf + txt ? `<p class="ssub"><span class="dstate"><b>${pdf}</b> as PDF invoice${sh("pdf") ? ` (${sh("pdf")} shop${sh("pdf") === 1 ? "" : "s"})` : ""}</span><span class="dstate"><b>${txt}</b> as text${sh("text") ? ` (${sh("text")} shop${sh("text") === 1 ? "" : "s"})` : ""}</span><span class="dstate"><b>${Math.round(pdf / (pdf + txt) * 100)}%</b> PDF</span></p>` : `<p class="ssub">None yet. Counting started 14 Nov.</p>`}</section>
      <section class="scard dstates"><h3 class="stitle">Lists of clothes sent, last 30 days</h3><p class="ssub">${ln ? `<span class="dstate"><b>${ln}</b> list${ln === 1 ? "" : "s"} sent on WhatsApp${ls ? ` (${ls} shop${ls === 1 ? "" : "s"})` : ""}</span>` : "None yet. Counting started 25 Nov."}</p></section>`; })(sendStats)}
    ${(by => by.length ? `<section class="scard dstates"><h3 class="stitle">Shops by state</h3><p class="ssub">${by.map(([k, n]) => `<span class="dstate"><b>${n}</b> ${esc(k)}</span>`).join("")}</p></section>` : "")(Object.entries(real.reduce((m, r) => { const k = r.state || "Not set"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]))}
    ${(() => { const q = dQ.trim().toLowerCase(), digits = q.replace(/\D/g, "");
      const hit = r => !q || [r.name, r.owner_name, r.area, r.state].some(v => String(v || "").toLowerCase().includes(q)) || (digits.length >= 3 && String(r.owner_phone || "").includes(digits));
      const list = real.filter(r => inSeg(r, dSeg) && hit(r));
      return `<h3 class="stitle" id="dlisth">All shops</h3>
      <div class="chips dsegs">${D_SEGS.map(([k, l]) => `<button class="chip" data-dseg="${k}" aria-pressed="${dSeg === k}">${l}<span class="cnt">${real.filter(r => inSeg(r, k)).length}</span></button>`).join("")}</div>
      ${dSeg === "alerts" && list.length ? `<p class="hint">Tap Remind to send the owner a WhatsApp message with the steps to turn notifications on.</p>` : ""}
      <div class="dlist">${list.map(shopCard).join("") || `<p class="hint">No shops here.</p>`}</div>`; })()}
    ${refHtml}
    ${agentHtml}
    ${test.length ? `<h3 class="stitle dtest">Test shops</h3><div class="dlist">${test.map(shopCard).join("")}</div>` : ""}`}`;
  wireAdminSeg(); if ($("#gofollow")) $("#gofollow").onclick = () => { adminView = "leads"; oStatus = "called"; oCity = "all"; try { localStorage.setItem("tb-admin-view", "leads"); } catch (_) { } renderAdmin(); };
  view.querySelectorAll("[data-dseg]").forEach(b => b.onclick = () => { dSeg = b.dataset.dseg; dOpen = null; renderAdmin(); const h = $("#dlisth"); if (h) h.scrollIntoView({ block: "start" }); });
  view.querySelectorAll("[data-dopen]").forEach(b => b.onclick = () => { dOpen = b.dataset.dopen || null; renderAdmin(); });
  const dq = $("#dq"); if (dq) dq.oninput = () => { dQ = dq.value; const pos = dq.selectionStart; renderAdmin(); const n = $("#dq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { } } };
  $("#dref").onclick = () => { dashAt = 0; loadDash(); toast("Refreshing"); };
  view.querySelectorAll("[data-ep]").forEach(b => b.onclick = () => { editFor = b.dataset.ep; renderAdmin(); const f = $("#ep-b"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } });
  view.querySelectorAll("[data-epno]").forEach(b => b.onclick = () => { editFor = null; renderAdmin(); });
  view.querySelectorAll("[data-olog]").forEach(b => b.onclick = () => { ologFor = b.dataset.olog; ologDone = null; renderAdmin(); const f = $("#ol-n"); if (f) f.scrollIntoView({ block: "center" }); });
  view.querySelectorAll("[data-olno]").forEach(b => b.onclick = () => { ologFor = null; ologDone = null; renderAdmin(); });
  view.querySelectorAll("[data-olgo]").forEach(b => b.onclick = async () => {
    const phone = digits($("#ol-p").value), pin = digits($("#ol-n").value), r = dash.find(k => k.id === b.dataset.olgo);
    if (!/^0\d{10}$/.test(phone)) { toast("Type the 11-digit phone, starting with 0."); return; }
    if (pin.length !== 6) { toast("The PIN must be 6 digits."); return; }
    b.disabled = true;
    const res = await callAdmin({ action: "owner_login", shop_id: b.dataset.olgo, phone, pin });
    if (!res.ok) { b.disabled = false; toast(res.error === "PHONE_IN_USE" ? "Another Tagbook login already uses that phone." : failMsg({ message: res.error || "" })); return; }
    const first = String(r && r.owner_name || "").trim().split(/\s+/)[0] || "";
    ologFor = null; ologDone = { id: b.dataset.olgo, phone, msg: `${greet()}${first ? " " + first : ""}. Here is your Tagbook login:\n\nOpen tagbook.ordiventa.com and tap Log in.\nPhone: ${fmtPhone(phone)}\nPIN: ${pin}\n\nYou can change your PIN anytime in Settings.\n\nBolu, Tagbook team` };
    if (r) r.owner_phone = phone; renderAdmin();
  });
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
  view.querySelectorAll("[data-ncopy]").forEach(b => b.onclick = async () => { const r = dash.find(x => x.id === b.dataset.ncopy); if (await copyText(nudgeMsg(r))) { nCopy = r.id; markFollow(r.id); renderAdmin(); } else toast("Couldn't copy"); });
  view.querySelectorAll("[data-wwa]").forEach(a => a.addEventListener("click", () => { const id = a.dataset.wwa; setTimeout(async () => { if (await markWelcomed(id)) renderAdmin(); }, 800); }));
  view.querySelectorAll("[data-wdone]").forEach(b => b.onclick = async () => { b.disabled = true; if (await markWelcomed(b.dataset.wdone)) { toast("Marked as welcomed"); renderAdmin(); } else b.disabled = false; });
  view.querySelectorAll("[data-wcopy]").forEach(b => b.onclick = async () => { const r = dash.find(x => x.id === b.dataset.wcopy); if (!r) return;
    if (await copyText(welcomeMsg(r))) { toast("Copied. Open WhatsApp Business, open the chat and paste."); if (await markWelcomed(r.id)) setTimeout(renderAdmin, 1500); } else toast("Couldn't copy"); });
  view.querySelectorAll("[data-sconf]").forEach(b => b.onclick = async () => {
    b.disabled = true; const { error } = await sb.rpc("admin_confirm_shop", { p_shop: b.dataset.sconf });
    if (error) { b.disabled = false; return toast("Couldn't save. Try again."); }
    const r = dash.find(x => x.id === b.dataset.sconf); if (r) r.confirmed = true; toast("Marked as confirmed"); renderAdmin();
  });
  view.querySelectorAll("[data-nnum]").forEach(b => b.onclick = async () => { const r = dash.find(x => x.id === b.dataset.nnum); toast(await copyText("+234" + String(r.owner_phone).replace(/^0/, "")) ? "Number copied" : "Couldn't copy"); });
  view.querySelectorAll("[data-nclose]").forEach(b => b.onclick = () => { nCopy = null; renderAdmin(); });
  view.querySelectorAll("[data-nwa]").forEach(a => a.addEventListener("click", () => { markFollow(a.dataset.nwa); setTimeout(() => renderAdmin(), 600); }));
  view.querySelectorAll("[data-nback]").forEach(b => b.onclick = () => { const f = follows[b.dataset.nback]; if (!f) return; f.at = new Date(Date.now() - 8 * 864e5).toISOString(); sb.from("shop_followups").update({ at: f.at }).eq("shop_id", f.shop_id).then(() => { }); renderAdmin(); });
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
  // From a "Tolu called …" notification: straight to the shops waiting for the after-call message, in every city.
  else if (h === "followup" && isAdmin) { openNo = null; tab = "admin"; adminView = "leads"; oStatus = "called"; oCity = "all"; }
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
  const st = canBill()
    ? { new: ["Send list", "s-new"], listed: ["In progress", "s-work"], ready: ["Ready, not told", "s-new"], told: ["Customer told", "s-told"], picked: ["Picked up", "s-done"] }
    : { new: ["In progress", "s-work"], listed: ["In progress", "s-work"], ready: ["Ready", "s-told"], told: ["Ready", "s-told"], picked: ["Picked up", "s-done"] };
  let money = "";
  if (canBill() && !o.cancelled) {
    // A bold amount is always money still to collect.
    const due = owed(o);
    if (o.billed && due && (o.status === "told" || o.status === "picked")) money = `<b class="owes">Owes ${naira(due)}</b>`;
    else if (o.billed && due) money = `<b>${naira(due)} due</b>`;
    else if (o.billed) money = `<span class="sub s-paid">Paid</span>`;
    else if (o.m.paid) money = `<span class="sub">${naira(o.m.paid)} paid</span>`;
    else if (o.status !== "new") money = `<span class="sub">No bill yet</span>`;
  }
  if (!canBill() && o.billed && (o.status === "told" || o.status === "picked") && owed(o)) money = `<b class="owes">Not paid</b>`;
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

/* ---------- Referral: share message (Settings, Plan) ---------- */
const refShareLink = () => "https://wa.me/?text=" + encodeURIComponent(
  `We now use Tagbook in our laundry to record customers' clothes, send bills on WhatsApp and see who still owes. It has made things easier for us.\n\nThe first month is free. Message them here and tell them ${shop.name} sent you:\nhttps://wa.me/${TAGBOOK_LINE}?text=${encodeURIComponent(`Hi, ${shop.name} referred me to Tagbook`)}`);
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
    { k: "prices", t: "Put in your prices", d: "Tap each item and type what your shop charges. Bills are worked out from it.", go: "Set prices", done: !!st.prices },
    { k: "install", t: `Install Tagbook on this ${device()}`, d: "So it opens like an app and can notify you.", go: "Show me", done: !!st.installed || standalone() || (!isPhone() && !installEvt) },
    { k: "bank", t: "Add your bank details", d: "Type your bank name, account number and account name. Your bill shows customers where to pay.", go: "Add bank", done: !!hasBank() },
    // Steps for newer features: shops that already finished the checklist don't see them again.
    { k: "invoice", t: "Add your logo to your invoice", d: "Upload a picture of your logo. Customers get a neat PDF invoice with it.", go: "Add logo", done: !!sPriv().inv_logo || !!st.invoice, skip: ["I don't have a logo", "invoice"] },
    ...(newOpts() ? [{ k: "options", t: "Choose your order options", d: "Turn on Collection dates or Wait & get, or set your Express charge. Only what your shop uses.", go: "Choose", done: !!st.options, skip: ["My shop doesn't need these", "options"] }] : []),
    { k: "staff", t: "Add your staff", d: "Type each staff's name and phone. Each one gets their own login.", go: "Add staff", done: staffList.some(x => x.role !== "owner") || !!st.alone, skip: ["I work alone", "alone"] },
    { k: "push", t: "Turn on notifications", d: "Get a buzz when staff log clothes.", go: "Turn on", done: pushSupported() && Notification.permission === "granted" },
    { k: "order", t: "Log your first customer's clothes", d: "Try it with the next customer who walks in.", go: "Log", done: orders.length > 0 },
  ];
}
const tutFor = k => { const t = (tuts || []).find(t => t.step_key === k && (t.audience !== "staff")); return t ? t.youtube_id : null; };
// Shown once after a shop signs up on its own, until they log their first customer.
function welcomeCard() {
  let on = false; try { on = sessionStorage.getItem("tb-welcome") === "1"; } catch (_) { }
  if (!on || !own()) return "";
  if (orders.length) { try { sessionStorage.removeItem("tb-welcome"); } catch (_) { } return ""; }
  const first = ((me && me.name) || "").split(" ").filter(w => !/^(mr|mrs|miss|ms|dr|chief)\.?$/i.test(w))[0] || "";
  // Prices first: bills use them, so logging clothes on the sample prices would give wrong totals.
  const pricesDone = !!setupState().prices;
  return `<section class="scard welcome"><h3>Welcome to Tagbook${first ? ", " + esc(first) : ""} 🎉</h3>
    ${pricesDone
      ? `<p>Your prices are set. Now log the next customer who brings clothes. It's the quickest way to learn Tagbook.</p>
         <button class="btn btn-primary" id="wlog">+ Log clothes</button>`
      : `<p>Your free month has started. First, put in your prices. Every bill is worked out from them.</p>
         <button class="btn btn-primary" id="wprices">Check my prices</button>`}
    <p class="hint">We'll also call you shortly to help you get started.</p></section>`;
}
function setupCard() {
  if (!own() || !priv || setupState().complete || setupLater()) return "";
  if (!tuts && !tutsBusy) loadTuts().then(() => { if (tab === "orders" && !openNo) renderOrders(); });
  const steps = setupSteps(), n = steps.filter(x => x.done).length;
  if (n === steps.length) { markSetup("complete"); return `<section class="scard sdone"><span class="sbig">${TICK}</span><div><b>Your shop is ready</b><span>Every customer's clothes, bill and payment, now in one place.</span></div></section>`; }
  const next = steps.findIndex(x => !x.done);
  return `<section class="scard setup"><div class="cl-top"><h3>Get your shop ready</h3><span class="count">${n} of ${steps.length} done</span></div>
    <p class="hint" style="margin:2px 0 8px">Tap the green button on a step and finish it there. The tick comes by itself once it's really done.</p>
    <div class="segs">${steps.map(x => `<i class="${x.done ? "on" : ""}"></i>`).join("")}</div>
    <ul class="ssteps">${steps.map((x, i) => `<li class="sstep ${x.done ? "done" : ""} ${i === next ? "next" : ""}">
      <span class="tick">${TICK}</span><span class="txt"><b>${x.t}</b>${x.done ? "" : `<span>${x.d}${x.skip ? ` <button class="linkbtn" data-sskip="${x.skip[1]}">${x.skip[0]}</button>` : ""}${tutFor(x.k) ? ` <button class="linkbtn" data-watch="${tutFor(x.k)}">Watch how</button>` : ""}</span>`}</span>
      ${x.done ? "" : `<button class="go" data-sgo="${x.k}">${x.go}</button>`}</li>
      ${x.k === "install" && !x.done && instOpen ? `<li class="sinst">${installSteps()}</li>` : ""}`).join("")}</ul>
    <button class="linkbtn" id="slater">Hide for now</button></section>`;
}
const TICK = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function wireSetup() {
  view.querySelectorAll("[data-sgo]").forEach(b => b.onclick = async () => {
    const k = b.dataset.sgo;
    if (k === "install") { if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); try { await e.userChoice; } catch (_) { } } else instOpen = !instOpen; return renderOrders(); }
    if (k === "prices") { setTab = "prices"; return go("shop"); }
    if (k === "bank") { setTab = "business"; go("shop"); setTimeout(() => { const f = $("#an"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }, 250); return; }
    if (k === "staff") { setTab = "staff"; return go("shop"); }
    if (k === "invoice") { setTab = "invoice"; return go("shop"); }
    if (k === "options") { setTab = "business"; go("shop"); setTimeout(() => { const f = $("#oc"); if (f) f.scrollIntoView({ block: "center" }); }, 250); return; }
    if (k === "push") { if (!pushSupported()) { toast(isIOS ? "Install Tagbook first (the step above), then open it from your Home Screen." : "This browser can't show notifications."); return; } await enablePush(); return renderOrders(); }
    if (k === "order") return go("log");
  });
  view.querySelectorAll("[data-watch]").forEach(b => b.onclick = () => go("help-" + b.dataset.watch));
  view.querySelectorAll("[data-sskip]").forEach(a => a.onclick = async () => { await markSetup(a.dataset.sskip); renderOrders(); });
  const l = $("#slater"); if (l) l.onclick = () => { try { localStorage.setItem("tb-setup-later", Date.now()); } catch (_) { } renderOrders(); };
}

/* After login: a card on the main screen until Tagbook is installed on this phone */
const isPhone = () => /Android|iPhone|iPod/i.test(navigator.userAgent);
// What to call this device in messages: install and notifications aren't only on phones.
const device = () => isPhone() ? "phone" : isIOS || /Android/i.test(navigator.userAgent) ? "tablet" : "laptop";
const installCardLater = () => { try { return Date.now() - (+localStorage.getItem("tb-install-card") || 0) < 864e5; } catch (_) { return false; } };
function installCard() {
  if (inPlay) return "";
  if (standalone() || installCardLater() || (!installEvt && !isPhone())) return "";
  const steps = installEvt ? "" : installSteps();
  return `<section class="scard icard"><div class="ihead"><img src="/icon-192.png" alt=""><div><b>Install Tagbook on this ${device()}</b><span>It opens like an app, stays logged in and can send you notifications.</span></div></div>
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
  pushNow = "on"; pushWasOn(true); pushLog("turned_on", `${isIOS ? "iOS" : "other"} ${standalone() ? "app" : "browser"}`); toast("Notifications are on"); return true;
}
async function disablePush() {
  const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); try { await sub.unsubscribe(); } catch (_) { } }
  pushNow = "off"; pushWasOn(false); pushLog("turned_off", "");
}
// Logging out: stop this login's alerts on this phone, but keep the phone's subscription, so whoever logs in next
// (often the same owner) gets alerts again straight away. Unsubscribing here used to turn alerts off after every log out.
async function forgetPushHere() {
  const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
  if (sub) await sb.from("push_subs").delete().eq("endpoint", sub.endpoint);
}
// keep this phone's subscription saved (the address can change after updates)
// Self-repair: if alerts were on for this login and the phone has lost them, turn them back on quietly
// (only works when the phone still allows notifications). Every switch-off is written to push_log so we can see why.
const pushWasOn = v => { const k = "tb-push-on-" + (me && me.user_id); try { if (v === undefined) return localStorage.getItem(k) === "1"; v ? localStorage.setItem(k, "1") : localStorage.removeItem(k); } catch (_) { return false; } };
const pushLog = (kind, detail) => { try { sb.from("push_log").insert({ user_id: me.user_id, shop_id: shop.id, kind, detail: String(detail || "").slice(0, 200) }).then(() => { }, () => { }); } catch (_) { } };
async function syncPush() {
  if (!(own() || newOpts()) || !pushSupported()) return;
  const was = pushWasOn(), env = `${isIOS ? "iOS" : "other"} ${standalone() ? "app" : "browser"}`;
  if (Notification.permission !== "granted") {
    if (was) { pushLog("permission_lost", `${Notification.permission} · ${env}`); pushWasOn(false); }
    return;
  }
  const reg = await swReg(); let sub = reg && await reg.pushManager.getSubscription();
  if (!sub && was && reg) {
    try { await navigator.serviceWorker.ready; sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) }); pushLog("resubscribed", env); }
    catch (e) { pushLog("resubscribe_failed", `${(e && e.name) || "error"} · ${env}`); pushLog("lost_on_phone", env); pushWasOn(false); return; }
    if (pushNow === "off") { pushNow = "on"; if (tab === "orders") keepTyped(renderOrders); }
  }
  if (sub) { if (await saveSub(sub)) pushWasOn(true); }
}
// "Not now" hides the banner for 7 days, then it comes back until alerts are on (it used to hide it forever).
const pushDismissed = () => { try { const v = +localStorage.getItem("tb-push-later") || 0; return v > 1 && Date.now() - v < 7 * 864e5; } catch (_) { return false; } };
// Whether this phone is really getting alerts: checked once when the app opens.
let pushNow = null;

/* ---------- Orders ---------- */
function renderOrders() {
  const fresh = orders.filter(o => !o.notified);
  const toList = orders.filter(o => o.status === "new");
  const notTold = orders.filter(o => o.status === "ready");
  const owing = orders.reduce((s, o) => s + ((o.status === "told" || o.status === "picked") ? (own() ? owed(o) : 0) : 0), 0);
  const inShop = orders.filter(o => o.status !== "picked");
  const fl = canBill()
    ? [["all", "All"], ["new", "Send list"], ["work", "In progress"], ["ready", "Ready, not told"], ["owed", "Owing"], ["picked", "Picked up"], ...(cancelledOrders.length || filter === "cx" ? [["cx", "Cancelled"]] : [])]
    : [["all", "All"], ["work", "In progress"], ["ready", "Ready"], ["picked", "Picked up"]];
  const inF = (o, f) => {
    // Owner: "In progress" = list sent, being washed (new ones sit under "Send list"). Staff: everything not yet ready.
    if (f === "work" && !(canBill() ? o.status === "listed" : (o.status === "new" || o.status === "listed"))) return false;
    if (f === "new" && o.status !== "new") return false;
    if (f === "ready" && !(canBill() ? o.status === "ready" : (o.status === "ready" || o.status === "told"))) return false;
    if (f === "owed" && !((o.status === "told" || o.status === "picked") && owed(o))) return false;
    if (f === "picked" && o.status !== "picked") return false;
    return true;
  };
  const list = (filter === "cx" ? cancelledOrders : orders).filter(o => {
    if (!inF(o, filter)) return false;
    if (query) {
      const c = cust(o.cid), q = query.toLowerCase().replace(/\s/g, "");
      return (canBill() && c.phone.includes(q)) || c.name.toLowerCase().replace(/\s/g, "").includes(q) || c.mark.toLowerCase() === q || String(o.no).includes(q);
    }
    return true;
  }).sort((a, b) => b.no - a.no);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE)); if (page >= pages) page = pages - 1; if (page < 0) page = 0;
  const shown = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const setupHtml = setupCard();
  const askPush = !setupHtml.includes("setup") && (own() || newOpts()) && pushSupported() && pushNow === "off" && !pushDismissed();
  view.innerHTML = `
    ${planBanner()}
    ${welcomeCard()}
    ${dutyBlock()}
    ${dueCard()}
    ${setupHtml || installCard()}
    ${askPush ? `<div class="alert push"><span>${own() ? "Get a buzz when staff log clothes, even when Tagbook is closed." : "Get a reminder when clothes are due tomorrow, due today or late, even when Tagbook is closed."}</span><span class="pacts"><button id="pushon">Turn on</button><button class="later" id="pushlater">Not now</button></span></div>` : ""}
    ${own() && fresh.length ? `<div class="alert"><span>${fresh.length} new order${fresh.length > 1 ? "s" : ""} logged by staff. Send the list of clothes to the customer.</span><button id="seen">See</button></div>` : ""}
    ${own() ? `<div class="stats">
      <button class="stat ${toList.length ? "hot" : ""}" data-go="new"><b>${toList.length}</b><span>Send list</span></button>
      <button class="stat ${notTold.length ? "hot" : ""}" data-go="ready"><b>${notTold.length}</b><span>Ready, not told</span></button>
      <button class="stat" data-go="owed"><b>${naira(owing)}</b><span>Owed to you</span></button></div>`
      : `<div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><b>${inShop.length}</b><span>Orders in the shop</span></div>
      <div class="stat"><b>${inShop.reduce((s, o) => s + calc(o).count, 0)}</b><span>Clothes in the shop</span></div></div>`}
    <input class="search" id="q" placeholder="${canBill() ? "Search phone, name or mark (BO)" : "Search name or mark (BO)"}" value="${esc(query)}" aria-label="Search">
    <div class="chips">${fl.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}<span class="cnt">${k === "cx" ? cancelledOrders.length : orders.filter(o => inF(o, k)).length}</span></button>`).join("")}</div>
    <div class="list">${shown.length ? shown.map(o => {
      const c = cust(o.cid), k = calc(o); return `
      <button class="order" data-no="${o.no}">
        <div class="${markCls(c.mark)}">${esc(c.mark)}</div>
        <div class="who"><b>${esc(c.name)}</b><span>#${o.no} · ${countTxt(o)}${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}${o.wait ? " · wait & get" : ""}${collectTag(o)}</span></div>
        <div class="right">${orderRight(o, filter === "all" || !!query)}</div>
      </button>`;
    }).join("") : `<div class="empty">${orders.length ? "No orders here. Change the filter or search." : "No orders yet. Tap “+ Log clothes” to add the first one."}</div>`}</div>
    ${pages > 1 ? `<div class="pager"><button class="mini" id="pgprev" ${page === 0 ? "disabled" : ""} aria-label="Newer orders">‹ Newer</button>
      <span>${page * PER_PAGE + 1}–${page * PER_PAGE + shown.length} of ${list.length}</span>
      <button class="mini" id="pgnext" ${page >= pages - 1 ? "disabled" : ""} aria-label="Older orders">Older ›</button></div>` : ""}
    <p class="foot">Tagbook by Ordiventa · version ${String(window.TB_BUILD || "").slice(4, 12)} · <a href="/privacy">Privacy policy</a></p>`;
  const toTop = () => { const t = $("#q"), sc = mainScroll(); if (t) sc.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top) + sc.scrollTop - 12) }); };
  if ($("#pgprev")) $("#pgprev").onclick = () => { page--; renderOrders(); toTop(); };
  if ($("#pgnext")) $("#pgnext").onclick = () => { page++; renderOrders(); toTop(); };
  $("#q").oninput = e => { query = e.target.value; page = 0; const p = e.target.selectionStart; renderOrders(); const q = $("#q"); q.focus(); q.setSelectionRange(p, p); };
  view.querySelectorAll(".chip").forEach(c => c.onclick = () => { filter = c.dataset.f; page = 0; renderOrders(); });
  view.querySelectorAll("[data-go]").forEach(c => c.onclick = () => { filter = c.dataset.go; page = 0; renderOrders(); });
  view.querySelectorAll(".order").forEach(b => b.onclick = () => go("order-" + b.dataset.no));
  wirePlanBanner(view); wireInstallCard(); wireSetup(); wireDuty(renderOrders);
  view.querySelectorAll("[data-dmore]").forEach(b => b.onclick = () => { dueOpen[b.dataset.dmore] = !dueOpen[b.dataset.dmore]; renderOrders(); });
  if ($("#wlog")) $("#wlog").onclick = () => go("log");
  if ($("#wprices")) $("#wprices").onclick = () => { setTab = "prices"; go("shop"); };
  if ($("#pushon")) $("#pushon").onclick = async () => { await enablePush(); renderOrders(); };
  if ($("#pushlater")) $("#pushlater").onclick = () => { try { localStorage.setItem("tb-push-later", String(Date.now())); } catch (_) { } renderOrders(); };
  const s = $("#seen"); if (s) s.onclick = () => {
    const ids = fresh.map(o => o.id); fresh.forEach(o => o.notified = true); filter = "new"; renderOrders();
    sb.from("orders").update({ notified: true }).in("id", ids).then(({ error }) => { if (error) { toast(failMsg(error)); refresh(); } });
  };
}

/* ---------- Log clothes ---------- */
let d;
function reset() { d = { method: null, cust: null, q: "", newMode: false, phone: "", found: undefined, name: "", hasMark: null, mark: "", branch: (liveBranches()[0] || {}).id || null, greet: "", greetOther: false, svc: "wi", items: [], express: false, wait: false, pickup: false, cDate: "", cTime: "", cOther: false, tOther: false, expDays: 0, rm: [], money: 0, rmOther: false, askSpecial: false, specialName: "", specialPrice: 0, askPrice: null, askPriceVal: 0, paid: 0, saving: false, ed: null }; }
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
    if (canBill() && dg.length >= 4 && c.phone.includes(dg)) return 1;
    const n = c.name.toLowerCase();
    if (n.startsWith(t) || n.split(/\s+/).some(w => w.startsWith(t))) return 2;
    if (n.includes(t)) return 3;
    if (c.mark.toLowerCase().startsWith(t)) return 4;
    return 9;
  };
  return customers.map(c => [score(c), c]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 8).map(([, c]) => c);
}
let lookupFor = "";
// Owner only: fill a new customer's phone and name from the phone's contacts (Android Chrome; iPhone has no contact picker for web apps).
// Asked for by Bran Neuw Services. BrightWash first, everyone from 25 Nov.
const PICK_LIVE = Date.parse("2026-11-25T08:00:00+01:00");
const canPick = () => own() && "contacts" in navigator && "ContactsManager" in window && !!shop && (shop.id === PHOTO_SHOP || Date.now() >= PICK_LIVE || location.hostname === "localhost");
const toLocal = t => { let n = digits(t); if (n.startsWith("234")) n = "0" + n.slice(3); else if (n.length === 10 && /^[789]/.test(n)) n = "0" + n; return /^0\d{10}$/.test(n) ? n : ""; };
async function pickContact() {
  let r; try { r = await navigator.contacts.select(["name", "tel"], { multiple: false }); } catch (_) { return; }
  const c = r && r[0]; if (!c) return;
  const ph = (c.tel || []).map(toLocal).find(Boolean);
  if (!ph) { toast("That contact has no Nigerian phone number"); return; }
  d.phone = ph; d.found = undefined;
  const nm = String((c.name || [])[0] || "").replace(/[^a-z\s'-]/gi, " ").replace(/\s+/g, " ").trim();
  if (nm && !d.name) d.name = nm.slice(0, 40);
  renderNew(); lookup(ph);
}
async function lookup(phone) {
  lookupFor = phone; d.found = "loading";
  const { data, error } = await sb.rpc("find_customer", { p_phone: phone });
  if (lookupFor !== phone || d.phone !== phone) return;
  d.found = error ? undefined : (data && data[0]) || null;
  if (error) toast(failMsg(error));
  if (tab === "new") renderNew();
}
const custRow = c => `<button class="crow" data-pick="${c.id}"><span class="${markCls(c.mark)}">${esc(c.mark)}</span><span class="cn"><b>${esc(c.name)}</b>${canBill() && c.phone ? `<small>${fmtPhone(c.phone)}</small>` : ""}</span></button>`;
function customerBlock() {
  if (d.cust) return `<div class="cpicked"><span class="${markCls(d.cust.mark)}">${esc(d.cust.mark)}</span><span class="cn"><b>${esc(d.cust.name)}</b><small>Regular customer. Write <b>${esc(d.cust.mark)}</b> inside every cloth.</small></span><button class="mini" id="cchange">Change</button></div>`;
  if (!d.newMode) {
    const res = searchCustomers(d.q), recent = d.q ? [] : recentCustomers(5);
    const dg = digits(d.q), phoneLike = /^0\d{10}$/.test(dg) && dg === d.q.replace(/\s/g, "");
    return `<input id="cq" class="search" style="margin:0" placeholder="${canBill() ? "Search name, mark (BO) or phone" : "Search name or mark (BO)"}" value="${esc(d.q)}" autocomplete="off" aria-label="Find customer">
      ${res.length ? `<div class="clist">${res.map(custRow).join("")}</div>` : ""}
      ${d.q && !res.length ? `<p class="hint">${phoneLike ? "Checking this number…" : `No customer called “${esc(d.q)}”.`}</p>` : ""}
      ${recent.length ? `<p class="clabel">Recent customers</p><div class="clist">${recent.map(custRow).join("")}</div>` : ""}
      <button class="btn btn-ghost" id="cnew">+ New customer</button>`;
  }
  // new customer: phone first (it might still be someone we know), then name and mark
  const existing = d.phone.length === 11 && d.found && d.found !== "loading" ? d.found : null;
  let b = `<div class="newc"><div class="row" style="justify-content:space-between;align-items:center"><b>New customer</b><button class="mini" id="cback">Back to search</button></div>
    <label for="ph">Phone number</label><input id="ph" type="text" inputmode="tel" value="${d.phone}" autocomplete="off">${canPick() ? `<button class="lnbtn" id="cpick" type="button">Pick from my contacts</button>` : ""}`;
  if (d.phone.length === 11 && d.found === "loading") b += `<p class="hint">Checking this number…</p>`;
  else if (existing) b += `<div class="found">This number is already a customer: <b>${esc(existing.name)}</b>, mark <b>${esc(existing.mark)}</b>. <button class="mini" id="cuse" style="margin-left:6px">Use</button></div>`;
  else if (d.phone.length === 11 && d.found === null) {
    const clash = d.hasMark === "yes" && d.mark && markTaken(d.mark);
    b += `<label for="nm">Customer name</label><input id="nm" value="${esc(d.name)}" autocomplete="off">
      ${own() ? `<label>How do you greet them in messages?</label>${greetChips(d.greet, "data-gr", d.greetOther)}
      <p class="gprev" id="gprev">Messages will start: <b>${d.greet ? `${hello({ greet: d.greet })},` : d.greetOther ? "Hello …," : `Hello ${esc((d.name.trim() || "Bola").split(" ")[0])},`}</b></p>` : ""}
      <label>Does this customer already have a mark on their clothes?</label>
      <div class="chips" style="margin:0"><button class="chip" data-hm="yes" aria-pressed="${d.hasMark === "yes"}">Yes, use it</button><button class="chip" data-hm="no" aria-pressed="${d.hasMark === "no"}">No, give one</button></div>
      ${d.hasMark === "yes" ? `<label for="mk">Their mark</label><input id="mk" placeholder="e.g. BL or 1045" value="${esc(d.mark)}" maxlength="12" autocomplete="off"><p class="hint">Letters and numbers, up to 8.</p>
        ${clash ? `<div class="bad">${esc(clash.mark)} is already used by ${esc(clash.name)}. Use a different mark so their clothes don't mix.</div>` : ""}` : ""}
      ${d.hasMark === "no" && d.name.trim() ? `<div class="found">New mark: <b>${suggest(d.name)}</b>. Write this inside every cloth.</div>` : ""}`;
  } else b += `<p class="hint">Ask the customer for their number. Next time, you'll find them by name.</p>`;
  return b + `</div>`;
}
// A colour or note for one line of clothes, and how many pieces one of them has (Impressions Laundry asked for both).
const newLine = id => { const n = (item(id) || {}).pieces; return { id, svc: d.svc, qty: 1, ...(teamLive() && n > 1 ? { pcs: n } : {}) }; };
function lineEditor(it, i) {
  const nm = it.label || (item(it.id) || {}).name || "item";
  return `<div class="lned">
    <label for="lnn" style="margin-top:0">Colour or note</label><input id="lnn" maxlength="30" placeholder="e.g. green, or with stripes" value="${esc(it.note || "")}" autocomplete="off">
    <div class="lnpc"><span>Pieces in one ${esc(nm)}</span>
      <div class="qty"><button type="button" data-pcd aria-label="One piece less">−</button><b style="min-width:22px;text-align:center">${pcsOf(it)}</b><button type="button" data-pci aria-label="One piece more">+</button></div></div>
    ${it.qty > 1 ? `<button type="button" class="lnbtn" id="lnsplit">One ${esc(nm)} is a different colour? Put it on its own line</button>` : ""}
    <button type="button" class="btn btn-ghost" id="lndone" style="margin-top:6px">Done</button></div>`;
}
function renderNew() {
  if (planEnded()) {
    view.innerHTML = `${backBtn("Orders")}<h2>Log clothes</h2>${planBanner()}<p class="hint">You can still open every order you already logged. ${own() ? "Once you pay, logging opens again straight away." : "Logging opens again as soon as the owner pays."}</p>`;
    wireBack(view); wirePlanBanner(view); return;
  }
  if (!d.branch || !liveBranches().some(b => b.id === d.branch)) d.branch = (liveBranches()[0] || {}).id || null;
  const count = d.items.reduce((s, it) => s + it.qty, 0);
  // Only show services the shop actually prices (Starch and iron is new, and not every shop offers it).
  const offered = Object.keys(SERVICES).filter(k => PRICES.some(p => !p.hidden && (p.services || []).includes(k)));
  const svcList = offered.length ? offered : Object.keys(SERVICES).filter(k => k !== "si");
  if (!svcList.includes(d.svc)) d.svc = svcList[0];
  const pickable = PRICES.filter(p => !p.hidden && (p.custom || (p.services || []).includes(d.svc)));
  // Express for some clothes only: those clothes become their own express order when saved.
  const xpOn = xpLive() && !d.wait && !d.express && d.items.length > 1;
  if (!xpOn && !d.express) d.items.forEach(i => { i.x = false; });
  const split = xpOn && d.items.some(i => i.x) && d.items.some(i => !i.x), allX = xpOn && d.items.length && d.items.every(i => i.x);
  view.innerHTML = `
    ${backBtn("Orders")}
    <h2>Log clothes</h2>
    ${dutyBlock()}
    <label>Customer</label>
    ${customerBlock()}
    ${liveBranches().length > 1 ? `<label for="br">Dropped at</label>
    <select id="br">${liveBranches().map(b => `<option value="${b.id}" ${d.branch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : ""}
    <label>Service</label>
    <div class="chips" style="margin:0">${svcList.map(s => `<button class="chip" data-svc="${s}" aria-pressed="${d.svc === s}">${SERVICES[s]}</button>`).join("")}</div>
    <label>Tap to add clothes</label>
    <div class="picker">${pickable.map(p => `<button data-add="${p.id}">${esc(p.name)}${p.custom ? "<small>Wedding gown, curtain</small>" : !hasPrice(p.id, d.svc) ? "<small class=\"nop\">No price yet</small>" : ""}</button>`).join("")}</div>
    ${d.askSpecial ? `<div class="check" style="margin-top:8px"><label for="sp" style="margin-top:0">What is the special item?</label>
      <input id="sp" placeholder="e.g. Wedding gown" value="${esc(d.specialName)}" autocomplete="off">
      ${own() ? `<label for="spp">Price for ${SERVICES[d.svc].toLowerCase()} (₦)</label><input id="spp" ${moneyAttrs} placeholder="e.g. 5000" value="${d.specialPrice || ""}">
      <p class="hint">With a price, it's also added to your price list, so next time just tap it. Leave it empty to set the price on the bill.</p>` : ""}
      <div class="row"><button class="btn btn-ghost" id="spc">Cancel</button><button class="btn btn-primary" id="spa" ${d.specialName.trim() ? "" : "disabled"}>Add item</button></div></div>` : ""}
    ${d.askPrice && item(d.askPrice) ? `<div class="check pneed" style="margin-top:8px"><b>Price not set yet</b>
      <label for="aprice" style="margin-top:6px">How much do you charge for ${esc(item(d.askPrice).name)} (${SERVICES[d.svc].toLowerCase()})? (₦)</label>
      <input id="aprice" ${moneyAttrs} placeholder="e.g. 800" value="${d.askPriceVal || ""}">
      <p class="hint">It's saved to your price list, so next time it's one tap.</p>
      <div class="row"><button class="btn btn-ghost" id="apc">Cancel</button><button class="btn btn-primary" id="apa">Save price and add</button></div></div>` : ""}
    <div class="items">${d.items.map((it, i) => `
      <div class="item"><span>${esc(pname(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}${pcsOf(it) > 1 ? ` · ${pcsOf(it)} pieces each` : ""}</small>${teamLive() && d.ed !== i ? `<br><button type="button" class="lnbtn" data-ed="${i}">${it.note || pcsOf(it) > 1 ? "Change colour or pieces" : "+ Colour or note"}</button>` : ""}${xpOn ? `<br><button type="button" class="xpchip" data-xp="${i}" aria-pressed="${!!it.x}">⚡ ${it.x ? "Express" : "Make express"}</button>` : ""}</span>
      <div class="qty">${photosOn() ? `<button data-cam="${i}" class="cam${(it.photos || []).length ? " on" : ""}" aria-label="Add a photo of ${esc(pname(it))}">${CAM_SVG}</button>` : ""}<button data-dec="${i}" aria-label="Remove one">−</button><b style="min-width:22px;text-align:center">${it.qty}</b><button data-inc="${i}" aria-label="Add one">+</button></div>
      ${(it.photos || []).length ? `<div class="phedit">${photoThumbs(it.photos.map(b => b.url), i)}
        <p class="phq">What did you notice?</p><div class="chips rpick" style="margin:0">${photoNotes().map(n => `<button class="chip" data-pn="${i}" data-note="${esc(n)}" aria-pressed="${(it.pn || []).includes(n)}">${n}</button>`).join("")}</div></div>` : ""}${teamLive() && d.ed === i ? lineEditor(it, i) : ""}</div>`).join("")}</div>
    ${shop.wait_get_on ? `<label>How fast?</label><div class="chips" style="margin:0">${[["std", "Standard"], ["exp", "Express"], ["wait", "Wait & get"]].map(([k, l]) => `<button class="chip" data-spd="${k}" aria-pressed="${(k === "wait" && d.wait) || (k === "exp" && d.express && !d.wait) || (k === "std" && !d.express && !d.wait)}">${l}</button>`).join("")}</div>`
      : `<label class="toggle"><span>Express delivery${xpOn ? " (all clothes)" : ""}</span><input type="checkbox" id="ex" ${d.express ? "checked" : ""}></label>`}
    ${split ? `<p class="xpnote">⚡ ${d.items.filter(i => i.x).reduce((n, i) => n + i.qty, 0)} express, ${d.items.filter(i => !i.x).reduce((n, i) => n + i.qty, 0)} normal. They'll be saved as 2 orders for this customer, so the express clothes get their own ready date, ready message and express charge.</p>` : ""}
    ${shop.collect_dates ? (split ? `<div class="xpcol"><b>Express clothes</b>${collectPicker(Object.assign(Object.create(d), { express: true }))}</div><div class="xpcol"><b>Other clothes</b>${collectPicker(Object.assign(Object.create(d), { express: false, wait: false }))}</div>` : collectPicker(allX ? Object.assign(Object.create(d), { express: true }) : d)) : ""}
    <label class="toggle"><span>Pickup and delivery</span><input type="checkbox" id="pk" ${d.pickup ? "checked" : ""}></label>
    ${newOpts() ? remarkPicker(d) : ""}
    <label for="pd">Paid now (₦)</label><input id="pd" ${moneyAttrs} placeholder="0" value="${d.paid || ""}">
    ${d.paid ? "" : `<p class="hint">Leave empty if the customer will pay later.</p>`}
    <div class="lines"><div><b>Clothes logged</b><b>${count}${pieceCount(d.items) > count ? ` items, ${pieceCount(d.items)} pieces` : ""}</b></div></div>
    <p class="hint">${canBill() ? "After saving, you can send the list of clothes to the customer straight away." : "Saving sends this order to the owner's phone. The owner sends the list of clothes to the customer."}</p>
    <p class="bad" id="saveerr" role="alert" hidden></p>
    <button class="btn btn-primary" id="save" ${d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : split ? (canBill() ? "Save 2 orders" : "Save 2 orders and send to owner") : canBill() ? "Save order" : "Save and send to owner"}</button>
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
  if ($("#cpick")) $("#cpick").onclick = pickContact;
  if ($("#cback")) $("#cback").onclick = () => { d.newMode = false; d.phone = ""; d.found = undefined; d.name = ""; d.hasMark = null; d.mark = ""; renderNew(); };
  if ($("#cuse")) $("#cuse").onclick = () => { const f = d.found; d.cust = { id: f.id, name: f.name, mark: f.mark }; d.newMode = false; d.phone = ""; d.found = undefined; renderNew(); };
  keep("#ph", v => { const nv = digits(v).slice(0, 11); if (nv !== d.phone) { d.phone = nv; d.found = undefined; if (nv.length === 11) lookup(nv); } });
  keep("#nm", v => d.name = v.replace(/[^a-z\s'-]/gi, ""));
  view.querySelectorAll("[data-gr]").forEach(b => b.onclick = () => { const v = b.dataset.gr; d.greetOther = v === "__other"; d.greet = d.greetOther ? "" : v; renderNew(); if (d.greetOther) { const t = $("#data-gr-txt"); if (t) t.focus(); } });
  const gt = $("#data-gr-txt"); if (gt) gt.oninput = e => { d.greet = cleanGreet(e.target.value); const pv = $("#gprev b"); if (pv) pv.textContent = d.greet ? `Hello ${d.greet},` : "Hello …,"; };
  keep("#mk", v => d.mark = v.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()); // up to 8, for shops with existing tag numbers
  keep("#sp", v => d.specialName = v);
  const pd = $("#pd"); if (pd) pd.oninput = e => { const c = digits(e.target.value); const had = !!d.paid; d.paid = num(c); if (e.target.value !== c) e.target.value = c; if (had !== !!d.paid) { const p = e.target.selectionStart; renderNew(); const n = $("#pd"); n.focus(); try { n.setSelectionRange(p, p); } catch (_) { } } };
  view.querySelectorAll("[data-dm]").forEach(b => b.onclick = () => { d.method = b.dataset.dm; renderNew(); });
  if ($("#br")) $("#br").onchange = e => d.branch = e.target.value;
  if ($("#ex")) $("#ex").onchange = e => { d.express = e.target.checked; };
  view.querySelectorAll("[data-spd]").forEach(b => b.onclick = () => { d.express = b.dataset.spd === "exp"; d.wait = b.dataset.spd === "wait"; renderNew(); });
  wireCollect(view, d, renderNew); wireRemarks(view, d, renderNew);
  $("#pk").onchange = e => { d.pickup = e.target.checked; };
  view.querySelectorAll("[data-hm]").forEach(b => b.onclick = () => { d.hasMark = b.dataset.hm; renderNew(); });
  view.querySelectorAll("[data-svc]").forEach(b => b.onclick = () => { d.svc = b.dataset.svc; renderNew(); });
  view.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    if ((item(id) || {}).custom) { d.askSpecial = id; d.specialName = ""; d.specialPrice = 0; renderNew(); $("#sp").focus(); return; }
    if (!hasPrice(id, d.svc)) {
      if (own()) { d.askPrice = id; d.askPriceVal = 0; d.askSpecial = false; renderNew(); const f = $("#aprice"); if (f) f.focus(); return; }
      toast(`No price for ${item(id).name} yet. The owner will set it before the bill.`);
    }
    const f = d.items.find(i => i.id === id && i.svc === d.svc && !i.label && !i.note); f ? f.qty++ : d.items.push(newLine(id)); renderNew();
  });
  if ($("#spc")) $("#spc").onclick = () => { d.askSpecial = false; renderNew(); };
  const apIn = $("#aprice"); if (apIn) apIn.oninput = e => { const c = digits(e.target.value); d.askPriceVal = num(c); if (e.target.value !== c) e.target.value = c; };
  if ($("#apc")) $("#apc").onclick = () => { d.askPrice = null; renderNew(); };
  if ($("#apa")) $("#apa").onclick = async () => {
    if (!d.askPriceVal) { toast("Type the price first"); $("#aprice").focus(); return; }
    const btn = $("#apa"); btn.disabled = true; btn.textContent = "Saving…";
    const id = d.askPrice, nm = item(id).name;
    if (!(await setPrice(id, d.svc, d.askPriceVal))) { btn.disabled = false; btn.textContent = "Save price and add"; return; }
    const f = d.items.find(i => i.id === id && i.svc === d.svc && !i.label && !i.note); f ? f.qty++ : d.items.push(newLine(id));
    toast(`${nm}: ${naira(d.askPriceVal)} saved to your price list`); d.askPrice = null; d.askPriceVal = 0; renderNew();
  };
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
  view.querySelectorAll("[data-cam],[data-phmore]").forEach(b => b.onclick = () => { const it = d.items[+(b.dataset.cam || b.dataset.phmore)]; if (b.dataset.cam && (it.photos || []).length) return; pickPhoto(blob => { it.photos = [...(it.photos || []), { blob, url: URL.createObjectURL(blob) }].slice(0, 2); renderNew(); }); });
  view.querySelectorAll("[data-phdel]").forEach(b => b.onclick = () => { const [i, j] = b.dataset.phdel.split(":").map(Number), it = d.items[i]; URL.revokeObjectURL(it.photos[j].url); it.photos.splice(j, 1); if (!it.photos.length) it.pn = []; renderNew(); });
  view.querySelectorAll("[data-pn]").forEach(b => b.onclick = () => {
    const it = d.items[+b.dataset.pn], n = b.dataset.note, on = !(it.pn || []).includes(n);
    it.pn = on ? [...(it.pn || []), n] : it.pn.filter(x => x !== n);
    if (syncsRemark(n)) { if (on && !d.rm.includes(n)) d.rm = [...d.rm, n]; if (!on && !d.items.some(x => (x.pn || []).includes(n))) d.rm = d.rm.filter(x => x !== n); }
    renderNew();
  });
  view.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => { d.items[+b.dataset.inc].qty++; renderNew(); });
  view.querySelectorAll("[data-xp]").forEach(b => b.onclick = () => { const it = d.items[+b.dataset.xp]; it.x = !it.x; renderNew(); });
  view.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const i = +b.dataset.dec; d.items[i].qty--; if (!d.items[i].qty) { d.items.splice(i, 1); d.ed = null; } renderNew(); });
  wireDuty(renderNew);
  view.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { d.ed = +b.dataset.ed; renderNew(); const n = $("#lnn"); if (n) n.focus(); });
  if (d.ed != null && d.items[d.ed]) {
    const it = d.items[d.ed];
    $("#lnn").oninput = e => { it.note = tidy(e.target.value).slice(0, 30); };
    const setPcs = n => { n = Math.max(1, Math.min(50, n)); if (n > 1) it.pcs = n; else delete it.pcs; renderNew(); };
    view.querySelector("[data-pcd]").onclick = () => setPcs(pcsOf(it) - 1);
    view.querySelector("[data-pci]").onclick = () => setPcs(pcsOf(it) + 1);
    const sp = $("#lnsplit"); if (sp) sp.onclick = () => { it.qty--; const { photos, pn, x, note, ...rest } = it; d.items.splice(d.ed + 1, 0, { ...rest, qty: 1 }); d.ed = d.ed + 1; renderNew(); const n = $("#lnn"); if (n) n.focus(); };
    // Pieces changed here are for this order only; the usual number for each item is set in the price list.
    $("#lndone").onclick = () => { if (!it.note) delete it.note; d.ed = null; renderNew(); };
  } else d.ed = null;
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
      : !d.items.length ? "Add at least one cloth to the order."
      : dutyMissing() ? dutyMissing() : "";
    if (err && err === dutyMissing()) { dutyOpen = true; renderNew(); window.scrollTo({ top: 0, behavior: "smooth" }); toast(err); return; }
    if (err) { showErr(err); if (!d.cust && d.newMode && d.found === undefined && d.phone.length === 11) lookup(d.phone); return; }
    const mark = d.cust ? d.cust.mark : (d.hasMark === "yes" ? d.mark : suggest(d.name));
    const clean = list => list.map(({ photos, pn, x, ...i }) => { if (!i.note) delete i.note; if (pcsOf(i) < 2) delete i.pcs; return { ...i }; });
    const xs = d.items.filter(i => i.x), xpSplit = !d.wait && !d.express && xs.length > 0 && xs.length < d.items.length, xpAll = !d.wait && !d.express && d.items.length > 1 && xs.length === d.items.length;
    const firstItems = xpSplit ? d.items.filter(i => !i.x) : d.items;
    const base = { branch_id: d.branch, items: clean(firstItems), express: (d.express || xpAll) && !d.wait, wait_get: !!(shop.wait_get_on && d.wait), pickup: d.pickup, paid: xpSplit ? 0 : d.paid || 0, method: d.method,
      collect_at: shop.collect_dates ? collectWhen(xpSplit ? { ...d, express: false, wait: false } : xpAll ? { ...d, express: true } : d) : null, remarks: newOpts() && d.rm.length ? d.rm.join("; ").slice(0, 300) : null, money_found: newOpts() && d.money ? d.money : null, ...(dutyNow() ? { duty: dutyNow() } : {}) };
    const p = d.cust ? { ...base, customer_id: d.cust.id } : { ...base, phone: d.phone, name: d.name.trim(), mark, ...(own() ? { greet: d.greet || null } : {}) };
    d.saving = true; renderNew();
    const { data, error } = await sb.rpc("log_order", { p });
    // The express clothes go in their own order for the same customer; any payment goes on that one (collected first).
    let xdata = null;
    if (!error && xpSplit) {
      const r2 = await sb.rpc("log_order", { p: { branch_id: d.branch, items: clean(xs), express: true, wait_get: false, pickup: d.pickup, paid: d.paid || 0, method: d.method,
        collect_at: shop.collect_dates ? collectWhen({ ...d, express: true, wait: false }) : null, remarks: null, money_found: null, customer_id: data.customer_id, ...(dutyNow() ? { duty: dutyNow() } : {}) } });
      if (r2.error) toast(`The normal clothes were saved as order #${data.no}, but the express ones were not: ${failMsg(r2.error)} Log them again as a new order.`);
      else { xdata = r2.data; try { await sb.rpc("pair_orders", { p_a: data.id, p_b: xdata.id }); } catch (_) { } }
    }
    d.saving = false;
    if (error) {
      const m = error.message || "";
      if (/MARK_TAKEN/.test(m)) { showErr(`${mark} is already used by ${m.split("MARK_TAKEN:")[1] || "another customer"}. Use a different mark.`); refresh(); }
      else showErr(failMsg(error));
      renderNew(); return;
    }
    const pics = list => list.flatMap(it => (it.photos || []).map(ph => ({ blob: ph.blob, item: pname(it), notes: it.pn || [] })));
    const pend = pics(firstItems), xpend = xdata ? pics(xs) : [];
    reset(); filter = "all";
    try { await load(); } catch (_) { }
    if (pend.length) savePhotosLater(data.no, pend);
    if (xpend.length) savePhotosLater(xdata.no, xpend);
    const two = xdata ? ` Saved as 2 orders: #${xdata.no} (express) and #${data.no}.` : " Saved.";
    if (canBill()) { go("order-" + (xdata ? xdata.no : data.no)); toast(`${two.trim()} Write ${data.mark} inside every cloth.`); }
    else { go("orders"); toast(`${two.trim()} Write ${data.mark} inside every cloth. The owner has been told.`); }
  };
  function showErr(err) { const e = $("#saveerr"); e.textContent = err; e.hidden = false; toast(err); e.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

/* Phone fields take numbers only (spaces and + are kept for 0803 412 7790 and +234 numbers). */
document.addEventListener("input", e => { const t = e.target; if (t && t.matches && t.matches('input[inputmode="tel"]')) { const v = t.value.replace(/[^\d +]/g, ""); if (v !== t.value) { const p = Math.max(0, (t.selectionStart || v.length) - (t.value.length - v.length)); t.value = v; try { t.setSelectionRange(p, p); } catch (_) { } } } }, true);

/* Names typed or pasted in: drop invisible characters WhatsApp copies along, squeeze spaces. */
const tidy = v => String(v || "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
const NAME_MAX = 50;

/* ---------- Messages ---------- */
function comboBill(o, c, hi) {
  const parts = [o, o.combo].sort((a, b) => (b.express ? 1 : 0) - (a.express ? 1 : 0));
  const total = parts.reduce((s, q) => s + partTotal(q), 0), paid = parts.reduce((s, q) => s + (+q.m.paid || 0), 0), due = Math.max(0, total - paid);
  const sec = q => `${q.express ? "⚡ EXPRESS" : "NORMAL"} (Order #${q.no})${q.collect ? ` · Ready ${fmtDay(q.collect)}` : ""}\n${billLines(q)}`;
  return `${hi}, here is your bill from ${shopName()}.\n\nINVOICE ${invNo(o)}\nDropped: ${fmtDay(o.at)}\nDate: ${fmtDay(Date.now())}\nCustomer: ${c.greet ? "" : `${c.name} `}(Mark ${c.mark})${dutyText(o, true) ? `\n${dutyText(o, true)}` : ""}\n\n${parts.map(sec).join("\n\n")}\n\nTotal: ${naira(total)}${paid ? `\nPaid: ${naira(paid)}` : ""}${due ? `\nAmount to pay: ${naira(due)}${payTo()}` : "\nFully paid. Thank you."}\n\nYour clothes are being cleaned. We will let you know as soon as each order is ready.\n\n_Sent with Tagbook_`;
}
function billLines(o) {
  const k = calc(o);
  return o.items.map((it, i) => `${it.qty} x ${pname(it)}${pcsTag(it)} ${naira(unitPrice(o, it, i) * it.qty)}`).join("\n")
    + (k.exp ? `\n${spName(o)}: ${naira(k.exp)}` : "") + (o.m.delivery ? `\nPickup/delivery: ${naira(o.m.delivery)}` : "") + (o.m.discount ? `\nDiscount: -${naira(o.m.discount)}` : "");
}
function message(o, type) {
  const c = cust(o.cid), k = calc(o), hi = hello(c);
  if (type === "list") {
    const list = o.items.map(it => `${it.qty} x ${pname(it)}${pcsTag(it)} (${SERVICES[it.svc]})`).join("\n");
    return `${hi}, ${shopName()} has received your clothes.\nOrder #${o.no} · Mark ${c.mark} · ${countTxt(o)}${spTag(o)}\n\n${list}${dutyText(o) ? `\n\n${dutyText(o)}` : ""}${pairLine(o)}${o.remarks ? `\n\nNoted on your clothes: ${o.remarks.split("; ").join(", ")}` : ""}${o.money ? `\nMoney found in your pocket: ${naira(o.money)}. We will return it when you collect.` : ""}${listPhotoLine(o)}${o.collect ? `\n\nCollection: ${fmtCollect(o.collect)}` : ""}${o.m.paid ? `\n\nPayment received: ${naira(o.m.paid)}` : ""}\n\nWe will let you know when your clothes are ready, and send your bill with it.${trackLine(o)}\n\n_Sent with Tagbook_`;
  }
  const where = liveBranches().length > 1 && branchName(o.branch) ? `\nCollect at: ${branchName(o.branch)}` : "";
  if (type === "ready") return `${hi}, your clothes are ready at ${shopName()}.${where}\n\nINVOICE INV-${o.no}${spTag(o)}\nDropped: ${fmtDay(o.at)}\nDate: ${fmtDay(Date.now())}\nCustomer: ${c.greet ? "" : `${c.name} `}(Mark ${c.mark})\n${countTxt(o)}${dutyText(o, true) ? `\n${dutyText(o, true)}` : ""}\n\n${billLines(o)}\n\nTotal: ${naira(o.m.total)}${o.m.paid ? `\nPaid: ${naira(o.m.paid)}` : ""}${owed(o) ? `\nAmount to pay: ${naira(owed(o))}${payTo()}` : "\nFully paid. Thank you."}\n\n_Sent with Tagbook_`;
  if (type === "early" && o.combo) return comboBill(o, c, hi);
  if (type === "early") return `${hi}, here is your bill from ${shopName()}.\n\nINVOICE INV-${o.no}${spTag(o)}\nDropped: ${fmtDay(o.at)}\nDate: ${fmtDay(Date.now())}\nCustomer: ${c.greet ? "" : `${c.name} `}(Mark ${c.mark})\n${countTxt(o)}${dutyText(o, true) ? `\n${dutyText(o, true)}` : ""}\n\n${billLines(o)}\n\nTotal: ${naira(o.m.total)}${o.m.paid ? `\nPaid: ${naira(o.m.paid)}` : ""}${owed(o) ? `\nAmount to pay: ${naira(owed(o))}${payTo()}` : "\nFully paid. Thank you."}\n\nYour clothes are being cleaned. We will let you know as soon as they are ready.\n\n_Sent with Tagbook_`;
  return `${hi}, a reminder from ${shopName()}: invoice INV-${o.no} (clothes dropped ${fmtDay(o.at)}) has ${naira(owed(o))} still to pay.${payTo()}\n\nThank you.\n_Sent with Tagbook_`;
}
const waFmt = t => esc(t).replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<i>$2</i>").replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<b>$2</b>");
const wa = (o, t) => { const p = cust(o.cid).phone; return (p ? "https://wa.me/234" + p.slice(1) : "https://wa.me/") + "?text=" + encodeURIComponent(t); };
const MSG_NAMES = { list: "list of clothes", ready: "clothes ready, with invoice", owe: "payment reminder", early: "bill before the clothes are ready" };
function waBlock(o, type, markable) {
  if (type === "early") o = withCombo(o);
  const c = cust(o.cid);
  // Staff don't decide how a customer is greeted, so the owner answers once before the first message goes out.
  if (own() && c.id && !c.greet_asked) return `<div class="gask"><p class="wa-label" style="margin-top:0;color:var(--fg);font-size:15px">Before you send: how do you greet ${esc(c.name)} in messages?</p>
    ${greetChips("-", "data-og", ogOther)}${ogOther ? `<button class="btn btn-primary" id="og-save" style="margin-top:8px">Save</button>` : ""}<p class="hint">Asked once per customer. You can change it later under More, Edit customer.</p></div>`;
  const text = `<div class="wa" id="wamsg-${type}">${waFmt(message(o, type))}</div>
    <a class="btn btn-ghost" data-wtxt="${type}" href="${wa(o, message(o, type))}" target="_blank" rel="noopener">Open in WhatsApp</a>`;
  const bankNote = (type === "ready" || type === "owe" || type === "early") && owed(o) && !hasBank() ? `<p class="bad">Add your bank account in Settings so the invoice tells the customer where to pay.</p>` : "";
  // Bills go out as a PDF invoice; the plain text message stays one tap away. Tapping send counts as sent (no "I've sent it").
  if (type === "ready" || type === "owe" || type === "early") return `<p class="wa-label">Invoice for the customer: ${type === "ready" ? "clothes ready" : type === "early" ? "before the clothes are ready" : "payment reminder"}</p>
    ${billToLine(c)}
    <button class="btn btn-primary" data-pdf="${type}">Send bill on WhatsApp</button>
    <p class="hint">Your phone asks where to send it. Pick WhatsApp, then ${esc(c.name.split(" ")[0])}'s chat.</p>
    <details class="wtext"><summary>Send as a text message instead</summary>${text}<div class="row"><button class="btn btn-ghost" data-copy="${type}">Copy</button></div></details>
    ${bankNote}`;
  return `<p class="wa-label">WhatsApp to customer: ${MSG_NAMES[type]}</p>
    <a class="btn btn-primary" data-wtxt="${type}" href="${wa(o, message(o, type))}" target="_blank" rel="noopener">Send ${type === "list" ? "list" : "message"} on WhatsApp</a>
    <details class="wtext"><summary>See or copy the message</summary><div class="wa" id="wamsg-${type}">${waFmt(message(o, type))}</div><div class="row"><button class="btn btn-ghost" data-copy="${type}">Copy</button></div></details>`;
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
  const c = cust(o.cid), k = calc(o), priced = canBill() && o.billed;
  const row = (l, r, cls) => `<div class="rr${cls ? " " + cls : ""}"><span>${l}</span><span>${r}</span></div>`;
  const total = o.m.total || k.total, due = owed(o);
  const bank = priced && due && hasBank() ? (() => { const b = sPriv(); return `<div class="rsep"></div><div class="rc">Pay by transfer to<br><b>${esc(b.bank_name.trim())}</b><br><b>${esc(b.acct_no)}</b><br>${esc(b.acct_name.trim())}</div>`; })() : "";
  return `<div class="rhead"><b>${esc(shop.name)}</b>${liveBranches().length > 1 ? `<span>${esc(branchName(o.branch))}</span>` : ""}</div>
    <div class="rsep"></div>
    ${row("Receipt no.", "#" + o.no)}${row("Customer", esc(c.name))}${row("Tag mark", esc(c.mark))}${row("Dropped", fmtDay(o.at))}${o.collect ? row("Collection", esc(fmtCollect(o.collect))) : ""}${o.wait ? row("Service", "Wait & get") : ""}${row("Printed", fmtDay(Date.now()))}${billBy(o) ? row("Prepared by", esc(billBy(o))) : ""}${o.duty && (o.duty.w || []).length ? row("Attendants", esc(andList(o.duty.w))) : ""}
    <div class="rsep"></div>
    ${o.items.map((it, i) => `<div class="ri"><div class="rr"><span>${it.qty} × ${esc(pname(it) + pcsTag(it))}</span><span>${priced ? naira(unitPrice(o, it, i) * it.qty) : ""}</span></div><small>${SERVICES[it.svc]}</small></div>`).join("")}
    <div class="rsep"></div>
    ${priced ? `${k.exp ? row(spName(o), naira(k.exp)) : ""}${o.m.delivery ? row("Pickup / delivery", naira(o.m.delivery)) : ""}${o.m.discount ? row("Discount", "-" + naira(o.m.discount)) : ""}
      ${row("<b>TOTAL</b>", `<b>${naira(total)}</b>`, "rbig")}${row("Paid", naira(o.m.paid))}${row(due ? "<b>Balance</b>" : "Balance", due ? `<b>${naira(due)}</b>` : "Fully paid")}`
      : row("<b>Clothes</b>", `<b>${countTxt(o)}</b>`, "rbig") + `<div class="rc">${canBill() ? "Bill to follow when your clothes are ready." : "Keep this slip for pickup."}</div>`}
    ${o.remarks || o.money ? `<div class="rsep"></div><div class="rc">${o.remarks ? `Noted: ${esc(o.remarks.split("; ").join(", "))}` : ""}${o.remarks && o.money ? "<br>" : ""}${o.money ? `Money found in pocket: ${naira(o.money)}` : ""}</div>` : ""}
    ${bank}
    <div class="rsep"></div><div class="rc">Thank you for your patronage.</div>`;
}
// Some phones (seen on an iPhone home screen app) never open the print screen. If it hasn't opened after 2 seconds,
// offer the same receipt on a plain page in the browser, which prints there.
const receiptLink = o => "/receipt.html#" + new URLSearchParams({ p: paper, h: receiptHtml(o) }).toString();
function printReceipt(o) {
  let opened = false; const seen = () => { opened = true; window.removeEventListener("beforeprint", seen); };
  window.addEventListener("beforeprint", seen);
  setTimeout(() => {
    window.removeEventListener("beforeprint", seen);
    const box = document.querySelector(".oprint");
    if (opened || !box || box.querySelector("#prtalt")) return;
    box.insertAdjacentHTML("beforeend", `<a class="btn btn-primary" id="prtalt" href="${receiptLink(o)}" target="_blank" rel="noopener" style="margin-top:10px">Didn't open? Print from the browser</a>`);
  }, 2000);
  let r = document.getElementById("receipt");
  if (!r) { r = document.createElement("div"); r.id = "receipt"; document.body.appendChild(r); }
  r.className = "p" + paper; r.innerHTML = receiptHtml(o);
  let st = document.getElementById("receipt-page");
  if (!st) { st = document.createElement("style"); st.id = "receipt-page"; document.head.appendChild(st); }
  st.textContent = `@page{size:${paper}mm auto;margin:0}`;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  try { window.print(); } catch (_) { }
  setTimeout(done, 1500);
}
const printBlock = o => `<div class="prow"><button class="btn btn-ghost" id="prt">${canBill() && o.billed ? "Print receipt" : "Print drop-off slip"}</button>
  <div class="aseg" aria-label="Receipt paper width"><button data-paper="80" aria-pressed="${paper === "80"}">80mm</button><button data-paper="58" aria-pressed="${paper === "58"}">58mm</button></div></div>`;
const payList = o => (o.m.payments || []).length ? `<div class="paylist">${o.m.payments.map(p => `<div><span>${naira(p.amt)}</span><span>${p.by ? esc(p.by) + " · " : ""}${fmtDay(p.at)}</span></div>`).join("")}</div>${own() ? `<button class="linkbtn" id="unpay">Recorded by mistake? Remove the last payment (${naira(o.m.payments[o.m.payments.length - 1].amt)})</button>` : ""}` : "";

/* ---------- Invoice as a PDF ----------
   Drawn on a canvas at A4 size (so ₦ and the shop's logo always render), saved as JPEG pages inside a
   small hand-written PDF, then handed to the phone's share sheet so the owner can pick WhatsApp. */
const INV_GREEN = "#0F7B5F", INV_NAVY = "#24386B", INV_CHAR = "#2F3437", INV_EXTRA = ["#8B2346", "#0E6E82"];
const isHex = h => /^#[0-9a-f]{6}$/i.test(h || "");
const invColor = () => isHex(sPriv().inv_color) ? sPriv().inv_color.toUpperCase() : INV_GREEN;
const goodLogo = d => typeof d === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d);
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => "#" + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const relLum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
// Darken a colour (same hue) until white text on it is easy to read: contrast 4.6 or more.
// Works in HSL so the hue and richness stay: gold becomes deep gold, not olive.
const hsl2rgb = (h, s, l) => { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); };
function deepen(c) {
  const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let l = (mx + mn) / 2; const s = d ? Math.max(.68, d / (1 - Math.abs(2 * l - 1))) : 0;
  const h = !d ? 0 : mx === r ? (((g - b) / d) % 6 + 6) % 6 * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  let x = hsl2rgb(h, Math.min(1, s), l);
  for (let i = 0; i < 80 && 1.05 / (relLum(x) + .05) < 4.6; i++) { l -= .01; x = hsl2rgb(h, Math.min(1, s), l); }
  return x;
}
const loadImg = src => new Promise(r => { if (!src) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
// The logo's own colours: skip white, black, greys and see-through pixels, group the rest by hue,
// and keep up to 3 clearly different hues, most used first.
function logoColours(img) {
  const n = 72, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d"); const s = Math.min(n / img.width, n / img.height);
  g.drawImage(img, 0, 0, Math.max(1, img.width * s), Math.max(1, img.height * s));
  const d = g.getImageData(0, 0, n, n).data, buckets = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dl = mx - mn;
    if (dl < .12 || l > .93 || l < .07) continue;
    const sat = dl / (1 - Math.abs(2 * l - 1)); if (sat < .22) continue;
    let h = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4; h = (h * 60 + 360) % 360;
    const k = Math.floor(h / 15), bk = buckets[k] || (buckets[k] = { n: 0, h: 0, rgb: [0, 0, 0] });
    bk.n++; bk.h += h; bk.rgb[0] += d[i]; bk.rgb[1] += d[i + 1]; bk.rgb[2] += d[i + 2];
  }
  const min = n * n * .01, picks = [];
  Object.values(buckets).filter(b => b.n >= min).sort((a, b) => b.n - a.n).forEach(b => {
    const h = b.h / b.n, far = picks.every(p => Math.min(Math.abs(p.h - h), 360 - Math.abs(p.h - h)) >= 28);
    if (far && picks.length < 3) picks.push({ h, hex: rgb2hex(deepen(b.rgb.map(v => v / b.n))) });
  });
  return picks.map(p => p.hex);
}
let invSw = { key: null, list: null };
function invSwatches() {
  const p = sPriv(), cur = invColor();
  let list = p.inv_logo && invSw.key === p.inv_logo && invSw.list ? invSw.list.slice() : [];
  [INV_GREEN].concat(INV_EXTRA).forEach(h => { if (list.length < 3 && !list.includes(h)) list.push(h); });
  list = list.slice(0, 3).concat([INV_NAVY, INV_CHAR]);
  if (!list.includes(cur)) list[2] = cur;
  return list;
}
async function invFonts() { try { await Promise.all(["400", "500", "600", "700"].map(w => document.fonts.load(`${w} 24px "IBM Plex Sans"`, "₦Aa1"))); } catch (_) { } }
const fmtDate = ts => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const invNo = o => o.combo ? "INV-" + [o.no, o.combo.no].sort((a, b) => a - b).join("/") : "INV-" + o.no;
// Orders dropped together (express clothes split from the rest) share one bill sent before the clothes are ready.
const partner = o => o && o.pair ? orders.find(x => x.id === o.pair) || null : null;
const withCombo = o => { const q = partner(o); return q ? { ...o, combo: q } : o; };
const partTotal = q => q.billed ? +q.m.total || 0 : calc(q).total;
// The name printed on invoices: the shop can set a proper one ("Mr. Ezekiel") while still finding the customer by what they saved ("Lexus 350").
const billName = c => (c.inv_name || "").trim() || c.name;
let btEdit = null; // id of the customer whose invoice name is being edited
const billToLine = c => btEdit === c.id
  ? `<label for="btn-in" class="wa-label" style="margin-top:10px">Name on the invoice</label><div class="row srow"><input id="btn-in" maxlength="60" value="${esc(billName(c))}" autocomplete="off"><button class="mini" id="btn-save">Save</button></div>
     <p class="hint">Put Mr., Mrs., Miss or Dr. in front, the way you'd address them. This only changes the invoice. You'll still find them as ${esc(c.name)}.</p>`
  : `<p class="billto">Bill to: <b>${esc(billName(c))}</b> <button data-bt>Change</button></p>${(c.inv_name || "").trim() ? "" : `<p class="billnote">Is “${esc(c.name)}” their real name? If not, tap Change and type their real name with Mr., Mrs., Miss or Dr. in front. Don't know their name? Send it as a text message instead.</p><button class="mini" data-btok>Yes, it's their real name</button>`}`;
const PAY_WORD = { cash: "cash", transfer: "transfer", pos: "POS" };

async function invoicePages(o, c = cust(o.cid)) {
  await invFonts();
  const S = 1.4, W = 1240, H = 1754, M = 92, col = invColor(), p = sPriv(), k = calc(o);
  const logo = goodLogo(p.inv_logo) ? await loadImg(p.inv_logo) : null;
  const INK = "#13201E", MUTED = "#5B6664", LINE = "#E1E6E3", TINT = "#F5F7F6";
  const F = (w, z) => `${w} ${z}px "IBM Plex Sans", Arial, sans-serif`;
  const pages = []; let g, y;
  const newPage = () => { const cv = document.createElement("canvas"); cv.width = W * S; cv.height = H * S; g = cv.getContext("2d"); g.scale(S, S); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); pages.push(cv); y = M; };
  const text = (t, x, yy, font, color, align) => { g.font = font; g.fillStyle = color || INK; g.textAlign = align || "left"; g.fillText(t, x, yy); };
  const wrap = (t, maxW, font) => { g.font = font; const out = []; String(t).split("\n").forEach(par => { let line = ""; par.split(/\s+/).filter(Boolean).forEach(wd => { const tt = line ? line + " " + wd : wd; if (g.measureText(tt).width > maxW && line) { out.push(line); line = wd; } else line = tt; }); if (line) out.push(line); }); return out; };
  const fit = (t, maxW, font) => { g.font = font; t = String(t); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1); return t + "…"; };
  const box = (x, yy, w, h, r, fill, stroke) => { g.beginPath(); if (g.roundRect) g.roundRect(x, yy, w, h, r); else g.rect(x, yy, w, h); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  const label = (t, x, yy, color) => { g.save(); if ("letterSpacing" in g) g.letterSpacing = "2px"; text(t.toUpperCase(), x, yy, F(600, 17), color || MUTED); g.restore(); };
  const bottom = H - 100, room = h => { if (y + h > bottom) newPage(); };
  const parts = o.combo ? [o, o.combo].sort((a, b) => (b.express ? 1 : 0) - (a.express ? 1 : 0)) : [o];
  const total = o.combo ? parts.reduce((s, q) => s + partTotal(q), 0) : o.billed ? (+o.m.total || 0) : k.total;
  const paid = parts.reduce((s, q) => s + (+q.m.paid || 0), 0), due = Math.max(0, total - paid);

  newPage();
  // Header: logo, shop name and contact lines on the left; INVOICE and its number on the right
  let x = M;
  if (logo) { const s = Math.min(132 / logo.width, 132 / logo.height), lw = logo.width * s, lh = logo.height * s; g.drawImage(logo, M, y + (132 - lh) / 2, lw, lh); x = M + lw + 28; }
  text("INVOICE", W - M, y + 52, F(700, 50), col, "right");
  text(invNo(o), W - M, y + 90, F(500, 24), MUTED, "right");
  if (o.express || o.wait) text(o.wait ? "WAIT & GET" : "EXPRESS", W - M, y + 124, F(700, 24), "#C2410C", "right");
  const nameW = W - M - 320 - x; let hy = y + 44;
  wrap(shopName(), nameW, F(700, 38)).slice(0, 2).forEach(l => { text(l, x, hy, F(700, 38), INK); hy += 44; });
  hy -= 6;
  if (p.inv_tagline) { hy += 30; text(fit(p.inv_tagline, nameW, F(400, 22)), x, hy, F(400, 22), MUTED); }
  if (p.inv_address) wrap(p.inv_address, nameW, F(400, 20)).slice(0, 2).forEach(l => { hy += 28; text(l, x, hy, F(400, 20), MUTED); });
  const contact = [p.inv_phone ? "WhatsApp " + fmtPhone(p.inv_phone) : "", p.inv_email || ""].filter(Boolean).join("  ·  ");
  if (contact) { hy += 28; text(fit(contact, nameW, F(400, 20)), x, hy, F(400, 20), MUTED); }
  y = Math.max(y + 132, hy + 10) + 26;
  g.fillStyle = col; g.fillRect(M, y, W - 2 * M, 5); y += 50;

  // Bill to, and invoice details
  const c2 = W / 2 + 40; label("Bill to", M, y); label("Invoice details", c2, y);
  let ly = y + 42;
  wrap(billName(c), c2 - M - 40, F(600, 28)).slice(0, 2).forEach(l => { text(l, M, ly, F(600, 28)); ly += 36; });
  if (c.phone) { text(fmtPhone(c.phone), M, ly, F(400, 22), MUTED); ly += 32; }
  if (c.mark) { text("Tag mark: " + c.mark, M, ly, F(400, 22), MUTED); ly += 32; }
  let ry = y + 42;
  const kv = (kk, v) => { text(kk, c2, ry, F(400, 22), MUTED); if (v) text(v, c2 + 200, ry, F(600, 22)); ry += 36; };
  kv("Invoice no.", invNo(o)); kv("Dropped off", fmtDate(o.at)); kv("Invoice date", fmtDate(Date.now()));
  kv("Items", countTxt({ items: parts.flatMap(q => q.items) }));
  if (billBy(o)) kv("Prepared by", fit(billBy(o), W - M - c2 - 200, F(600, 22)));
  if (o.duty && (o.duty.w || []).length) kv("Attendants", fit(andList(o.duty.w), W - M - c2 - 200, F(600, 22)));
  if (o.express || o.wait) kv("Service", o.wait ? "Wait & get" : "Express");
  kv("Clothes", o.status === "picked" ? "Collected" : o.status === "ready" || o.status === "told" ? "Ready for pickup" : "Being cleaned");
  kv("Status", "");
  const st = due === 0 ? ["Paid", "#DCF2E7", "#0F6B47"] : paid ? ["Part paid", "#FEF3C7", "#92400E"] : ["Unpaid", "#FDE2E1", "#B42318"];
  g.font = F(600, 19); const pw = g.measureText(st[0]).width + 32; box(c2 + 200, ry - 36 - 25, pw, 34, 17, st[1]); text(st[0], c2 + 216, ry - 36, F(600, 19), st[2]);
  y = Math.max(ly, ry) + 30;

  // Items
  const cQty = 760, cPrice = 950, cAmt = W - M - 22;
  const head = () => { box(M, y, W - 2 * M, 54, 8, col); [["Item", M + 22, "left"], ["Qty", cQty, "right"], ["Price", cPrice, "right"], ["Amount", cAmt, "right"]].forEach(([t, xx, a]) => text(t, xx, y + 35, F(600, 20), "#fff", a)); y += 54; };
  head();
  parts.forEach(q => {
  if (parts.length > 1) { if (y + 130 > bottom) { newPage(); head(); } text(`${q.express ? "EXPRESS" : "NORMAL"} · Order #${q.no}${q.collect ? " · Ready " + fmtDate(q.collect) : ""}`, M + 22, y + 40, F(700, 21), q.express ? "#C2410C" : col); y += 56; g.fillStyle = LINE; g.fillRect(M, y - 1, W - 2 * M, 1); }
  q.items.forEach((it, i) => {
    if (y + 74 > bottom) { newPage(); head(); }
    if (i % 2) { g.fillStyle = TINT; g.fillRect(M, y, W - 2 * M, 74); }
    const up = unitPrice(q, it, i);
    text(fit(pname(it), cQty - M - 120, F(500, 23)), M + 22, y + 33, F(500, 23));
    text((SERVICES[it.svc] || "") + (pcsOf(it) > 1 ? ` · ${it.qty * pcsOf(it)} pieces` : ""), M + 22, y + 59, F(400, 18), MUTED);
    text(String(it.qty), cQty, y + 45, F(400, 23), INK, "right");
    text(naira(up), cPrice, y + 45, F(400, 23), INK, "right");
    text(naira(up * it.qty), cAmt, y + 45, F(600, 23), INK, "right");
    y += 74; g.fillStyle = LINE; g.fillRect(M, y - 1, W - 2 * M, 1);
  });
  });

  // Totals, ending in the balance bar
  const ks = parts.map(q => calc(q)), sum = f => parts.reduce((s, q, i) => s + f(q, ks[i]), 0);
  const rows = [["Subtotal", naira(sum((q, kk) => kk.sub))]];
  parts.forEach((q, i) => { if (ks[i].exp) rows.push([spName(q) + (parts.length > 1 ? ` (#${q.no})` : ""), naira(ks[i].exp)]); });
  if (sum(q => +q.m.delivery || 0)) rows.push(["Pickup / delivery", naira(sum(q => +q.m.delivery || 0))]);
  if (sum(q => +q.m.discount || 0)) rows.push(["Discount", "-" + naira(sum(q => +q.m.discount || 0))]);
  const last = parts.flatMap(q => q.m.payments || []).sort((a, b) => a.at - b.at).slice(-1)[0];
  room(rows.length * 42 + 190); y += 24;
  const tw = 540, tx = W - M - tw;
  const trow = (l, r, bold) => { text(l, tx + 18, y + 28, F(bold ? 600 : 400, 23), bold ? INK : MUTED); text(r, W - M - 18, y + 28, F(bold ? 700 : 500, 23), INK, "right"); y += 42; };
  rows.forEach(r => trow(r[0], r[1]));
  g.fillStyle = LINE; g.fillRect(tx, y + 4, tw, 2); y += 14;
  trow("Total", naira(total), true);
  if (paid) trow(`Paid${last ? " · " + fmtDate(last.at) : ""}${last && PAY_WORD[last.method] ? " · " + PAY_WORD[last.method] : ""}`, naira(paid));
  y += 10; box(tx, y, tw, 66, 10, col);
  text(due ? "Balance due" : "Paid in full", tx + 22, y + 43, F(600, 24), "#fff");
  text(naira(due), W - M - 22, y + 44, F(700, 30), "#fff", "right");
  y += 66;

  // How to pay
  if (due && hasBank()) {
    room(230); y += 34;
    box(M, y, W - 2 * M, 196, 12, null, LINE);
    label("How to pay", M + 30, y + 46, col);
    text(p.acct_no, M + 30, y + 98, F(700, 36));
    text(fit(`${p.bank_name.trim()}  ·  ${p.acct_name.trim()}`, W - 2 * M - 60, F(500, 23)), M + 30, y + 136, F(500, 23));
    text(fit(`Use ${invNo(o)} as the reference, then send your payment receipt on WhatsApp.`, W - 2 * M - 60, F(400, 20)), M + 30, y + 172, F(400, 20), MUTED);
    // Trial (BrightWash only): a tappable button that opens a page with "Copy account number".
    if (copyLive()) {
      const bw = 300, bh = 64, bx = W - M - 30 - bw, by = y + 58;
      box(bx, by, bw, bh, 32, col);
      text("Tap to copy number", bx + bw / 2, by + 41, F(600, 22), "#fff", "center");
      const q = new URLSearchParams({ k: shop.pay_token, t: String(due), r: invNo(o) });
      const cv = pages[pages.length - 1]; (cv.tbLinks = cv.tbLinks || []).push({ x: bx, y: by, w: bw, h: bh, W, H, url: "https://tagbook.ordiventa.com/pay.html?" + q.toString() });
    }
    y += 196;
  }
  // Terms
  const terms = p.inv_terms ? wrap(p.inv_terms, W - 2 * M - 60, F(400, 20)).slice(0, 8) : [];
  if (terms.length) {
    const h = 74 + terms.length * 30; room(h + 30); y += 24;
    box(M, y, W - 2 * M, h, 12, TINT);
    label("Terms", M + 30, y + 44);
    terms.forEach((l, i) => text(l, M + 30, y + 82 + i * 30, F(400, 20), MUTED));
    y += h;
  }
  // No name here: some shops save customers as a car or plate number, which reads badly in a thank-you.
  const early = o.status === "new" || o.status === "listed";
  const ty = wrap(early ? "Thank you for your patronage! We'll let you know as soon as your clothes are ready." : "Thank you for your patronage! We look forward to serving you again.", W - 2 * M, F(500, 23));
  room(30 + ty.length * 32); y += 54;
  ty.forEach((l, i) => text(l, M, y + i * 32, F(500, 23), INK));

  // Footer on every page
  pages.forEach((cv, i) => {
    const gg = cv.getContext("2d");
    gg.fillStyle = LINE; gg.fillRect(M, H - 82, W - 2 * M, 1);
    gg.font = F(400, 17); gg.fillStyle = MUTED; gg.textAlign = "center"; gg.fillText("Invoice made with Tagbook  ·  tagbook.ordiventa.com", W / 2, H - 46);
    if (pages.length > 1) { gg.textAlign = "right"; gg.fillText(`Page ${i + 1} of ${pages.length}`, W - M, H - 46); }
  });
  return pages;
}
// A minimal PDF: one full-page JPEG image per page.
async function pagesToPdf(pages) {
  const blobs = await Promise.all(pages.map(cv => new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("jpeg")), "image/jpeg", .88))));
  const imgs = await Promise.all(blobs.map(b => b.arrayBuffer()));
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const add = d => { const u = typeof d === "string" ? enc.encode(d) : new Uint8Array(d); parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); body(); add("\nendobj\n"); };
  const n = pages.length, PW = 595.28, PH = 841.89;
  // Clickable links (e.g. the copy-number button) become link annotations after the page objects.
  let nextObj = 3 + 3 * n; const annots = pages.map(cv => (cv.tbLinks || []).map(l => ({ id: nextObj++, l })));
  add("%PDF-1.4\n%âã\n");
  obj(1, () => add("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${n} >>`));
  imgs.forEach((jpg, i) => {
    const pg = 3 + 3 * i, cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    const an = annots[i].length ? ` /Annots [${annots[i].map(a => a.id + " 0 R").join(" ")}]` : "";
    obj(pg, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R${an} >>`));
    obj(pg + 1, () => add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(pg + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${pages[i].width} /Height ${pages[i].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.byteLength} >>\nstream\n`); add(jpg); add("\nendstream"); });
  });
  annots.flat().forEach(({ id, l }) => {
    const sx = PW / l.W, sy = PH / l.H, x1 = (l.x * sx).toFixed(2), x2 = ((l.x + l.w) * sx).toFixed(2), y1 = (PH - (l.y + l.h) * sy).toFixed(2), y2 = (PH - l.y * sy).toFixed(2);
    const uri = l.url.replace(/[\\()]/g, m => "\\" + m);
    obj(id, () => add(`<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`));
  });
  const size = nextObj, xref = len;
  add(`xref\n0 ${size}\n0000000000 65535 f \n${offs.slice(1).map(v => String(v).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
async function invoiceFile(o, c = cust(o.cid)) {
  const blob = await pagesToPdf(await invoicePages(o, c));
  const name = `${invNo(o).replace("/", "-")} ${shopName()} ${c.name}`.replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) + ".pdf";
  return new File([blob], name, { type: "application/pdf" });
}
function saveFile(f) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const invCaption = (o, type) => { const c = cust(o.cid); return type === "early" ? `${hello(c)}, here is your bill from ${shopName()} (invoice ${invNo(o)}). Your clothes are being cleaned, and we'll let you know as soon as they're ready.` : type === "owe" ? `${hello(c)}, a reminder from ${shopName()}: invoice ${invNo(o)} has ${naira(owed(o))} still to pay. The invoice is attached.` : `${hello(c)}, your clothes are ready at ${shopName()}. Your invoice is attached.`; };
let invReady = null;
// Counts bills sent as PDF vs text (no customer details), so Bolu can see which one shops use.
const BILL_STAGES = ["ready", "owe", "early"];
// Counts sends for the admin page: bills (owner or billing staff) and the list of clothes (anyone)
function logSend(kind, stage) { if (!shop || !(stage === "list" || (canBill() && BILL_STAGES.includes(stage)))) return; sb.from("send_log").insert({ shop_id: shop.id, kind, stage }).then(() => { }, () => { }); }
let earlyOpen = null; // order whose "send the bill now" panel is open // the last invoice made, so a second tap shares at once
// When the phone confirms the ready invoice was shared, move the order to Told, so nobody has to tap "I've sent it".
// BrightWash first (asked for by Impressions Laundry), everyone from 25 Nov.
const TOLD_LIVE = Date.parse("2026-11-25T08:00:00+01:00");
function autoTold(o, type) {
  if (type !== "ready" || o.status !== "ready" || !canBill() || !(shop.id === PHOTO_SHOP || Date.now() >= TOLD_LIVE || location.hostname === "localhost")) return;
  o.status = "told"; if (o.again) o.again.ready = false;
  put("orders", { id: o.id }, { status: "told" });
  toast("Sent. The order is now marked as told.");
  if (oFor === o.no && !$("#sheet").hidden) openOrder(o.no); else if (typeof render === "function") render();
}
async function sendInvoice(o, btn, type) {
  const key = [o.id, o.status, o.m.total, o.m.paid, invColor(), (sPriv().inv_logo || "").length, billBy(o)].join(":"), label = "Send invoice (PDF)";
  let f = invReady && invReady.key === key ? invReady.file : null;
  if (!f) {
    btn.disabled = true; btn.textContent = "Making the invoice…";
    try { f = await invoiceFile(o); invReady = { key, file: f }; } catch (_) { btn.disabled = false; btn.textContent = label; toast("Couldn't make the invoice. Try again."); return; }
    btn.disabled = false; btn.textContent = label;
  }
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    // Trial (BrightWash only): the full text bill goes with the PDF, so the account number is in the chat too.
    // WhatsApp cuts long captions (about 1,000 characters), so a long bill falls back to the short caption plus bank details.
    const full = copyLive() ? message(o, type) : "";
    const short = () => { const tot = +o.m.total || calc(o).total, pd = +o.m.paid || 0, due = owed(o);
      return `${invCaption(o, type)} The full list of clothes is in the invoice.${dutyText(o, true) ? `\n\n${dutyText(o, true)}` : ""}\n\nTotal: ${naira(tot)}${pd ? `\nPaid: ${naira(pd)}` : ""}${due > 0 ? `\nBalance: ${naira(due)}` : ""}` + (due > 0 ? payTo() : ""); };
    const text = !copyLive() ? invCaption(o, type) : full.length <= 1000 ? full : short();
    try { await navigator.share({ files: [f], text }); logSend("pdf", type); stampBill(o); autoTold(o, type); }
    catch (e) {
      // Some phones only allow sharing straight after a tap; the invoice is ready now, so one more tap sends it.
      if (e && e.name === "NotAllowedError") { btn.textContent = "Invoice ready. Tap to send"; return; }
      if (!e || e.name !== "AbortError") toast("Couldn't open sharing. Try again.");
    }
    return;
  }
  saveFile(f); logSend("pdf", type); stampBill(o); toast("Invoice saved to your downloads. Attach it in WhatsApp.");
}

/* Settings, Invoice tab (owner only) */
const SAMPLE_INV = () => {
  const unit = [800, 800, 2000, 3500], items = [{ label: "Shirt", svc: "wi", qty: 4 }, { label: "Trouser", svc: "wi", qty: 2 }, { label: "Native (2 piece)", svc: "wsi", qty: 1 }, { label: "Duvet", svc: "wo", qty: 1 }];
  const total = items.reduce((s, it, i) => s + unit[i] * it.qty, 0) - 500, day = 864e5;
  return { o: { id: "sample", no: 33, status: "ready", at: Date.now() - 2 * day, items, express: false, billed: true, m: { unit, custom: {}, delivery: 0, discount: 500, total, paid: 5000, billed_at: Date.now(), payments: [{ amt: 5000, at: Date.now() - day, method: "transfer" }], express_amt: 0 } },
    c: { name: "Adaeze Okafor", phone: "08031234567", mark: "AO", greet: null } };
};
function invoiceSettingsHtml() {
  const p = sPriv(), cur = invColor(), logo = goodLogo(p.inv_logo);
  return card("Logo", "Shown at the top of every invoice. A logo on a white or clear background looks best.",
      `<div class="ilogo">${logo ? `<img src="${esc(p.inv_logo)}" alt="Your logo">` : `<span>No logo yet</span>`}</div>
       <input type="file" id="ilf" accept="image/png,image/jpeg,image/webp" hidden>
       <div class="row"><button class="btn btn-ghost" id="ilu">${logo ? "Change logo" : "Upload logo"}</button>${logo ? `<button class="btn btn-ghost" id="ilr">Remove logo</button>` : ""}</div>`)
    + card("Invoice colour", logo ? "The first three come from your logo. Tap one to see it on the invoice." : "Upload your logo to get colours taken from it.",
      `<div class="iswatch" role="group" aria-label="Invoice colour">${invSwatches().map(h => `<button data-ic="${h}" aria-pressed="${h === cur}" aria-label="Colour ${h}" style="--c:${h}"></button>`).join("")}</div>`)
    + card("Preview", "A sample invoice with your details.",
      `<div class="iprev"><img id="iprev" alt="Sample invoice"></div><button class="btn btn-ghost" id="isample">Download sample PDF</button>`)
    + card("Details on the invoice", "Leave any of these empty to hide it.",
      `<label for="itg">Short line under your name</label><input id="itg" maxlength="60" value="${esc(p.inv_tagline || "")}" placeholder="e.g. Dry cleaning and laundry" autocomplete="off">
       <label for="iad">Address</label><input id="iad" maxlength="120" value="${esc(p.inv_address || "")}" autocomplete="off">
       <label for="iph">WhatsApp number</label><input id="iph" type="text" inputmode="tel" maxlength="13" value="${esc(fmtPhone(p.inv_phone || ""))}" autocomplete="off">
       <label for="iem">Email</label><input id="iem" type="email" maxlength="80" value="${esc(p.inv_email || "")}" autocomplete="off">`)
    + card("Terms", "Printed near the bottom of every invoice. Leave it empty if you don't want any.",
      `<textarea id="itm" rows="4" maxlength="400" placeholder="e.g. Clothes not collected within 30 days may be given away. Please check your pockets before drop-off.">${esc(p.inv_terms || "")}</textarea>`);
}
let prevTurn = 0;
async function drawInvPreview() {
  const img = $("#iprev"); if (!img) return; const turn = ++prevTurn;
  const { o, c } = SAMPLE_INV(); const pages = await invoicePages(o, c);
  if (turn === prevTurn && $("#iprev")) $("#iprev").src = pages[0].toDataURL("image/jpeg", .8);
}
async function readLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG or JPG picture.");
  const url = URL.createObjectURL(file), img = await loadImg(url); URL.revokeObjectURL(url);
  if (!img || !img.width) throw new Error("Couldn't open that picture. Try another one.");
  const s = Math.min(1, 320 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
  const g = cv.getContext("2d"); g.drawImage(img, 0, 0, cv.width, cv.height);
  let data = cv.toDataURL("image/png");
  if (data.length > 250000) { g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); data = cv.toDataURL("image/jpeg", .86); }
  return { data, colours: logoColours(cv) };
}
async function logoSwatches() {
  const p = sPriv(); if (!goodLogo(p.inv_logo) || invSw.key === p.inv_logo) return false;
  const img = await loadImg(p.inv_logo); invSw = { key: p.inv_logo, list: img ? logoColours(img) : [] }; return true;
}
function wireInvoice() {
  const savePriv = async fields => { Object.assign(priv, fields); invReady = null; savedToast(await put("shop_private", { shop_id: shop.id }, fields)); };
  drawInvPreview();
  logoSwatches().then(changed => { if (changed && setTab === "invoice" && tab === "prices") renderSettings(); });
  $("#ilu").onclick = () => $("#ilf").click();
  $("#ilf").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#ilu").disabled = true; $("#ilu").textContent = "Adding logo…";
    try {
      const r = await readLogo(f); invSw = { key: r.data, list: r.colours };
      await savePriv({ inv_logo: r.data, inv_color: r.colours[0] || invColor() });
    } catch (err) { toast(err.message); }
    renderSettings();
  };
  if ($("#ilr")) $("#ilr").onclick = async () => { const b = $("#ilr"); if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; return; } await savePriv({ inv_logo: "" }); renderSettings(); };
  view.querySelectorAll("[data-ic]").forEach(b => b.onclick = async () => {
    view.querySelectorAll("[data-ic]").forEach(x => x.setAttribute("aria-pressed", x === b)); priv.inv_color = b.dataset.ic; drawInvPreview();
    await savePriv({ inv_color: b.dataset.ic });
  });
  $("#isample").onclick = async () => { const b = $("#isample"); b.disabled = true; try { const { o, c } = SAMPLE_INV(); saveFile(await invoiceFile(o, c)); } catch (_) { toast("Couldn't make the sample. Try again."); } b.disabled = false; };
  const field = (id, key, max, clean) => $(id).onchange = e => { const v = (clean ? clean(e.target.value) : tidy(e.target.value)).slice(0, max); e.target.value = key === "inv_phone" ? fmtPhone(v) : v; savePriv({ [key]: v }).then(drawInvPreview); };
  field("#itg", "inv_tagline", 60); field("#iad", "inv_address", 120); field("#iem", "inv_email", 80, v => v.trim());
  field("#itm", "inv_terms", 400, v => v.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim());
  $("#iph").onchange = e => { const v = digits(e.target.value); if (v && !/^0\d{10}$/.test(v)) { toast("The number must be 11 digits and start with 0."); return; } e.target.value = fmtPhone(v); savePriv({ inv_phone: v }).then(drawInvPreview); };
}

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
      <div class="dhead"><div class="${markCls(c.mark)}">${esc(c.mark)}</div><div><b>${esc(c.name)}</b><span>${canBill() && c.phone ? fmtPhone(c.phone) + " · " : ""}dropped ${fmtDay(o.at)}</span></div></div>
      <div class="lines">${o.items.map((it, i) => `<div><span>${it.qty} × ${esc(pname(it) + pcsTag(it))}</span><span>${canBill() ? naira(unitPrice(o, it, i) * it.qty) : ""}</span></div>`).join("")}</div>
      <p class="fxnote">Cancelled${o.cancelled_by ? ` by ${esc(o.cancelled_by)}` : ""} on ${fmtDay(o.cancelled)}. It is not counted in your orders or totals.${o.m.paid ? ` The ${naira(o.m.paid)} paid on it still shows in your money received.` : ""}</p>
      ${own() ? `<button class="btn btn-primary" id="fxrestore">Bring this order back</button>` : ""}`;
  } else if (oMode === "items") {
    const d = oDraft, n = draftToOrder(o, d);
    const tmp = { ...o, items: n.items, m: { ...o.m, unit: o.billed ? n.unit : null, custom: n.custom, express_amt: spManual(o) ? o.m.express_amt : 0 }, billed: false };
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
      <div class="lines" style="margin-top:12px"><div><span>${(q => `${q} item${q === 1 ? "" : "s"}`)(n.items.reduce((s2, it) => s2 + it.qty, 0))}</span><span></span></div><div><b>${changed ? "New total" : "Total"}</b><b>${naira(next)}</b></div></div>
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
        else { if (!spManual(o)) o.m.express_amt = 0; const kk = calc({ ...o, billed: false }); o.m.express_amt = kk.exp; o.m.total = kk.total; }
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
/* Collection date and remarks (try-out in BrightWash until 17 Nov). Staff and owner can add or change them after logging. */
const REMARK_PRESETS = ["Stain", "Torn or hole", "Missing button", "Colour fading", "Burn mark", "Broken zip", "Item found in pocket"];
let shopRemarks = [], noteEdit = null, ne = null;
const dayAt = n => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + n); return t.getTime(); };
function collectPicker(st, edit) {
  if (st.wait && !edit) return `<label>Collection</label><p class="cnote">Today. The customer is waiting for it.</p>`;
  if (st.express && !edit) return `<label>Ready in <span class="opt">(optional)</span></label>
    <div class="chips" style="margin:0">${[1, 2, 3].map(n => `<button class="chip" data-exd="${n}" aria-pressed="${st.expDays === n}">${n} day${n > 1 ? "s" : ""}</button>`).join("")}</div>
    ${st.expDays ? `<p class="cnote">Ready ${fmtDay(dayAt(st.expDays))}. It goes in the customer's list of clothes.</p>` : ""}`;
  return `<label>When will they collect? <span class="opt">(optional)</span></label>${calendar(st)}
    ${st.cDate ? `<div class="cpicked"><span>Collect ${esc(fmtDay(Date.parse(collectIso(st.cDate, ""))))}</span><button type="button" data-cclear>Clear</button></div>` : ""}`;
}
// Month calendar for the collection date: today ringed, past days greyed, the picked day filled.
function calendar(st) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (st.calY == null) { const base = st.cDate ? new Date(st.cDate + "T00:00") : today; st.calY = base.getFullYear(); st.calM = base.getMonth(); }
  const first = new Date(st.calY, st.calM, 1), lead = (first.getDay() + 6) % 7, dim = new Date(st.calY, st.calM + 1, 0).getDate();
  const atStart = st.calY === today.getFullYear() && st.calM === today.getMonth();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span></span>`);
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(st.calY, st.calM, d), v = localDate(dt.getTime()), past = dt < today, isT = dt.getTime() === today.getTime();
    cells.push(`<button type="button" class="cd${isT ? " today" : ""}${st.cDate === v ? " on" : ""}" data-cal="${v}" ${past ? "disabled" : ""} aria-label="${fmtDay(dt.getTime())}${isT ? ", today" : ""}" aria-pressed="${st.cDate === v}">${d}</button>`);
  }
  const chev = p => `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="${p}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="cal"><div class="calhd"><button type="button" class="calnav" data-calm="-1" aria-label="Previous month" ${atStart ? "disabled" : ""}>${chev("M15 5l-7 7 7 7")}</button>
    <b>${first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
    <button type="button" class="calnav" data-calm="1" aria-label="Next month">${chev("M9 5l7 7-7 7")}</button></div>
    <div class="calgrid">${["M", "T", "W", "T", "F", "S", "S"].map(w => `<span class="cdow">${w}</span>`).join("")}${cells.join("")}</div></div>`;
}
function collectWhen(st) {
  if (st.wait) return collectIso(localDate(Date.now()), "");
  if (st.express) return st.expDays ? collectIso(localDate(dayAt(st.expDays)), "") : null;
  return collectIso(st.cDate, st.cTime);
}
function wireCollect(root, st, rr) {
  root.querySelectorAll("[data-exd]").forEach(b => b.onclick = () => { const n = +b.dataset.exd; st.expDays = st.expDays === n ? 0 : n; rr(); });
  root.querySelectorAll("[data-cal]").forEach(b => b.onclick = () => { const v = b.dataset.cal; st.cDate = st.cDate === v ? "" : v; st.cTime = ""; rr(); });
  root.querySelectorAll("[data-calm]").forEach(b => b.onclick = () => { const d = new Date(st.calY, st.calM + +b.dataset.calm, 1); st.calY = d.getFullYear(); st.calM = d.getMonth(); rr(); });
  const cc = root.querySelector("[data-cclear]"); if (cc) cc.onclick = () => { st.cDate = ""; st.cTime = ""; rr(); };
}
function remarkPicker(st) {
  const opts = [...new Set([...REMARK_PRESETS, ...shopRemarks, ...st.rm])];
  return `<label>Remarks <span class="opt">(optional: anything you noticed on the clothes)</span></label>
    <div class="chips rpick" style="margin:0">${opts.map(r => `<button class="chip" data-rm="${esc(r)}" aria-pressed="${st.rm.includes(r)}">${esc(r)}</button>`).join("")}
      <button class="chip" data-money aria-pressed="${!!st.money}">${st.money ? `Money found (${naira(st.money)})` : "Money found in pocket"}</button>
      <button class="chip" data-rmo aria-pressed="${!!st.rmOther}">+ Other</button></div>
    ${st.rmOther ? `<div class="row rother"><input id="rmo-in" maxlength="40" placeholder="What else did you notice?" autocomplete="off"><button class="btn btn-primary" id="rmo-add">Add</button></div><p class="hint">It's saved to your shop's list, so next time you just tap it.</p>` : ""}`;
}
function wireRemarks(root, st, rr) {
  root.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const r = b.dataset.rm; st.rm = st.rm.includes(r) ? st.rm.filter(x => x !== r) : [...st.rm, r]; rr(); });
  const m = root.querySelector("[data-money]"); if (m) m.onclick = () => moneyPop(st.money, v => { st.money = v; rr(); });
  const o = root.querySelector("[data-rmo]"); if (o) o.onclick = () => { st.rmOther = !st.rmOther; rr(); const i = document.querySelector("#rmo-in"); if (i) i.focus(); };
  const add = root.querySelector("#rmo-add"), inp = root.querySelector("#rmo-in");
  if (inp) inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add.click(); } };
  if (add) add.onclick = () => {
    const t = tidy(inp.value).replace(/;/g, ",").slice(0, 40); if (!t) { inp.focus(); return; }
    const known = [...REMARK_PRESETS, ...shopRemarks].find(x => x.toLowerCase() === t.toLowerCase());
    const label = known || t;
    if (!st.rm.includes(label)) st.rm = [...st.rm, label];
    if (!known) { shopRemarks.push(t); sb.from("shop_remarks").insert({ shop_id: shop.id, text: t }).then(() => { }); }
    st.rmOther = false; rr();
  };
}
function moneyPop(cur, done) {
  const p = document.createElement("div"); p.className = "popbg";
  p.innerHTML = `<section class="popcard" role="dialog" aria-modal="true" aria-labelledby="mp-t">
    <h3 id="mp-t" style="margin:0 0 6px">How much money did you find?</h3>
    <p class="hint" style="margin-top:0">It's recorded on the order and goes in the customer's list of clothes.</p>
    <input id="mp-in" ${moneyAttrs} placeholder="Amount in ₦" value="${cur || ""}" aria-label="Amount found">
    <div class="row" style="margin-top:12px">${cur ? `<button class="btn btn-ghost" id="mp-rm">Remove</button>` : `<button class="btn btn-ghost" id="mp-no">Cancel</button>`}<button class="btn btn-primary" id="mp-ok">Save</button></div></section>`;
  document.body.appendChild(p);
  const inp = p.querySelector("#mp-in"); inp.focus();
  inp.oninput = () => { const c = digits(inp.value); if (inp.value !== c) inp.value = c; };
  const close = v => { p.remove(); if (v !== undefined) done(v); };
  p.onclick = e => { if (e.target === p) close(); };
  const no = p.querySelector("#mp-no"); if (no) no.onclick = () => close();
  const rm = p.querySelector("#mp-rm"); if (rm) rm.onclick = () => close(0);
  p.querySelector("#mp-ok").onclick = () => { const v = Math.min(num(digits(inp.value)), 10000000); if (!v) { toast("Type the amount found"); inp.focus(); return; } close(v); };
}
// Orders not marked ready that are late, due today or due tomorrow (same groups as the 8am reminder).
let dueOpen = {};
function dueCard() {
  const today = localDate(Date.now()), tom = localDate(dayAt(1));
  const open = orders.filter(o => o.collect && !o.cancelled && (o.status === "new" || o.status === "listed"));
  const groups = [["Late", open.filter(o => localDate(o.collect) < today), "late"], ["Due today", open.filter(o => localDate(o.collect) === today), "due"], ["Due tomorrow", open.filter(o => localDate(o.collect) === tom), ""]].filter(g => g[1].length);
  if (!groups.length) return "";
  // Only the first 2 of each group show, so a long list doesn't push everything else down.
  return `<section class="scard duecard">${groups.map(([t, list, cls]) => { const key = cls || "tom", all = dueOpen[key] || list.length <= 2; return `<div class="dueg"><div class="dueh"><b class="${cls}">${t}</b><span class="dcount ${cls}">${list.length}</span></div>
    ${(all ? list : list.slice(0, 2)).map(o => { const c = cust(o.cid); return `<button class="order duerow" data-no="${o.no}"><div class="${markCls(c.mark)}">${esc(c.mark)}</div><div class="who"><b>${esc(c.name)}</b><span>#${o.no} · ${calc(o).count} item${calc(o).count === 1 ? "" : "s"}${o.express ? " · express" : o.wait ? " · wait & get" : ""}${cls === "late" ? " · was due " + esc(fmtDay(o.collect)) : ""}</span></div></button>`; }).join("")}${list.length > 2 ? `<button class="duemore" data-dmore="${key}">${dueOpen[key] ? "Show less" : `Show all ${list.length}`}</button>` : ""}</div>`; }).join("")}</section>`;
}
function collectTag(o) {
  if (!o.collect || o.cancelled || o.status === "picked") return "";
  const today = localDate(Date.now()), day = localDate(o.collect);
  return day < today ? ` · <b class="late">collect was ${esc(fmtDay(o.collect))}</b>` : day === today ? ` · <b class="due">collect today</b>` : ` · collect ${esc(fmtCollect(o.collect))}`;
}
/* ---------- Photos at drop-off ----------
   A photo of a damaged or costly cloth, taken when it's logged, so the shop can show the stain was already there.
   Shrunk on the phone (about 150 KB) before upload. Kept in a private store only that shop can open; the customer
   gets a long random link to one order's photos. Deleted 7 days after the clothes are collected (or 60 days after drop-off).
   Try-out in BrightWash first. */
const PHOTO_SHOP = "eb2f4c6c-ad86-42b4-bb8d-2a88ecf9e9b0";
const PHOTO_LIVE = Date.parse("2026-11-19T08:00:00+01:00"); // every shop from 19 Nov, 8am
const photosOn = () => !!shop && (shop.id === PHOTO_SHOP || Date.now() >= PHOTO_LIVE || location.hostname === "localhost");
// A photo's "What did you notice?" uses the same words as Remarks, and ticks the Remark too, so it's entered once.
const photoNotes = () => [...new Set([...REMARK_PRESETS.filter(x => x !== "Item found in pocket"), ...shopRemarks, "Costly item"])];
const syncsRemark = n => n !== "Costly item";
const CAM_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const photoCache = {}; // order id -> list of photos (null while loading)
const photoBusy = {}; // order no -> photos still uploading after save
let phAdd = null; // order screen: a photo being added { blob, url, item, notes }
const photoThumbs = (urls, i) => `<div class="phrow">${urls.map((u, j) => `<div class="phth"><img src="${esc(u)}" alt="Photo ${j + 1}"><button class="phx" data-phdel="${i}:${j}" aria-label="Remove photo ${j + 1}">×</button></div>`).join("")}${urls.length < 2 ? `<button class="phplus" data-phmore="${i}" aria-label="Add another photo">+</button>` : ""}</div>`;
async function shrinkPhoto(file) {
  const img = await new Promise((ok, no) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); no(new Error("Couldn't read that photo. Try again.")); }; i.src = u; });
  const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let q = 0.72, b; do { b = await new Promise(r => c.toBlob(r, "image/jpeg", q)); q -= 0.12; } while (b && b.size > 350e3 && q > 0.3);
  if (!b) throw new Error("Couldn't read that photo. Try again."); return b;
}
function pickPhoto(cb) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { cb(await shrinkPhoto(f)); } catch (e) { toast(e.message); } };
  inp.click();
}
async function uploadPhoto(orderId, blob, item, notes) {
  const path = `${shop.id}/${orderId}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from("order-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) return false;
  const { error } = await sb.from("order_photos").insert({ shop_id: shop.id, order_id: orderId, item: (item || "").slice(0, 60) || null, notes: notes && notes.length ? notes.join(", ").slice(0, 200) : null, path, taken_by: (me && me.name) || null });
  if (error) { sb.storage.from("order-photos").remove([path]); return false; }
  delete photoCache[orderId]; return true;
}
async function savePhotosLater(no, pend) {
  const o = orders.find(x => x.no === no); if (!o) return toast("Photos weren't saved. Open the order and add them again.");
  photoBusy[no] = true; if (oFor === no && !$("#sheet").hidden) openOrder(no);
  let bad = 0; for (const p of pend) if (!(await uploadPhoto(o.id, p.blob, p.item, p.notes))) bad++;
  delete photoBusy[no];
  toast(bad ? `${bad} photo${bad > 1 ? "s" : ""} didn't save. Open order #${no} and add ${bad > 1 ? "them" : "it"} again.` : `Photo${pend.length > 1 ? "s" : ""} saved with order #${no}`);
  if (oFor === no && !$("#sheet").hidden) openOrder(no);
}
async function loadPhotos(o) {
  photoCache[o.id] = null;
  const { data, error } = await sb.from("order_photos").select("*").eq("order_id", o.id).order("created_at");
  if (error) { delete photoCache[o.id]; return; }
  const list = data || [];
  if (list.length) {
    const s = await sb.storage.from("order-photos").createSignedUrls(list.map(p => p.path), 3600);
    list.forEach((p, i) => p.url = (s.data && s.data[i] && s.data[i].signedUrl) || "");
    if (canBill()) { const t = await sb.rpc("order_photo_link", { p_order: o.id }); list.token = t.data || null; }
  }
  photoCache[o.id] = list;
  if (oFor === o.no && !$("#sheet").hidden) openOrder(o.no);
}
const photoSeen = list => list.map(p => p.notes ? `${p.notes.toLowerCase()} on the ${(p.item || "cloth").toLowerCase()}` : (p.item || "").toLowerCase()).filter((x, i, a) => x && a.indexOf(x) === i);
const photoLink = list => `https://tagbook.ordiventa.com/photos?t=${list.token}`;
// The list of clothes carries the photo link, so the customer gets one message at drop-off, not two.
// A link the customer opens any time to see if their clothes are ready (BrightWash first, everyone from 24 Nov).
const TRACK_LIVE = Date.parse("2026-11-24T08:00:00+01:00");
const trackLine = o => o.track && shop && (shop.id === PHOTO_SHOP || Date.now() >= TRACK_LIVE || location.hostname === "localhost") ? `\n\nCheck on your clothes any time:\nhttps://tagbook.ordiventa.com/track?k=${o.track}` : "";
function listPhotoLine(o) {
  const list = photosOn() && photoCache[o.id];
  if (!list || !list.length || !list.token) return "";
  // What the photos show is already in "Noted on your clothes" (photo notes tick the Remarks), so just the link here.
  return `\n\nWe took photos of your clothes when you dropped them. See them here:\n${photoLink(list)}`;
}
function photoMsg(o, list) {
  const seen = photoSeen(list);
  return `${hello(cust(o.cid))}, this is ${shopName()}.\nWhen you dropped your clothes on ${fmtDay(o.at)}, we took photos${seen.length ? ` and noted: ${seen.join("; ")}` : ""}.\n\nYou can see them here:\n${photoLink(list)}\n\n_Sent with Tagbook_`;
}
function photoBlock(o) {
  if (!photosOn()) return "";
  if (photoCache[o.id] === undefined) loadPhotos(o);
  const list = photoCache[o.id];
  if (list === null || list === undefined) return `<div class="phblock"><b>Photos at drop-off</b><p class="hint">Loading…</p></div>`;
  if (!list.length && !phAdd && o.cancelled) return "";
  const taken = p => { const at = p.created_at || new Date().toISOString(); return `${fmtDay(Date.parse(at))}, ${new Date(at).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}${p.taken_by ? ` by ${esc(p.taken_by.split(" ")[0])}` : ""}`; };
  const add = phAdd && phAdd.no === o.no ? `<div class="phedit"><div class="phrow"><div class="phth"><img src="${esc(phAdd.url)}" alt="New photo"></div></div>
      <p class="phq">Which cloth?</p><div class="chips rpick" style="margin:0">${o.items.map(it => pname(it)).filter((x, i, a) => a.indexOf(x) === i).map(n => `<button class="chip" data-phi="${esc(n)}" aria-pressed="${phAdd.item === n}">${esc(n)}</button>`).join("")}</div>
      <p class="phq">What did you notice?</p><div class="chips rpick" style="margin:0">${photoNotes().map(n => `<button class="chip" data-phn="${esc(n)}" aria-pressed="${phAdd.notes.includes(n)}">${n}</button>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn btn-ghost" id="phcancel">Cancel</button><button class="btn btn-primary" id="phsave" ${phAdd.busy ? "disabled" : ""}>${phAdd.busy ? "Saving…" : "Save photo"}</button></div></div>` : "";
  const c = cust(o.cid);
  return `<div class="phblock"><b>Photos at drop-off</b>
    ${list.length ? `<div class="phlist">${list.map((p, j) => `<figure class="phfig"><a class="phbig" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Photo ${j + 1}${p.item ? " of " + esc(p.item) : ""}"></a>
      <figcaption class="phcap"><b>${esc(p.item || "Cloth")}${p.notes ? ": " + esc(p.notes.toLowerCase()) : ""}</b><span>Taken ${taken(p)}</span></figcaption></figure>`).join("")}</div>` : (add ? "" : `<p class="hint">Take a photo of any stain, tear or costly cloth, so you can show the customer it was there before you washed it.</p>`)}
    ${add || (o.cancelled || list.length >= 6 ? "" : `<button class="btn btn-ghost" id="phadd">${CAM_SVG} Add photo</button>`)}
    ${list.length && canBill() && list.token && o.list_sent ? `<a class="btn btn-ghost" id="phsend" href="${wa(o, photoMsg(o, list))}" target="_blank" rel="noopener">Send photos to ${esc(c.name.split(" ")[0])} on WhatsApp</a>` : ""}
    ${list.length && canBill() && !o.list_sent ? `<p class="hint">The photo link goes out with the list of clothes below.</p>` : ""}
    ${photoBusy[o.no] ? `<p class="hint">Saving photos… wait a moment before you send the list of clothes.</p>` : ""}
    ${list.length ? `<p class="hint">Photos are deleted 7 days after the clothes are collected.</p>` : ""}</div>`;
}
function wirePhotos(sh, o) {
  const again = () => openOrder(o.no);
  const a = sh.querySelector("#phadd"); if (a) a.onclick = () => pickPhoto(blob => { phAdd = { no: o.no, blob, url: URL.createObjectURL(blob), item: o.items.length === 1 ? pname(o.items[0]) : "", notes: [] }; again(); });
  if (!phAdd || phAdd.no !== o.no) return;
  sh.querySelectorAll("[data-phi]").forEach(b => b.onclick = () => { phAdd.item = b.dataset.phi; again(); });
  sh.querySelectorAll("[data-phn]").forEach(b => b.onclick = () => { const n = b.dataset.phn; phAdd.notes = phAdd.notes.includes(n) ? phAdd.notes.filter(x => x !== n) : [...phAdd.notes, n]; again(); });
  const cx = sh.querySelector("#phcancel"); if (cx) cx.onclick = () => { URL.revokeObjectURL(phAdd.url); phAdd = null; again(); };
  const sv = sh.querySelector("#phsave"); if (sv) sv.onclick = async () => {
    if (!phAdd.item) return toast("Tap which cloth the photo is of");
    phAdd.busy = true; again();
    const ok = await uploadPhoto(o.id, phAdd.blob, phAdd.item, phAdd.notes);
    if (!ok) { phAdd.busy = false; toast("Couldn't save the photo. Check your internet and try again."); return again(); }
    const add = phAdd.notes.filter(n => syncsRemark(n) && !(o.remarks || "").split("; ").includes(n));
    if (add.length) { const remarks = [...(o.remarks ? o.remarks.split("; ") : []), ...add].join("; ").slice(0, 300); const { error } = await sb.from("orders").update({ remarks }).eq("id", o.id); if (!error) o.remarks = remarks; }
    URL.revokeObjectURL(phAdd.url); phAdd = null; toast("Photo saved"); loadPhotos(o);
  };
}
function noteBlock(o) {
  if (!newOpts() && !o.remarks && !o.collect && !o.money) return "";
  const lines = [o.collect ? `<b>Collection:</b> ${esc(fmtCollect(o.collect))}` : "", o.remarks ? `<b>Remarks:</b> ${esc(o.remarks.split("; ").join(", "))}` : "", o.money ? `<b>Money found in pocket:</b> ${naira(o.money)}` : ""].filter(Boolean);
  if (o.cancelled) return lines.length ? `<div class="onotes">${lines.map(l => `<p>${l}</p>`).join("")}</div>` : "";
  const showDate = (shop.collect_dates || o.collect) && !o.wait;
  if (noteEdit === o.id && ne) return `<div class="check onoteedit">
    ${showDate ? collectPicker(ne, true) : ""}
    ${remarkPicker(ne)}
    <div class="row" style="margin-top:12px"><button class="btn btn-ghost" id="nno">Cancel</button><button class="btn btn-primary" id="ngo">Save</button></div></div>`;
  const add = !lines.length ? (showDate ? "Add collection date or remarks" : "Add remarks") : "Edit";
  return `<div class="onotes">${lines.map(l => `<p>${l}</p>`).join("")}<button class="mini" id="nedit">${add}</button></div>`;
}
function wireNote(sh, o) {
  const again = () => openOrder(o.no);
  const ed = sh.querySelector("#nedit"); if (ed) ed.onclick = () => {
    noteEdit = o.id;
    ne = { wait: false, express: false, cDate: o.collect ? localDate(o.collect) : "", cTime: o.collect ? localTime(o.collect) : "", cOther: false, tOther: false, expDays: 0, rm: o.remarks ? o.remarks.split("; ").filter(Boolean) : [], money: o.money || 0, rmOther: false };
    again();
  };
  if (noteEdit !== o.id || !ne) return;
  wireCollect(sh, ne, again); wireRemarks(sh, ne, again);
  const no = sh.querySelector("#nno"); if (no) no.onclick = () => { noteEdit = null; ne = null; again(); };
  const go = sh.querySelector("#ngo"); if (!go) return;
  go.onclick = async () => {
    const showDate = (shop.collect_dates || o.collect) && !o.wait;
    const collect = showDate ? collectIso(ne.cDate, ne.cTime) : (o.collect ? new Date(o.collect).toISOString() : null);
    const remarks = ne.rm.length ? ne.rm.join("; ").slice(0, 300) : null, money = ne.money || null;
    go.disabled = true;
    if (!(await put("orders", { id: o.id }, { collect_at: collect, remarks, money_found: money }))) { go.disabled = false; return; }
    o.collect = collect ? Date.parse(collect) : 0; o.remarks = remarks || ""; o.money = money || 0; noteEdit = null; ne = null;
    toast(o.list_sent && canBill() ? "Saved. Send the list of clothes again if the customer should know." : "Saved");
    again();
  };
}
let billEdit = null, partOpen = null;
// Tapping a send button counts as sent: the order moves on, and "Send again" stays available.
function markSent(o, type) {
  if (type === "list" && !o.list_sent) { o.list_sent = true; const st = o.status === "new" ? "listed" : o.status; o.status = st; put("orders", { id: o.id }, { list_sent: true, status: st }); }
  else if (type === "ready" && o.status === "ready") { o.status = "told"; put("orders", { id: o.id }, { status: "told" }); }
  else return;
  if (o.again) o.again[type] = false;
  setTimeout(() => { if (oFor === o.no && !$("#sheet").hidden) openOrder(o.no); }, 600);
}
function openOrder(no) {
  const o = orders.find(x => x.no === no) || cancelledOrders.find(x => x.no === no); if (!o) { go("orders"); return; }
  if (oFor !== no) { oFor = no; oMode = null; oMenu = false; oDraft = null; fxAdd = false; ogOther = false; billEdit = null; partOpen = null; if (phAdd) { URL.revokeObjectURL(phAdd.url); phAdd = null; } }
  if (o.cancelled || oMode) { fixView(o); return; }
  const c = cust(o.cid), k = calc(o), sh = $("#sheet");
  if (canBill() && !o.notified) { o.notified = true; put("orders", { id: o.id }, { notified: true }); }
  const idx = STEPS.findIndex(s => s[0] === o.status);
  const allChecked = o.items.every((_, i) => o.checked[i]);
  const canEditBill = canBill() && o.status !== "picked";
  const first = esc(c.name.split(" ")[0]);
  const checkHtml = () => {
    if (!(o.status === "new" || o.status === "listed")) return "";
    return o.checking ? `<div class="check"><p><b>Check before bagging.</b> Gather every cloth with mark <b>${esc(c.mark)}</b> inside, and tick each one. If something is missing, you find out now, not when the customer comes.</p>
        ${o.items.map((it, i) => `<label class="ck"><input type="checkbox" data-ck="${i}" ${o.checked[i] ? "checked" : ""}> ${it.qty} × ${esc(pname(it) + pcsTag(it))}</label>`).join("")}
        <button class="btn btn-primary" id="rd" ${allChecked ? "" : "disabled"}>All here. Mark ready</button></div>`
      : `<button class="btn ${canBill() && !o.list_sent ? "btn-ghost" : "btn-primary"}" id="washed">Clothes are ready</button>
        <p class="hint">Tap when washing and ironing is done. You'll tick each cloth with mark ${esc(c.mark)} as you pack it.</p>`;
  };
  // One clear "next step" at the top; everything else sits in its own section below.
  const card = (h, p, body) => `<section class="ocard onext"><small>Next step</small><h2>${h}</h2>${p ? `<p>${p}</p>` : ""}${body}</section>`;
  const still = owed(o) ? ` ${naira(owed(o))} still to pay.` : "";
  let next = "";
  if (canBill()) {
    if (o.status === "picked") next = owed(o) ? card(`${first} still owes ${naira(owed(o))}`, "Send a payment reminder with the invoice.", waBlock(o, "owe")) : "";
    else if (o.status === "told") next = card(`Has ${first} picked up the clothes?`, still.trim(), `<button class="btn btn-primary" id="pick">Clothes picked up</button>`) ;
    else if (o.status === "ready") next = o.billed ? card(`Tell ${first} the clothes are ready`, `Sends the bill with the ready message.${still}`, waBlock(o, "ready") + `<button class="olink" id="pick" style="margin-top:10px">Already picked up?</button>`)
      : card("Save the bill first", "The ready message goes out with the bill.", `<button class="btn btn-primary" id="gobill">Open the bill</button>`);
    // Shops that don't send lists can go straight to "Clothes are ready".
    else if (o.status === "new" && !o.list_sent) next = o.checking ? card("Pack and check the clothes", "", checkHtml())
      : card(`Send ${first} the list of clothes`, `So ${first} has a record of the ${countTxt(o)} dropped off.`, waBlock(o, "list") + `<p class="orsep">Or, when the clothes are done</p>` + checkHtml());
    else next = card(o.checking ? "Pack and check the clothes" : "When the clothes are done", "", checkHtml());
  } else {
    if (o.status === "new" || o.status === "listed") next = card(o.checking ? "Pack and check the clothes" : "When the clothes are done", "", checkHtml());
    else if (o.status === "ready") next = card("Ready and bagged", "Waiting for the owner to tell the customer.", `<button class="btn btn-ghost" id="pick">Clothes picked up</button>`);
    else if (o.status === "told") next = card(`Has ${first} picked up the clothes?`, "", `<button class="btn btn-primary" id="pick">Clothes picked up</button>`);
  }
  // Messages already sent, with a way to send again.
  let sent = "";
  if (canBill()) {
    if (o.list_sent && !(o.status === "new" && !o.list_sent)) sent += sentLine(o, "list", "List of clothes sent.");
    if (o.status === "told" || (o.status === "picked" && o.billed)) sent += sentLine(o, "ready", "Ready message and bill sent.");
  }
  let payHtml = "", billHtml = "";
  if (canBill()) {
    const editing = canEditBill && (!o.billed || billEdit === o.id);
    const pairNote = partner(o) ? (q => `<p class="pairnote">Dropped together with <a href="#order-${q.no}">order #${q.no}</a>${q.express ? " (⚡ express)" : ""}. You can send the customer one bill for both.</p>`)(partner(o)) : "";
    billHtml = `<section class="ocard" id="billcard"><h3>Clothes and bill ${o.billed ? `<span class="pill p-ready">Saved</span>` : ""}${o.billed && canEditBill && !editing ? `<button class="olink" id="billedit">Edit</button>` : ""}</h3>`;
    if (editing) {
      billHtml += `<div class="lines">
        ${o.items.map((it, i) => { const p = item(it.id) || {}; return `<div><span>${it.qty} × ${esc(pname(it) + pcsTag(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}</small></span>${p.custom ? `<input data-cp="${i}" ${moneyAttrs} placeholder="Set price" value="${o.m.custom[i] || ""}" aria-label="Price for ${esc(pname(it))}">` : !unitPrice(o, it, i) ? !own() ? `<span class="bad">No price yet</span>` : `<input data-np="${i}" ${moneyAttrs} placeholder="Price not set" aria-label="Price for one ${esc(pname(it))}">` : `<span>${naira(unitPrice(o, it, i) * it.qty)}</span>`}</div>`; }).join("")}
        ${o.items.some((it, i) => !(item(it.id) || {}).custom && !unitPrice(o, it, i)) ? `<p class="bad" style="margin:4px 0">Some clothes have no price yet. Type the price for one, and it's saved to your price list.</p>` : ""}
        ${o.wait ? `<div><span>Wait &amp; get${spLabel(o)}</span>${spManual(o) ? `<input id="exa" ${moneyAttrs} placeholder="Amount" value="${o.m.express_amt || ""}" aria-label="Wait and get amount">` : `<span id="exv">${naira(k.exp)}</span>`}</div>`
        : `<div><label class="ck" style="margin:0"><input type="checkbox" id="ex" ${o.express ? "checked" : ""}> Express delivery${expressLabel()}</label>${expManual() ? `<input id="exa" ${moneyAttrs} placeholder="Amount" value="${o.express && o.m.express_amt ? o.m.express_amt : ""}" aria-label="Express delivery amount">` : `<span id="exv">${naira(k.exp)}</span>`}</div>`}
        <div><span>Pickup / delivery${o.pickup ? "<br><small style='color:var(--muted)'>Customer asked for it</small>" : ""}</span><input id="dl" ${moneyAttrs} placeholder="0" value="${o.m.delivery || ""}" aria-label="Pickup or delivery cost"></div>
        ${own() ? `<div><span>Discount</span><input id="dc" ${moneyAttrs} placeholder="0" value="${o.m.discount || ""}" aria-label="Discount"></div>` : o.m.discount ? `<div><span>Discount</span><span>−${naira(o.m.discount)}</span></div>` : ""}
        <div><b>Total · ${countTxt(o)}</b><b id="tot">${naira(k.total)}</b></div></div>
        ${canFix(o) ? `<p class="hint" style="margin:6px 0 0">Wrong clothes or number of clothes? <button class="olink" data-om="items">Change the clothes</button></p>` : `<p class="hint" style="margin:6px 0 0">Wrong clothes or number of clothes? Ask the owner to change them under More, Edit clothes.</p>`}
        <button class="btn btn-primary" id="bill">${o.billed ? "Save changes" : "Save bill"}</button>
        ${o.billed ? `<button class="olink" id="billcancel" style="margin-top:8px">Cancel</button>` : `<p class="hint">Save the bill to send it now, or it goes out with the ready message.</p>`}`;
    } else {
      billHtml += `<div class="lines">
        ${o.items.map((it, i) => `<div><span>${it.qty} × ${esc(pname(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}${pcsOf(it) > 1 ? ` · ${it.qty * pcsOf(it)} pieces` : ""}</small></span><span>${naira(unitPrice(o, it, i) * it.qty)}</span></div>`).join("")}
        ${k.exp ? `<div><span>${spName(o)}</span><span>${naira(k.exp)}</span></div>` : ""}
        ${o.m.delivery ? `<div><span>Pickup / delivery</span><span>${naira(o.m.delivery)}</span></div>` : ""}
        ${o.m.discount ? `<div><span>Discount</span><span>−${naira(o.m.discount)}</span></div>` : ""}
        <div><b>Total · ${countTxt(o)}</b><b>${naira(o.billed ? o.m.total : k.total)}</b></div></div>`;
      if ((o.status === "new" || o.status === "listed") && o.billed) billHtml += `<details class="early"${earlyOpen === o.id ? " open" : ""}><summary>${partner(o) ? `Send one bill for both orders (#${Math.min(o.no, partner(o).no)} and #${Math.max(o.no, partner(o).no)}) now` : "Send the bill now, before the clothes are ready"}</summary>${waBlock(o, "early")}</details>`;
    }
    billHtml += pairNote + `</section>`;
    const n = (o.m.payments || []).length;
    payHtml = `<section class="ocard"><h3>Payment</h3>
      <div class="mtiles"><div><b>${o.billed ? naira(o.m.total) : "–"}</b><span>Total</span></div><div><b>${naira(o.m.paid)}</b><span>Paid</span></div>
        <div class="${owed(o) ? "owe" : o.billed ? "ok" : ""}"><b>${o.billed ? (owed(o) ? naira(owed(o)) : "Paid") : "–"}</b><span>${o.billed ? (owed(o) ? "Still to pay" : "In full") : "Save the bill"}</span></div></div>
      ${o.billed && !owed(o) ? "" : `<div class="two">${o.billed ? `<button class="btn btn-primary" id="ppall">Paid ${naira(owed(o))}</button>` : ""}<button class="btn btn-ghost" id="ppart" aria-expanded="${partOpen === o.id}">${o.billed ? "Part payment" : "Customer paid early"}</button></div>
        ${partOpen === o.id ? `<div class="ppbox"><label for="pay">Amount received (₦)</label><input id="pay" ${moneyAttrs} placeholder="0"><button class="btn btn-primary" id="pp">Record payment</button></div>` : ""}`}
      ${n ? `<details class="phist"><summary>${n} payment${n > 1 ? "s" : ""} · ${naira(o.m.paid)}<span>See all</span></summary>${payList(o)}</details>` : ""}</section>`;
  } else {
    billHtml = `<section class="ocard"><h3>Clothes</h3><div class="lines">${o.items.map(it => `<div><span>${it.qty} × ${esc(pname(it) + pcsTag(it))}</span><span style="color:var(--muted)">${SERVICES[it.svc]}</span></div>`).join("")}
      <div><b>Clothes</b><b>${countTxt(o)}</b></div></div></section>`;
    payHtml = `<section class="ocard"><h3>Payment</h3>` + (o.billed && o.settled ? `<p class="hint"><span class="pill p-collected">Paid in full</span></p>`
      : payForm("0", o.billed) + `<p class="hint">${o.billed ? "Tap Paid in full if the customer paid everything. Otherwise type what they gave you." : "Type what the customer gave you."} The owner sees it straight away.</p>`) + `</section>`;
  }
  const whoHtml = o.duty && (o.duty.by || o.duty.bill || (o.duty.w || []).length) ? `<section class="ocard owho"><p class="lbl">Who worked on it</p><p>${[o.duty.by ? "Received by " + esc(o.duty.by) : "", o.duty.bill ? "Bill by " + esc(o.duty.bill) : ""].filter(Boolean).join(" · ")}${(o.duty.w || []).length ? `${o.duty.by || o.duty.bill ? "<br>" : ""}Laundry attendants: ${esc(andList(o.duty.w))}` : ""}</p></section>` : "";
  const y = sh.hidden ? 0 : sh.scrollTop;
  sh.innerHTML = `<div class="app oview">
    ${orderTop(o)}
    <div class="dhead"><div class="${markCls(c.mark)}">${esc(c.mark)}</div><div><b>${esc(c.name)}</b>
      <span>${canBill() && c.phone ? fmtPhone(c.phone) + " · " : ""}#${o.no}${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}${speedLabel(o) ? " · " + speedLabel(o) : ""}</span></div></div>
    <div class="steps"><span class="fill" style="width:${idx * 20}%"></span>${STEPS.map((s, i) => `<div class="st ${i === 1 && !o.list_sent && idx > 1 ? "" : i < idx || (i === idx && o.status === "picked") ? "done" : i === idx ? "cur" : ""}">${s[1]}</div>`).join("")}</div>
    <p class="hint">Dropped ${fmtDay(o.at)}${o.collect ? ` · ready by ${esc(fmtCollect(o.collect))}` : ""}</p>
    ${next}${sent}
    ${payHtml}
    ${billHtml}
    <section class="ocard oprint">${printBlock(o)}</section>
    <section class="ocard"><h3>Photos and notes</h3>${noteBlock(o)}${photoBlock(o)}</section>
    ${whoHtml}
  </div>`;
  const wasHidden = sh.hidden; sh.hidden = false; sh.scrollTop = wasHidden ? 0 : y;
  wireBack(sh); wireFix(sh, o); wireNote(sh, o); wirePhotos(sh, o);
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
  sh.querySelectorAll("[data-pdf]").forEach(b => b.onclick = () => sendInvoice(b.dataset.pdf === "early" ? withCombo(o) : o, b, b.dataset.pdf));
  sh.querySelectorAll("details.early").forEach(dt => dt.ontoggle = () => { earlyOpen = dt.open ? o.id : null; });
  sh.querySelectorAll("[data-bt]").forEach(b => b.onclick = () => { btEdit = o.cid; openOrder(o.no); const i = $("#btn-in"); if (i) { i.focus(); i.select(); } });
  sh.querySelectorAll("[data-btok]").forEach(b => b.onclick = async () => { const c = cust(o.cid); b.disabled = true; if (await put("customers", { id: c.id }, { inv_name: c.name.slice(0, 60) })) c.inv_name = c.name.slice(0, 60); openOrder(o.no); });
  if ($("#btn-save")) $("#btn-save").onclick = async () => {
    const c = cust(o.cid), keep = tidy($("#btn-in").value).slice(0, 60);
    $("#btn-save").disabled = true;
    if (await put("customers", { id: c.id }, { inv_name: keep })) { c.inv_name = keep; invReady = null; toast("Saved"); }
    btEdit = null; openOrder(o.no);
  };
  sh.querySelectorAll("[data-wtxt]").forEach(a => a.addEventListener("click", () => { logSend("text", a.dataset.wtxt); if (BILL_STAGES.includes(a.dataset.wtxt)) stampBill(o); markSent(o, a.dataset.wtxt); }));
  if ($("#billedit")) $("#billedit").onclick = () => { billEdit = o.id; again(); };
  if ($("#billcancel")) $("#billcancel").onclick = () => { billEdit = null; again(); };
  if ($("#gobill")) $("#gobill").onclick = () => { const b = $("#billcard"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); };
  if ($("#ppart")) $("#ppart").onclick = () => { partOpen = partOpen === o.id ? null : o.id; again(); const i = $("#pay"); if (i) i.focus(); };
  sh.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
    const t = message(o, b.dataset.copy); logSend("text", b.dataset.copy); if (BILL_STAGES.includes(b.dataset.copy)) stampBill(o); markSent(o, b.dataset.copy);
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
  sh.querySelectorAll("[data-np]").forEach(i => { moneyInput(i, () => { }); i.onchange = async () => { const it = o.items[+i.dataset.np], v = num(i.value); if (!v) return; if (await setPrice(it.id, it.svc, v)) { toast(`${item(it.id).name}: ${naira(v)} saved to your price list`); again(); } }; });
  moneyInput($("#dl"), v => { o.m.delivery = v; live(); });
  if ($("#dc")) moneyInput($("#dc"), v => { o.m.discount = v; live(); });
  moneyInput($("#pay"), () => { });
  if ($("#ex")) $("#ex").onchange = e => { o.express = e.target.checked; if (!expManual()) o.m.express_amt = 0; else if (o.express && $("#exa")) $("#exa").focus(); live(); };
  if ($("#exa")) moneyInput($("#exa"), v => { o.m.express_amt = v; if (v && !o.express && !o.wait) { o.express = true; $("#ex").checked = true; } live(); });
  const bill = $("#bill"); if (bill) bill.onclick = async () => {
    const miss = o.items.find((it, i) => (item(it.id) || {}).custom && !o.m.custom[i]);
    if (miss) { toast(`Set a price for ${pname(miss)} first`); return; }
    const noPrice = o.items.find((it, i) => !(item(it.id) || {}).custom && !unitPrice(o, it, i));
    if (noPrice && !own()) { toast(`${pname(noPrice)} has no price yet. Ask the owner to set it.`); return; }
    if (noPrice) { toast(`Set a price for ${pname(noPrice)} first`); const f = sh.querySelector("[data-np]"); if (f) f.focus(); return; }
    if ((o.express || o.wait) && spManual(o) && !(+o.m.express_amt > 0)) { toast(`Type the ${spName(o).toLowerCase()} amount`); $("#exa").focus(); return; }
    if (!o.billed) lockPrices(o);
    const kk = calc(o);
    if (+o.m.paid > kk.total) {
      if (!own()) { toast(`${naira(o.m.paid)} is already recorded as paid, more than this bill. Ask the owner to fix the payment first.`); return; }
      if (!await askConfirm(`Paid is more than the bill`, `${naira(o.m.paid)} is recorded as paid, but this bill is ${naira(kk.total)}. If a payment was recorded by mistake, remove it under Payment. Save the bill anyway?`, "Save anyway")) return;
    }
    o.m.express_amt = kk.exp; o.m.total = kk.total; o.m.billed_at = o.m.billed_at || new Date().toISOString();
    bill.disabled = true;
    if (await put("orders", { id: o.id }, { express: o.express }) && await saveMoney(o)) {
      // Special items priced here go on the price list too, so next time staff just tap them.
      const added = [];
      for (const [i, it] of o.items.entries()) {
        if (!(item(it.id) || {}).custom || !it.label || !+o.m.custom[i]) continue;
        const known = PRICES.find(x => !x.custom && x.name.toLowerCase() === it.label.toLowerCase() && (x.p || {})[it.svc] && !x.hidden);
        if (own() && !known && await toPriceList(tidy(it.label).slice(0, 40), it.svc, +o.m.custom[i])) added.push(it.label);
      }
      toast(added.length ? `Bill saved. Added ${added.join(", ")} to your price list.` : "Bill saved");
      billEdit = null;
    }
    again();
  };
  sh.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { payMethod = b.dataset.pm; sh.querySelectorAll("[data-pm]").forEach(x => x.setAttribute("aria-pressed", x.dataset.pm === payMethod)); });
  // Paid in full: we send the largest amount allowed and the server caps it at what's still owed.
  const doPay = async (pp, v) => {
    const label = pp.textContent; pp.disabled = true; pp.textContent = "Recording…";
    const { data, error } = await sb.rpc("record_payment", { p_order: o.id, p_amount: v, p_method: payMethod });
    if (error) { toast(/ALREADY_PAID/.test(error.message || "") ? "This order is already fully paid." : failMsg(error)); pp.disabled = false; pp.textContent = label; return; }
    v = data.added; partOpen = null;
    let extra = ""; const q = partner(o), rest = pp.id === "pp" ? Math.max(0, num(($("#pay") || {}).value || "0") - data.added) : 0;
    if (q && rest > 0 && q.billed && owed(q) > 0) { const r2 = await sb.rpc("record_payment", { p_order: q.id, p_amount: Math.min(rest, owed(q)), p_method: payMethod }); if (!r2.error) extra = ` ${naira(r2.data.added)} went to order #${q.no}, dropped together.`; }
    try { await load(); } catch (_) { }
    if (own()) toast((data.billed && data.paid < data.total ? `Recorded ${naira(data.added)}. ${naira(data.total - data.paid)} still to pay.` : data.billed ? "Recorded. Fully paid." : `Recorded ${naira(data.added)} paid early`) + extra);
    else toast(data.settled ? "Recorded. The customer has now paid in full. The owner has been told." : `Recorded ${naira(v)}. The owner has been told.`);
    render();
  };
  const who = esc(cust(o.cid).name);
  const up = $("#unpay"); if (up) up.onclick = async () => {
    const last = o.m.payments[o.m.payments.length - 1];
    if (!await askConfirm(`Remove ${naira(last.amt)}?`, `The last payment on order #${o.no}${last.by ? `, recorded by ${esc(last.by)}` : ""}. Only do this if it was recorded by mistake.`, "Yes, remove it")) return;
    up.disabled = true;
    const { error } = await sb.rpc("remove_last_payment", { p_order: o.id });
    if (error) { toast(failMsg(error)); up.disabled = false; return; }
    try { await load(); } catch (_) { }
    toast(`Removed ${naira(last.amt)}`); render();
  };
  const pp = $("#pp"); if (pp) pp.onclick = async () => { const v = num($("#pay").value); if (!v) { toast("Type the amount received"); return; }
    if (await askConfirm(`Record ${naira(v)}?`, `Payment from ${who}, order #${o.no}.`, "Yes, record it")) doPay(pp, v); };
  const pa = $("#ppall"); if (pa) pa.onclick = async () => {
    if (await askConfirm("Mark as paid in full?", `${o.billed && owed(o) ? `${naira(owed(o))} from ${who}` : `Full payment from ${who}`}, order #${o.no}.`, "Yes, paid in full")) doPay(pa, 100000000); };
  const w = $("#washed"); if (w) w.onclick = () => { o.checking = true; again(); put("orders", { id: o.id }, { checking: true }); };
  sh.querySelectorAll("[data-ck]").forEach(b => b.onchange = () => { o.checked = { ...o.checked, [b.dataset.ck]: b.checked }; again(); put("orders", { id: o.id }, { checked: o.checked }); });
  const rd = $("#rd"); if (rd) rd.onclick = () => setStatus("ready", canBill() ? "Marked ready. Send the ready message." : "Marked ready. The owner has been told.");
  const pk = $("#pick"); if (pk) pk.onclick = async () => {
    if (!await askConfirm(`Has ${cust(o.cid).name} picked up their clothes?`, `Order #${o.no}. After this, the bill can't be changed.${owed(o) ? ` They still owe ${naira(owed(o))}.` : ""}`, "Yes, picked up")) return;
    setStatus("picked", owed(o) ? "Picked up. Not fully paid yet." : "Picked up"); };
}

/* ---------- Reports (owner) ---------- */
// Expenses (owner only): money spent on the shop, so Reports can show what is left. BrightWash first, every shop from 19 Nov, 6pm.
const EXP_LIVE = Date.parse("2026-11-19T18:00:00+01:00");
// Express for some clothes only (asked for by ProClean, 20 Nov): BrightWash first, everyone from 8am on 21 Nov.
const XP_LIVE = Date.parse("2026-11-21T08:00:00+01:00");
// Staff who can send bills: BrightWash first, everyone from 8am on 22 Nov (asked for by Mr Akiba of Impressions Laundry).
const BILL_LIVE = Date.parse("2026-11-22T08:00:00+01:00");
// "Tap to copy number" on invoices and the full text bill with the PDF: approved for every shop on 23 Nov 2026.
// The link carries only the shop's pay token; the page looks up the account number, so a link can't be edited to show another account.
const copyLive = () => !!shop && !!shop.pay_token;
// Team on duty, a note per cloth and pieces: BrightWash first (asked for by Impressions Laundry), everyone from 24 Nov.
const TEAM_LIVE = Date.parse("2026-11-24T08:00:00+01:00");
const teamLive = () => !!shop && (shop.id === PHOTO_SHOP || Date.now() >= TEAM_LIVE || location.hostname === "localhost");
const crew = () => Array.isArray(shop && shop.crew) ? shop.crew.filter(x => x && x.n) : [];
let dutyMem = null, dutyOpen = false, crewRole = "c", crewName = "";
const dutyGet = () => { try { return JSON.parse(localStorage.getItem("tb-duty-" + shop.id) || "null") || dutyMem; } catch (_) { return dutyMem; } };
const dutySet = v => { dutyMem = v; try { localStorage.setItem("tb-duty-" + shop.id, JSON.stringify(v)); } catch (_) { } };
// Who is on duty on this phone. It stays until someone changes it (no daily reset), keeping only names still on the team.
const dutyNow = () => {
  if (!teamLive() || !crew().length) return null;
  const v = dutyGet() || {}, names = crew().map(x => x.n), by = names.includes(v.by) ? v.by : "", w = (v.w || []).filter(n => names.includes(n));
  return by || w.length ? { by, w } : null;
};
// A small bar on Orders and Log clothes, only in shops that added team names. Tapping a name saves it straight away.
function dutyBlock() {
  if (!teamLive() || !crew().length) return "";
  const now = dutyNow();
  if (!dutyOpen) return now
    ? `<button class="duty" id="dutyedit"><span class="dlab">On duty</span><span class="dnames">${esc([now.by, andList(now.w)].filter(Boolean).join(" · "))}</span><span class="dch">Change</span></button>`
    : `<button class="duty need" id="dutyedit"><span class="dnames">Choose who is on duty today</span><span class="dch">Choose</span></button>`;
  const v = now || { by: "", w: [] }, cs = crew().filter(x => x.r === "c"), as = crew().filter(x => x.r !== "c");
  const group = (t, list, attr, on) => list.length ? `<p class="dsub">${t}</p><div class="chips" style="margin:0">${list.map(x => `<button class="chip" ${attr}="${esc(x.n)}" aria-pressed="${on(x.n)}">${esc(x.n)}</button>`).join("")}</div>` : "";
  return `<div class="duty open"><div class="dtop"><b>Who is on duty?</b><button class="dch" id="dutyok">Done</button></div>
    ${group("Cashier", cs, "data-dby", n => v.by === n)}${group("Laundry attendants", as, "data-dw", n => v.w.includes(n))}</div>`;
}
// In shops that added team names, an order can't be saved until the cashier on duty is chosen (or an attendant, if the shop has no cashiers).
const dutyMissing = () => {
  if (!teamLive() || !crew().length) return "";
  const now = dutyNow() || { by: "", w: [] }, hasC = crew().some(x => x.r === "c");
  return hasC && !now.by ? "Choose the cashier on duty first, at the top of the page." : !hasC && !now.w.length ? "Choose who is on duty first, at the top of the page." : "";
};
function wireDuty(again) {
  const e = $("#dutyedit"); if (e) e.onclick = () => { dutyOpen = true; again(); };
  const cur = () => dutyNow() || { by: "", w: [] }, names = () => crew().map(x => x.n);
  view.querySelectorAll("[data-dby]").forEach(b => b.onclick = () => { const v = cur(), n = b.dataset.dby; dutySet({ by: v.by === n ? "" : n, w: v.w }); again(); });
  view.querySelectorAll("[data-dw]").forEach(b => b.onclick = () => { const v = cur(), n = b.dataset.dw, w = v.w.includes(n) ? v.w.filter(x => x !== n) : [...v.w, n]; dutySet({ by: v.by, w: names().filter(x => w.includes(x)) }); again(); });
  const ok = $("#dutyok"); if (ok) ok.onclick = () => { dutyOpen = false; again(); };
}
const crewCard = () => !teamLive() ? "" : card("Team on duty", "Names for your bills: which cashier prepared the bill and which laundry attendants were on duty. Names only, no logins. Each day, the shop's phone picks who is on duty on the Log clothes page.",
  `${crew().map((x, i) => `<div class="staff-row"><div><b>${esc(x.n)}</b><span>${x.r === "c" ? "Cashier" : "Laundry attendant"}</span></div><div class="acts"><button class="mini danger" data-crm="${i}">Remove</button></div></div>`).join("") || `<p class="hint">No names yet. Add your cashiers and laundry attendants.</p>`}
   <label for="crn">Name</label><input id="crn" maxlength="30" autocomplete="off" value="${esc(crewName)}">
   <div class="chips" style="margin:8px 0 0"><button class="chip" data-crr="c" aria-pressed="${crewRole === "c"}">Cashier</button><button class="chip" data-crr="a" aria-pressed="${crewRole === "a"}">Laundry attendant</button></div>
   <button class="btn btn-ghost" id="cra" style="margin-top:10px">+ Add name</button>`);
function wireCrew() {
  if (!$("#cra")) return;
  const save = async next => { const old = shop.crew; shop.crew = next; renderSettings(); const ok = await put("shops", { id: shop.id }, { crew: next }); if (!ok) { shop.crew = old; renderSettings(); } else savedToast(ok); };
  $("#crn").oninput = e => { crewName = e.target.value; };
  view.querySelectorAll("[data-crr]").forEach(b => b.onclick = () => { crewRole = b.dataset.crr; renderSettings(); });
  const add = (n, typed) => {
    if (!n) { toast("Type the name first"); $("#crn").focus(); return; }
    if (crew().some(x => x.n.toLowerCase() === n.toLowerCase())) { toast(`${n} is already on the list`); return; }
    if (crew().length >= 30) { toast("That's the most names for now"); return; }
    if (typed) crewName = "";
    save([...crew(), { n, r: crewRole }]);
  };
  $("#cra").onclick = () => add(tidy(crewName).slice(0, 30), true);
  view.querySelectorAll("[data-crm]").forEach(b => b.onclick = () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again"; return; } save(crew().filter((_, j) => j !== +b.dataset.crm)); });
}
const billLive = () => !!shop && (shop.id === PHOTO_SHOP || Date.now() >= BILL_LIVE || location.hostname === "localhost");
const xpLive = () => !!shop && (shop.id === PHOTO_SHOP || Date.now() >= XP_LIVE || location.hostname === "localhost");
const expOn = () => !!shop && own() && (shop.id === PHOTO_SHOP || Date.now() >= EXP_LIVE || location.hostname === "localhost");
const EXP_KINDS = [["soap", "Soap"], ["chemicals", "Stain remover and chemicals"], ["fuel", "Fuel"], ["staff", "Staff pay"], ["electricity", "Electricity bill"], ["rent", "Rent"], ["nylon", "Packing nylon"], ["starch", "Starch"], ["maintenance", "Generator, machine and repairs"], ["other", "Other"]];
const expKind = k => (EXP_KINDS.find(x => x[0] === k) || EXP_KINDS[EXP_KINDS.length - 1])[1];
const expDay = d => { const [y, mo, dd] = String(d).split("-").map(Number); return new Date(y, mo - 1, dd); };
const ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
let expAdd = null, expK = 0, expT = "day";
function dkey(x) { return x.getFullYear() + "-" + (x.getMonth() + 1) + "-" + x.getDate(); }
function liveByDay() {
  const m = {}; const add = (ts, f, v) => { const k = dkey(new Date(ts)); (m[k] = m[k] || { orders: 0, clothes: 0, billed: 0, received: 0, spent: 0 })[f] += v; };
  if (expOn()) expenses.forEach(x => add(expDay(x.spent_on).getTime(), "spent", x.amount));
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
  const tot = { orders: 0, clothes: 0, billed: 0, received: 0, spent: 0 }; const x = new Date(s); const now = new Date(); now.setHours(23, 59, 59, 999);
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
  if (!view.querySelector(".exnav")) { expT = "day"; expK = 0; expAdd = null; } // Spending opens on today
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
    ${expOn() ? expHtml(live) : ""}
    <p class="hint">Money received counts payments on the day they came in. Billed counts bills on the day they were made, paid or not.</p>`;
  wireBack(view);
  if (expOn()) wireExp();
  view.querySelectorAll("[data-rt]").forEach(b => b.onclick = () => { rep = { type: b.dataset.rt, k: 0, sel: null }; renderReports(); });
  $("#rprev").onclick = () => { rep.k--; rep.sel = null; renderReports(); };
  $("#rnext").onclick = () => { rep.k++; rep.sel = null; renderReports(); };
  view.querySelectorAll("[data-bi]").forEach(b => b.onclick = () => { rep.sel = +b.dataset.bi; renderReports(); });
}

// Spending opens on today. Day shows each expense (and adds to that day); week, month and year show totals by type.
function expHtml(live) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const D = periodRange(expT, expK), cur = sumRange(D.s, D.e, live), isDay = expT === "day";
  const sofar = !isDay && expK === 0 ? " so far" : "", lbl = periodLabel(expT, expK, D);
  const first = new Date(Date.parse(shop.created_at)); first.setHours(0, 0, 0, 0);
  const day = ymd(D.s), left = cur.received - cur.spent;
  const list = expenses.filter(x => { const d = expDay(x.spent_on); return d >= D.s && d < D.e; }).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const byKind = {}; list.forEach(x => byKind[x.kind] = (byKind[x.kind] || 0) + x.amount);
  const rows = !isDay ? Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${esc(expKind(k))}</span><b>${naira(v)}</b></div>`).join("") : list.map(x => `<div class="exrow"><span><b>${esc(expKind(x.kind))}</b>${x.note ? `<em class="exnote">${esc(x.note)}</em>` : ""}</span><span class="exr"><b>${naira(x.amount)}</b><button class="exdel" data-exdel="${x.id}" aria-label="Delete ${esc(expKind(x.kind))} ${naira(x.amount)}">×</button></span></div>`).join("");
  const form = expAdd ? `<div class="exform"><label for="exa">Amount spent (₦)</label><input id="exa" ${moneyAttrs} value="${expAdd.amt || ""}" placeholder="e.g. 4500">
      <p class="exl">What was it for?</p><div class="chips exchips">${EXP_KINDS.map(([k, l]) => `<button class="chip" data-exk="${k}" aria-pressed="${expAdd.kind === k}">${l}</button>`).join("")}</div>
      <label for="exn">Note (optional)</label><input id="exn" maxlength="120" value="${esc(expAdd.note || "")}" placeholder="e.g. 2 bags of Ariel" autocomplete="off">
      <div class="row" style="margin-top:12px"><button class="btn btn-ghost" id="excancel">Cancel</button><button class="btn btn-primary" id="exsave" ${expAdd.busy ? "disabled" : ""}>${expAdd.busy ? "Saving…" : "Save expense"}</button></div></div>` : "";
  return `<h3 class="exh">Spending</h3>
    <div class="chips">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([k, l]) => `<button class="chip" data-ext="${k}" aria-pressed="${expT === k}">${l}</button>`).join("")}</div>
    <div class="rnav exnav"><button class="rbtn" id="exprev" aria-label="Previous" ${D.s > first ? "" : "disabled"}>‹</button><b>${lbl}</b><button class="rbtn" id="exnext" aria-label="Next" ${expK < 0 ? "" : "disabled"}>›</button></div>
    <div class="lines"><div><span>Money received${sofar}</span><b>${naira(cur.received)}</b></div><div><span>Spent on the shop${sofar}</span><b>${naira(cur.spent)}</b></div>
      <div class="exleft"><span>Left</span><b style="color:${left < 0 ? "var(--owes)" : "inherit"}">${left < 0 ? "−" : ""}${naira(Math.abs(left))}</b></div></div>
    ${!isDay ? "" : form || `<button class="btn btn-ghost" id="exadd" style="margin-top:10px">+ Add expense${expK === 0 ? "" : ` for ${lbl}`}</button>`}
    ${list.length ? `<div class="lines exlist">${isDay ? "" : `<div class="exsub"><span>Spent by type</span></div>`}${rows}</div>` : `<p class="hint">No expenses recorded for ${!isDay ? `this ${expT}` : expK === 0 ? "today" : expK === -1 ? "yesterday" : "this day"}.${isDay ? " Add what you spend on soap, fuel, staff pay and more, and Tagbook shows what's left." : ""}</p>`}
    ${isDay ? "" : `<p class="hint">To add an expense, tap Day.</p>`}`;
}
function wireExp() {
  view.querySelectorAll("[data-ext]").forEach(b => b.onclick = () => { expT = b.dataset.ext; expK = 0; expAdd = null; renderReports(); });
  const pv = $("#exprev"); if (pv) pv.onclick = () => { expK--; expAdd = null; renderReports(); };
  const nx = $("#exnext"); if (nx) nx.onclick = () => { expK++; expAdd = null; renderReports(); };
  const ad = $("#exadd"); if (ad) ad.onclick = () => { expAdd = { kind: null }; renderReports(); const a = $("#exa"); if (a) a.focus(); };
  const a = $("#exa"); if (a) moneyInput(a, v => expAdd.amt = v || "");
  view.querySelectorAll("[data-exk]").forEach(b => b.onclick = () => { expAdd.kind = b.dataset.exk; expAdd.note = $("#exn").value; renderReports(); });
  const n = $("#exn"); if (n) n.oninput = () => expAdd.note = n.value;
  const cx = $("#excancel"); if (cx) cx.onclick = () => { expAdd = null; renderReports(); };
  const sv = $("#exsave"); if (sv) sv.onclick = async () => {
    const amt = num($("#exa").value), note = tidy($("#exn").value).slice(0, 120), day = ymd(periodRange("day", expK).s);
    if (!amt) { toast("Type the amount spent"); return; }
    if (!expAdd.kind) { toast("Choose what it was for"); return; }
    expAdd.busy = true; renderReports();
    const { data, error } = await sb.from("expenses").insert({ amount: amt, kind: expAdd.kind, note: note || null, spent_on: day, created_by: (me && me.name) || null }).select("id,amount,kind,note,spent_on,created_by,created_at").single();
    if (error) { expAdd.busy = false; toast(failMsg(error)); renderReports(); return; }
    expenses.push(data); expAdd = null; toast(`Expense of ${naira(amt)} recorded`); renderReports();
  };
  view.querySelectorAll("[data-exdel]").forEach(b => b.onclick = async () => {
    const x = expenses.find(e => e.id === b.dataset.exdel); if (!x) return;
    if (!await askConfirm(`Delete this expense?`, `${esc(expKind(x.kind))}, ${naira(x.amount)}${x.note ? ` (${esc(x.note)})` : ""}.`, "Yes, delete it")) return;
    const { error } = await sb.from("expenses").delete().eq("id", x.id);
    if (error) { toast(failMsg(error)); return; }
    expenses = expenses.filter(e => e !== x); toast("Expense deleted"); renderReports();
  });
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
const SET_TABS = [["business", "Business"], ["invoice", "Invoice"], ["plan", "Plan & billing"], ["prices", "Price list"], ["staff", "Staff"], ["branches", "Branches"], ["account", "My account"]];
const card = (title, sub, body) => `<section class="scard"><h3 class="stitle">${title}</h3>${sub ? `<p class="hint" style="margin-top:-4px">${sub}</p>` : ""}${body}</section>`;
const shortSvc = { wi: "Wash & iron", wo: "Wash", io: "Iron", wsi: "Wash & starch", si: "Starch & iron" };
function renderSettings() {
  if (!own()) setTab = "account";
  const meLine = `<p class="who-me">Signed in as <b>${esc(me.name)}</b> (${own() ? "owner" : "staff"}) · ${fmtPhone(me.phone)}</p>`;
  const tabsList = isAdmin ? SET_TABS.concat([["shops", "Tagbook shops"]]) : SET_TABS;
  const nav = own() ? `<nav class="stabs" aria-label="Settings sections">${tabsList.map(([k, l]) => `<button data-st="${k}" aria-current="${setTab === k ? "page" : "false"}">${l}</button>`).join("")}</nav>` : "";
  let body = "";
  if (setTab === "account") body = (!own() && shop.staff_prices ? staffPriceHtml() : "") + (own() ? card("Notifications", "Your phone buzzes when staff log clothes or mark them ready, even when Tagbook is closed.", `<div id="pushbox"><p class="hint">Checking…</p></div>`)
      : newOpts() ? card("Notifications", "Get a reminder when clothes are due tomorrow, due today or late, even when Tagbook is closed.", `<div id="pushbox"><p class="hint">Checking…</p></div>`) : "") + card("Change my PIN", "You'll use the new PIN next time you log in.",
      `<label for="np">New 6-digit PIN</label><input id="np" class="pin" ${pinAttrs}><button class="btn btn-ghost" id="npb">Save new PIN</button>`)
    + `<button class="logout" id="out"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>Log out</button>`;
  if (setTab === "business") { const p = sPriv(); body =
    card("Business name", "Shown at the top of the app and in every WhatsApp message.",
      `<input id="sn" maxlength="${NAME_MAX}" value="${esc(shop.name)}" autocomplete="off" aria-label="Business name">`)
    + card("Bank account for payments", "Added to every invoice and payment reminder, so customers know where to pay.",
      `<label for="bn">Bank name</label><input id="bn" list="banks-shop" value="${esc(p.bank_name)}" placeholder="Start typing, e.g. GTBank or Opay" autocomplete="off">${bankList("banks-shop")}
       <label for="an">Account number</label><input id="an" ${moneyAttrs} maxlength="10" value="${esc(p.acct_no)}">
       <p class="hint" id="anx">${p.acct_no.length === 10 ? "" : "Account number must be 10 digits."}</p>
       <label for="am">Account name</label><input id="am" value="${esc(p.acct_name)}" autocomplete="off">`)
    + card("Express delivery charge", "Added to the bill when an order is marked express delivery.",
      `<div class="chips" style="margin:0 0 4px"><button class="chip" data-et="manual" aria-pressed="${p.express_type === "manual"}">Type it each time</button><button class="chip" data-et="percent" aria-pressed="${p.express_type === "percent"}">Percentage extra</button><button class="chip" data-et="times" aria-pressed="${p.express_type === "times"}">Times the bill (2×)</button><button class="chip" data-et="fixed" aria-pressed="${p.express_type === "fixed"}">Fixed amount</button></div>
       ${p.express_type === "manual" ? `<p class="hint">You type the express amount on each order's bill, depending on the job.</p>` : `<label for="ev">${p.express_type === "percent" ? "Extra percentage (%)" : p.express_type === "times" ? "Multiply the bill by" : "Extra amount per order (₦)"}</label>
       <input id="ev" ${moneyAttrs} value="${p.express_value}"><p class="hint" id="evx">${exampleExpress()}</p>`}`)
    + (!newOpts() ? "" : card("Order options", "Extra choices when logging clothes. Turn on only what your shop uses.",
      `<label class="toggle"><span>Collection date and time<small>Ask when the customer will come back for their clothes. It goes in their list of clothes.</small></span><input type="checkbox" id="oc" ${shop.collect_dates ? "checked" : ""}></label>
       <label class="toggle"><span>Wait &amp; get<small>For customers who wait at the shop. Logging then shows Standard, Express or Wait &amp; get.</small></span><input type="checkbox" id="ow" ${shop.wait_get_on ? "checked" : ""}></label>`))
    + (!newOpts() || !shop.wait_get_on ? "" : card("Wait & get charge", "Added to the bill when a customer waits for their clothes.",
      `<div class="chips" style="margin:0 0 4px">${[["manual", "Type it each time"], ["percent", "Percentage extra"], ["times", "Times the bill (2×)"], ["fixed", "Fixed amount"]].map(([k, l]) => `<button class="chip" data-wt="${k}" aria-pressed="${p.wait_type === k}">${l}</button>`).join("")}</div>
       ${p.wait_type === "manual" ? `<p class="hint">You type the Wait &amp; get amount on each order's bill.</p>` : `<label for="wv">${p.wait_type === "percent" ? "Extra percentage (%)" : p.wait_type === "times" ? "Multiply the bill by" : "Extra amount per order (₦)"}</label>
       <input id="wv" ${moneyAttrs} value="${p.wait_value}"><p class="hint" id="wvx">${exampleWait()}</p>`}`)); }
  if (setTab === "branches") body = card("Branches", "Where customers drop clothes. With one branch, the app doesn't ask.",
      `${liveBranches().map(b => `<div class="row srow"><input data-bn="${b.id}" value="${esc(b.name)}" autocomplete="off" aria-label="Branch name">${liveBranches().length > 1 ? `<button class="mini danger" data-brm="${b.id}">Remove</button>` : ""}</div>`).join("")}
       <div class="row srow"><input id="nb" placeholder="New branch name" autocomplete="off" aria-label="New branch name"><button class="mini" id="nbb">Add</button></div>`);
  if (setTab === "staff") body = card("Staff logins", `Staff log clothes and check them before bagging. They never see bills, payments or customer numbers${shop.staff_prices ? ", but they can see your price list to answer customers" : ""}${billLive() ? ", unless you let them send bills" : ""}.`,
      staffList.map(s => `<div class="staff-row"><div><b>${esc(s.name)}${s.user_id === me.user_id ? " (you)" : ""}</b><span>${s.role === "owner" ? "Owner" : s.can_bill && billLive() ? "Staff · sends bills" : "Staff"} · ${fmtPhone(s.phone)}</span></div>
        ${s.user_id === me.user_id ? "" : `<div class="acts"><button class="mini" data-rp="${s.user_id}">New PIN</button><button class="mini danger" data-srm="${s.user_id}">Remove</button></div>`}</div>
        ${s.role !== "owner" && billLive() ? `<label class="ck sbill"><input type="checkbox" data-cb="${s.user_id}" ${s.can_bill ? "checked" : ""}><span><b>Can send lists and bills, and take payments</b><small>For a front desk or cashier using the shop's WhatsApp. They see bills, payments and customer numbers, but can't give discounts, change prices or see your reports.</small></span></label>` : ""}
        ${resetFor === s.user_id ? `<div class="row srow"><input id="rpi" class="pin" ${pinAttrs} placeholder="6 digits" aria-label="New PIN for ${esc(s.name)}"><button class="mini" id="rpb">Save</button></div>` : ""}`).join(""))
    + crewCard()
    + (newStaff ? card(`Send ${esc(newStaff.name.split(" ")[0])} their login`, "They need this to open Tagbook on their phone.",
      `<div class="wa">${esc(newStaff.msg)}</div>
       <a class="btn btn-primary" id="nsfwa" target="_blank" rel="noopener" href="${waLink(newStaff.phone, newStaff.msg)}">Send on WhatsApp</a>
       <div class="row"><button class="btn btn-ghost" id="nsfcopy">Copy message</button><button class="btn btn-ghost" id="nsfdone">Done</button></div>`)
    : card("Add a staff login", "After adding, you can send them their login on WhatsApp. They can change their PIN in their own Settings.",
      `<div class="sgrid"><div><label for="sfn">Name</label><input id="sfn" autocomplete="off"></div>
       <div><label for="sfp">Phone number</label><input id="sfp" type="text" inputmode="tel" autocomplete="off"></div>
       <div><label for="sfk">6-digit PIN for them</label><input id="sfk" class="pin" ${genPinAttrs()}></div></div>
       <button class="btn btn-primary" id="sfa">Add staff login</button>`))
    + card("Price list for staff", "Lets staff see your prices so they can answer customers who ask. They can't change prices or see any bill.",
      `<div class="chips" style="margin:0"><button class="chip" data-sp="1" aria-pressed="${!!shop.staff_prices}">Staff can see prices</button><button class="chip" data-sp="0" aria-pressed="${!shop.staff_prices}">Hide prices from staff</button></div>`);
  if (setTab === "invoice") body = invoiceSettingsHtml();
  if (setTab === "prices") body = priceListHtml();
  if (setTab === "plan" && own()) body = planHtml();
  if (setTab === "shops" && isAdmin) body = shopsHtml();
  view.innerHTML = `${backBtn("Orders")}<h2 class="ptitle">Settings</h2>${meLine}<div class="${own() ? "slayout" : ""}">${nav}<div class="sbody">${body}</div></div><p class="foot">Tagbook by Ordiventa · version ${String(window.TB_BUILD || "").slice(4, 12)} · <a href="/privacy">Privacy policy</a></p>`;
  wireBack(view);
  view.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { setTab = b.dataset.st; if (setTab === "plan") loadPlan().then(() => { if (tab === "prices" && setTab === "plan") renderSettings(); }); priceOpen = null; resetFor = null; addOpen = false; renderSettings(); });
  if (setTab === "account") wireAccount();
  if (setTab === "business") wireBusiness();
  if (setTab === "invoice") wireInvoice();
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
    on: `<p class="pushon">On for this ${device()}</p><button class="btn btn-ghost" id="pushoff">Turn off on this ${device()}</button>`,
    off: `<button class="btn btn-primary" id="pushgo">Turn on notifications</button>`,
    blocked: `<p class="hint">Notifications are blocked for Tagbook on this ${device()}. Allow them in your ${isPhone() ? "phone's" : "browser's"} settings (Site settings → Notifications), then come back here.</p>`,
    "ios-install": `<p class="hint">On iPhone: tap Share (or ⋯ then Share), then “Add to Home Screen”. Open Tagbook from the Home Screen and turn notifications on here.</p>`,
    unsupported: `<p class="hint">This browser can't show notifications. Use Chrome on your phone.</p>`,
  }[st];
  if (!$("#pushbox")) return;
  box.innerHTML = html;
  if ($("#pushgo")) $("#pushgo").onclick = async () => { $("#pushgo").disabled = true; await enablePush(); drawPushBox(); };
  if ($("#pushoff")) $("#pushoff").onclick = async () => { await disablePush(); toast(`Notifications off for this ${device()}`); drawPushBox(); };
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
  $("#out").onclick = async () => { if (!$("#out").dataset.sure) { $("#out").dataset.sure = "1"; $("#out").textContent = "Tap again to log out"; return; } try { await forgetPushHere(); } catch (_) { } await sb.auth.signOut(); location.hash = ""; location.reload(); };
}
function wireBusiness() {
  [["#oc", "collect_dates"], ["#ow", "wait_get_on"]].forEach(([id, k]) => { const el = $(id); if (el) el.onchange = async e => { const v = e.target.checked; shop[k] = v; savedToast(await put("shops", { id: shop.id }, { [k]: v })); markSetup("options"); if (k === "wait_get_on") renderSettings(); }; });
  view.querySelectorAll("[data-wt]").forEach(b => b.onclick = async () => { const t = b.dataset.wt; await savePriv({ wait_type: t, wait_value: t === "percent" ? 50 : t === "times" ? 2 : t === "fixed" ? 1000 : 0 }); renderSettings(); });
  if ($("#wv")) { moneyInput($("#wv"), v => { const t = priv.wait_type; priv.wait_value = t === "percent" ? Math.min(v, 300) : t === "times" ? Math.min(Math.max(v, 1), 5) : v; $("#wvx").textContent = exampleWait(); });
    $("#wv").onchange = () => savePriv({ wait_value: priv.wait_value }); }
  const p = sPriv();
  $("#sn").onchange = async e => { const v = tidy(e.target.value).slice(0, NAME_MAX); if (!v) { e.target.value = shop.name; return; } shop.name = v; $("#shopname").textContent = shopName(); savedToast(await put("shops", { id: shop.id }, { name: v })); };
  const savePriv = async fields => { Object.assign(priv, fields); savedToast(await put("shop_private", { shop_id: shop.id }, fields)); };
  $("#bn").onchange = e => savePriv({ bank_name: e.target.value.trim().slice(0, 40) });
  $("#am").onchange = e => savePriv({ acct_name: e.target.value.trim().slice(0, 60) });
  moneyInput($("#an"), () => { const el = $("#an"); if (el.value.length > 10) el.value = el.value.slice(0, 10); $("#anx").textContent = el.value.length === 10 ? "" : "Account number must be 10 digits."; });
  $("#an").onchange = e => savePriv({ acct_no: e.target.value });
  view.querySelectorAll("[data-et]").forEach(b => b.onclick = async () => { markSetup("options"); await savePriv({ express_type: b.dataset.et, express_value: b.dataset.et === "percent" ? 50 : b.dataset.et === "times" ? 2 : b.dataset.et === "fixed" ? 1000 : 0 }); renderSettings(); });
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
  wireCrew();
  view.querySelectorAll("[data-cb]").forEach(b => b.onchange = async () => {
    const on = b.checked, who = staffList.find(x => x.user_id === b.dataset.cb); b.disabled = true;
    const { error } = await sb.rpc("set_staff_can_bill", { p_user: b.dataset.cb, p_on: on });
    if (error) { toast(failMsg(error)); b.checked = !on; b.disabled = false; return; }
    if (who) who.can_bill = on;
    toast(on ? `${who ? who.name.split(" ")[0] : "They"} can now send lists and bills. They see it next time they open Tagbook.` : `${who ? who.name.split(" ")[0] : "They"} can no longer send bills.`);
    renderSettings();
  });
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
    <p class="ssub">You're paid when a shop you worked on pays for Tagbook. Helper (demo and setup): ₦1,500 when the shop first pays, ₦1,500 more from day 30 if it's still logging orders. Agent (found the shop): ₦3,000 once the shop has paid ₦6,000, plus ₦500 for each paid month, up to 12. Caller (a shop from our list you called): ₦1,500 once the shop has paid ₦6,000, plus a ₦2,000 bonus for every 5 called shops that become paying shops. Pay from a shop never goes above half of what that shop has paid; anything above that waits until it pays more.</p>
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
    <label for="bk-n">Account number</label><input id="bk-n" type="text" inputmode="numeric" maxlength="10" autocomplete="off" value="${esc(b ? b.no : "")}">
    <label for="bk-a">Account name</label><input id="bk-a" autocomplete="off" value="${esc(b ? b.name : "")}">
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
/* ---------- Call shops (team members Bolu allows to call leads; they call only, Bolu follows up on WhatsApp) ---------- */
let teamGoal = null, teamGoalAt = 0;
function teamGoalHtml() {
  if (Date.now() - teamGoalAt > 5 * 6e4) { teamGoalAt = Date.now(); sb.rpc("goal_progress").then(({ data, error }) => { if (!error && data && JSON.stringify(data) !== JSON.stringify(teamGoal)) { teamGoal = data; if (tab === "agent") keepTyped(renderAgent); else if (tab === "admin" && adminView === "shops") keepTyped(renderAdmin); } }); }
  return teamGoal ? goalHtml(teamGoal) : "";
}
let isCaller = false, agentView = "shops", cLog = null, cOut = "called", cNote = "", cBusy = false;
async function loadCallerLeads() {
  if (oleadBusy) return; oleadBusy = true;
  try {
    let rows = [];
    for (let from = 0; ; from += 1000) { const r = await sb.rpc("caller_leads", { p_from: from }); if (r.error) break; rows = rows.concat(r.data || []); if (!r.data || r.data.length < 1000) break; }
    olead = smallFirst(rows);
  } finally { oleadBusy = false; }
  if (tab === "agent" && agentView === "calls") keepTyped(renderAgent);
}
const agentSeg = () => isCaller ? `<div class="aseg" style="margin-bottom:12px"><button data-agv="shops" aria-pressed="${agentView === "shops"}">Set up shops</button><button data-agv="calls" aria-pressed="${agentView === "calls"}">Call shops</button></div>` : "";
const wireAgentSeg = () => view.querySelectorAll("[data-agv]").forEach(b => b.onclick = () => { agentView = b.dataset.agv; renderAgent(); });
const C_OUT = [["called", "Interested"], ["nopick", "Didn't pick up"], ["unreachable", "Not reachable"], ["no", "Not interested"]];
function renderCalls() {
  if (olead === null) { loadCallerLeads(); view.innerHTML = `${agentSeg()}<p class="hint">Loading leads…</p>`; wireAgentSeg(); return; }
  const who = ((me && me.name) || "").split(" ")[0] || "me";
  const cityOrder = ["Akure"].concat(ONDO_NEAR, ["Ado Ekiti", "Osogbo", "Ile-Ife", "Ibadan", "Ilorin", "Abeokuta", "Lagos", "Benin City", "Abuja", "Port Harcourt"]);
  const cities = [...new Set(olead.map(l => l.city))].sort((a, b) => (cityOrder.indexOf(a) + 1 || 99) - (cityOrder.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const inCity = olead.filter(l => oCity === "all" || l.city === oCity), q = oQ.trim().toLowerCase();
  const st = ["new", "nopick", "unreachable", "called", "all"].includes(oStatus) ? oStatus : "new";
  const list = inCity.filter(l => (st === "all" || l.status === st) && (!q || (l.name + " " + (l.area || "") + " " + (l.phone || "")).toLowerCase().includes(q)));
  const byMe = l => (l.called_by || "").split(" ")[0].toLowerCase() === who.toLowerCase();
  const mine = olead.filter(l => byMe(l) && l.called_at && lagosDay(l.called_at) === lagosDay(Date.now())).length;
  const row = l => `<section class="olead${l.status === "no" ? " is-no" : ""}">
      <div class="ohead"><div><b>${esc(l.name)}</b><span>${esc([l.area, l.city].filter(Boolean).join(", "))}${l.phone ? ` · ${fmtPhone(l.phone)}` : ""}</span></div><span class="pill ${O_PILL[l.status]}">${l.status === "called" ? "Interested" : l.status === "new" ? "To call" : O_STATUS[l.status]}</span></div>
      ${l.notes ? `<p class="onote">${esc(l.notes)}</p>` : ""}
      ${cLog === l.id ? `<div class="clog"><label style="margin-top:4px">What happened?</label><div class="chips rpick" style="margin:0">${C_OUT.map(([k, v]) => `<button class="chip" data-cout="${k}" aria-pressed="${cOut === k}">${v}</button>`).join("")}</div>
        <label for="cnote">What did they say? <span class="opt">${cOut === "called" ? "(Bolu reads this before messaging them)" : "(optional)"}</span></label>
        <textarea id="cnote" rows="3" maxlength="300" placeholder="${cOut === "called" ? "e.g. Owner is Mrs Ade. Uses a book. Wants the video. Best time is evening." : cOut === "no" ? "e.g. Already uses another app" : "e.g. Call again after 4pm"}">${esc(cNote)}</textarea>
        <div class="row"><button class="btn btn-ghost" data-cno>Cancel</button><button class="btn btn-primary" data-cgo="${l.id}" ${cBusy ? "disabled" : ""}>Save</button></div></div>`
      : `<div class="oact">${l.phone && l.status !== "no" ? `<a class="btn btn-primary ocall" data-call="${l.id}" href="tel:${l.phone}">Call</a>` : `<span class="hint">No phone</span>`}<button class="btn btn-ghost" data-clog="${l.id}">Log call</button></div>`}
    </section>`;
  view.innerHTML = `${agentSeg()}
    <div class="dtop"><div><h2 class="ptitle">Call shops</h2><p class="hint">Call, then log what happened. When a shop is interested, Bolu gets your note and sends them the video on WhatsApp.</p></div></div>
    ${teamGoalHtml()}
    ${(() => { const wk = Date.parse(new Date(Date.UTC(new Date(Date.now() + 3600e3).getUTCFullYear(), new Date(Date.now() + 3600e3).getUTCMonth(), new Date(Date.now() + 3600e3).getUTCDate() - ((new Date(Date.now() + 3600e3).getUTCDay() + 6) % 7))).toISOString()) - 3600e3;
      const n = olead.filter(l => l.status === "called" && byMe(l) && l.called_at && Date.parse(l.called_at) >= wk).length;
      return `<section class="scard gweek"><div class="gtop"><span>Your week: interested shops from your calls</span><b>${n} <i>of ${WEEK_CALLS}</i></b></div><div class="gbar"><span style="width:${Math.min(100, Math.round(n / WEEK_CALLS * 100))}%"></span></div><p class="hint" style="margin:6px 0 0">About half of interested shops sign up, so ${WEEK_CALLS} interested a week is your 4 new shops.</p></section>`; })()}
    <div class="stats lstats"><div class="stat"><b>${olead.filter(l => l.status === "new").length}</b><span>Left to call</span></div><div class="stat"><b>${mine}</b><span>You called today</span></div><div class="stat"><b>${olead.filter(l => l.status === "called" && byMe(l)).length}</b><span>Interested from you</span></div></div>
    ${callScriptHtml(who, true)}
    <div class="chips ochips">${[["all", "All", olead.length]].concat(cities.map(c => [c, c, olead.filter(l => l.city === c).length])).map(([k, v, n]) => `<button class="chip" data-oc="${esc(k)}" aria-pressed="${oCity === k}">${esc(v)} <span class="n">${n}</span></button>`).join("")}</div>
    <div class="chips ochips">${[["new", "To call"], ["nopick", "Didn't pick up"], ["unreachable", "Not reachable"], ["called", "Interested"], ["all", "All"]].map(([k, v]) => `<button class="chip" data-os="${k}" aria-pressed="${st === k}">${v} <span class="n">${k === "all" ? inCity.length : inCity.filter(l => l.status === k).length}</span></button>`).join("")}</div>
    <input id="oq" class="search" placeholder="Search name, area or phone" value="${esc(oQ)}" autocomplete="off">
    <div class="dlist">${bySize(list.slice(0, 40), row) || `<p class="hint">No shops here.</p>`}${list.length > 40 ? `<p class="hint">Showing 40 of ${list.length}. Search or pick a city to see others.</p>` : ""}</div>`;
  wireAgentSeg();
  $("#oscript").onclick = () => { oScriptOpen = !oScriptOpen; try { localStorage.setItem("tb-script-open", oScriptOpen ? "1" : "0"); } catch (_) { } renderAgent(); };
  view.querySelectorAll("[data-oc]").forEach(b => b.onclick = () => { oCity = b.dataset.oc; renderAgent(); });
  view.querySelectorAll("[data-os]").forEach(b => b.onclick = () => { oStatus = b.dataset.os; renderAgent(); });
  $("#oq").oninput = e => { oQ = e.target.value; const p = e.target.selectionStart; renderAgent(); const n = $("#oq"); n.focus(); try { n.setSelectionRange(p, p); } catch (_) { } };
  view.querySelectorAll("[data-call]").forEach(a => a.onclick = () => { oCall = a.dataset.call; oScriptOpen = true; cLog = a.dataset.call; cOut = "called"; cNote = ""; setTimeout(() => renderAgent(), 300); });
  view.querySelectorAll("[data-clog]").forEach(b => b.onclick = () => { cLog = b.dataset.clog; cOut = "called"; cNote = ""; renderAgent(); });
  view.querySelectorAll("[data-cout]").forEach(b => b.onclick = () => { cNote = ($("#cnote") || {}).value || cNote; cOut = b.dataset.cout; renderAgent(); });
  const cn = $("#cnote"); if (cn) cn.oninput = e => { cNote = e.target.value; };
  view.querySelectorAll("[data-cno]").forEach(b => b.onclick = () => { cLog = null; renderAgent(); });
  view.querySelectorAll("[data-cgo]").forEach(b => b.onclick = async () => {
    const l = olead.find(x => x.id === b.dataset.cgo); if (!l) return;
    const note = tidy(cNote);
    if (cOut === "called" && !note) { toast("Write what they said, so Bolu knows how to follow up"); $("#cnote").focus(); return; }
    cBusy = true; renderAgent();
    const { error } = await sb.rpc("caller_log_call", { p_lead: l.id, p_status: cOut, p_note: note || null });
    cBusy = false;
    if (error) { toast("Couldn't save. Check your internet."); return renderAgent(); }
    l.status = cOut; l.called_by = who; l.called_at = new Date().toISOString();
    if (note) l.notes = (l.notes ? l.notes + "\n" : "") + `${who}: ${note}`;
    cLog = null; oCall = null; toast(cOut === "called" ? "Saved. Bolu has been told." : "Saved"); renderAgent();
  });
}
function renderAgent() {
  if (!isAgent) return go("orders");
  if (isCaller && agentView === "calls") return renderCalls();
  if (!myEarnBusy) { myEarnBusy = true; sb.rpc("my_earnings").then(({ data, error }) => { myEarnBusy = false; if (!error && data && JSON.stringify(data) !== JSON.stringify(myEarn)) { myEarn = data; if (tab === "agent") keepTyped(renderAgent); } }).catch(() => { myEarnBusy = false; }); }
  view.innerHTML = `${agentSeg()}${teamGoalHtml()}<h2 class="ptitle">Set up shops</h2>${earningsHtml()}<p class="hint" style="margin-top:0">Shops you set up appear below. The free trial is 1 month.</p>` + shopsHtml(); wireShops(); wireBank(); wireAgentSeg();
}
const isoDay = d => d.toISOString().slice(0, 10);
function shopsHtml() {
  const trial = (() => { const x = new Date(); x.setMonth(x.getMonth() + 1); return isoDay(x); })();
  const done = newShop ? card("Shop created", "Send the owner their login. Tell them the PIN in person if you can.",
      `<div class="wa" id="nsmsg">${esc(newShop.msg)}</div>
       <a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234${newShop.phone.slice(1)}?text=${encodeURIComponent(newShop.msg)}">Send on WhatsApp</a>
       <div class="row"><button class="btn btn-ghost" id="nscopy">Copy</button><button class="btn btn-ghost" id="nsagain">Add another shop</button></div>`) : "";
  const form = newShop ? "" : card("Add a shop", "Creates the shop with the standard price list. The owner can change prices, add branches and staff in their own Settings.",
      `<label for="as-n">Shop name</label><input id="as-n" autocomplete="off" maxlength="${NAME_MAX}"><p class="hint">Up to ${NAME_MAX} letters. It shows at the top of their app and on every bill, so shorter reads better ("&amp;" instead of "and", no "services").</p>
       <div class="sgrid"><div><label for="as-st">State</label><select id="as-st">${stateOpts("")}</select></div>
       <div><label for="as-tw">Town or area</label><input id="as-tw" maxlength="60" autocomplete="off"></div></div>
       <label for="as-b">Branches</label><input id="as-b" placeholder="Main branch" autocomplete="off"><p class="hint">Separate with commas, e.g. Main branch, Awule point, Oke-Ijebu point.</p>
       <div class="sgrid"><div><label for="as-on">Owner's name</label><input id="as-on" autocomplete="off" maxlength="40"></div>
       <div><label for="as-op">Owner's phone</label><input id="as-op" type="text" inputmode="tel" autocomplete="off"></div>
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
    const state = $("#as-st").value, town = tidy($("#as-tw").value);
    const err = !shopName ? "Type the shop name." : shopName.length > NAME_MAX ? `Shop name is too long. Keep it to ${NAME_MAX} letters.` : !state ? "Choose the shop's state." : !town ? "Type the shop's town or area." : !owner ? "Type the owner's name." : !/^0\d{10}$/.test(phone) ? "The owner's phone must be 11 digits and start with 0." : pin.length !== 6 ? "The PIN must be 6 digits." : "";
    if (err) { toast(err); return; }
    $("#as-go").disabled = true; $("#as-go").textContent = "Creating…";
    const r = await callAdmin({ action: "create_shop", shop: shopName, state, area: town, branches, owner: { name: owner, phone, pin }, trial_ends: $("#as-t") ? $("#as-t").value || null : null, start_no: num($("#as-no").value) || 1, founding: $("#as-f") ? $("#as-f").checked : true, referred_by: $("#as-r").value || null,
      ...(agentMode() ? (v => v === "ordiventa" || v === "self" ? { claim_kind: v } : { claim_kind: "team", claim_for: v })($("#as-cf").value) : { brought_by: $("#as-ab").value || null, setup_by: $("#as-as").value || null }) });
    if (!r.ok) { toast(r.msg); $("#as-go").disabled = false; $("#as-go").textContent = "Create shop"; return; }
    const installVid = ((tuts || []).find(t => t.step_key === "install") || {}).youtube_id || "chuV8thnvrE";
    newShop = { phone, msg: `Your Tagbook is ready, ${owner.split(" ")[0]}.\n\nOpen this link on your phone: tagbook.ordiventa.com\nPhone: ${phone}\nPIN: ${pin}\n\nPut Tagbook on your phone so it opens like an app:\n\n*Android:* open the link in Chrome, tap the 3 dots (⋮) at the top right, then tap \"Install app\" or \"Add to Home screen\".\n\n*iPhone:* watch this short video: https://youtu.be/${installVid}\n\nYou can change your PIN in Settings.\n\nOnce you log in, tap \"+ Log clothes\" and add your next customer. We can call you to walk you through the first one, just tell us when you're ready.\n\nIf you get stuck, just message us here.\n\nWelcome, and thank you for starting with us.` };
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
      ${teamLive() ? `<div class="pgrid"><div><label for="pc-${x.id}">Pieces in one</label><input id="pc-${x.id}" data-ppc="${x.id}" inputmode="numeric" maxlength="2" value="${x.pieces || 1}"></div></div>` : ""}
      <div class="row" style="margin-top:10px"><button class="mini danger" data-prm="${x.id}">Remove item</button><button class="mini" data-pclose>Done</button></div></div>`;
  const summary = x => (Object.keys(SERVICES).filter(k => x.p[k] != null).map(k => `${shortSvc[k]} ${naira(x.p[k])}`).join(" · ") || "No prices yet") + (teamLive() && x.pieces > 1 ? ` · ${x.pieces} pieces` : "");
  const rows = wide.matches
    ? `<div class="ptable" role="table" style="--nsvc:${Object.keys(SERVICES).length};--pcol:${teamLive() ? "48px" : "0px"}"><div class="ph" role="row"><span>Item</span>${Object.values(SERVICES).map(l => `<span>${l}</span>`).join("")}${teamLive() ? "<span>Pieces</span>" : "<span></span>"}<span></span></div>
        ${list.map(x => `<div class="pr" role="row"><input data-pn="${x.id}" value="${esc(x.name)}" autocomplete="off" aria-label="Item name">${Object.keys(SERVICES).map(k => cell(x, k)).join("")}${teamLive() ? `<input data-ppc="${x.id}" inputmode="numeric" maxlength="2" value="${x.pieces || 1}" aria-label="Pieces in one ${esc(x.name)}">` : "<span></span>"}<button class="plink" data-prm="${x.id}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join("")}</div>`
    : `<div class="plist">${list.map(x => priceOpen === x.id ? `<div class="pli open">${editor(x)}</div>`
        : `<button class="pli" data-popen="${x.id}"><b>${esc(x.name)}</b><span>${summary(x)}</span></button>`).join("")}</div>`;
  const guide = own() && !setupState().prices ? `<div class="pguide"><b>Your prices aren't set yet.</b> Tap each item and type what your shop charges. The step ticks by itself once you save a price.<br>Have your price list on paper? <a href="https://wa.me/2348120756325?text=${encodeURIComponent("Hello, here is my price list for Tagbook")}" target="_blank" rel="noopener">Send us a photo on WhatsApp</a> and we'll put it in for you.</div>` : "";
  return guide + card("Price list", `${all.length} item${all.length === 1 ? "" : "s"}. ${wide.matches ? "Click any name or price to change it." : "Tap an item to change it."} Leave a price empty if you don't offer that service. Saved bills keep their prices.`,
      `${all.length > 8 ? `<input class="search" id="pq" placeholder="Search items" value="${esc(priceQ)}" aria-label="Search items" style="margin:4px 0 10px">` : ""}
       ${list.length ? rows : `<p class="hint">No item matches “${esc(priceQ)}”.</p>`}`)
    + (!addOpen ? `<button class="btn btn-ghost" id="addopen">+ Add an item</button><p class="hint">Special items, like a wedding gown, get their price when you make the bill.</p>`
    : card("Add an item", "Special items, like a wedding gown, get their price when you make the bill.",
      `<label for="ni">Item name</label><input id="ni" placeholder="e.g. Curtain (per panel)" autocomplete="off">
       <div class="pgrid">${Object.entries(SERVICES).map(([k, l]) => `<div><label for="na-${k}">${l} (₦)</label><input id="na-${k}" data-na="${k}" ${moneyAttrs} placeholder="Not offered"></div>`).join("")}${teamLive() ? `<div><label for="npc">Pieces in one</label><input id="npc" inputmode="numeric" maxlength="2" value="1"></div>` : ""}</div>
       <div class="row"><button class="btn btn-ghost" id="addclose">Cancel</button><button class="btn btn-primary" id="nadd">Add to price list</button></div>`));
}
function wirePrices() {
  const savePrice = async x => {
    x.services = Object.keys(SERVICES).filter(k => x.p[k] != null);
    const a = await put("items", { id: x.id }, { name: x.name, services: x.services });
    const { error } = await sb.from("item_prices").upsert({ item_id: x.id, shop_id: shop.id, prices: x.p });
    if (error) { toast(failMsg(error)); refresh(); return; }
    savedToast(a);
    if (a && !setupState().prices) { await markSetup("prices"); toast("Price saved. Change any other price that's different in your shop."); }
  };
  const pq = $("#pq"); if (pq) pq.oninput = e => { priceQ = e.target.value; const p = e.target.selectionStart; renderSettings(); const n = $("#pq"); n.focus(); n.setSelectionRange(p, p); };
  view.querySelectorAll("[data-popen]").forEach(b => b.onclick = () => { priceOpen = b.dataset.popen; renderSettings(); });
  view.querySelectorAll("[data-pclose]").forEach(b => b.onclick = () => { priceOpen = null; renderSettings(); });
  view.querySelectorAll("[data-pn]").forEach(i => i.onchange = () => { const x = item(i.dataset.pn); const v = i.value.trim().slice(0, 40); if (!v) { i.value = x.name; return; } x.name = v; savePrice(x); });
  view.querySelectorAll("[data-pp]").forEach(i => { moneyInput(i, () => { }); i.onchange = () => { const x = item(i.dataset.pp); x.p = { ...x.p, [i.dataset.k]: i.value === "" ? null : num(i.value) }; savePrice(x); }; });
  view.querySelectorAll("[data-ppc]").forEach(i => {
    i.oninput = () => { const v = i.value.replace(/\D/g, ""); if (v !== i.value) i.value = v; };
    i.onchange = async () => { const x = item(i.dataset.ppc), n = Math.max(1, Math.min(50, parseInt(i.value, 10) || 1)); i.value = n; if (n === (x.pieces || 1)) return; x.pieces = n; savedToast(await put("items", { id: x.id }, { pieces: n })); };
  });
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
    const pcs = $("#npc") ? Math.max(1, Math.min(50, parseInt($("#npc").value, 10) || 1)) : 1;
    const { data, error } = await sb.from("items").insert({ shop_id: shop.id, name: n.slice(0, 40), services: Object.keys(pr).filter(k => pr[k] != null), sort, ...(pcs > 1 ? { pieces: pcs } : {}) }).select("id").single();
    if (error) { toast(failMsg(error)); $("#nadd").disabled = false; return; }
    const r2 = await sb.from("item_prices").insert({ item_id: data.id, shop_id: shop.id, prices: pr });
    if (r2.error) toast(failMsg(r2.error)); else { toast(`${n} added`); markSetup("prices"); }
    addOpen = false; await load(); renderSettings();
  };
}
function exampleWait() { const p = sPriv(); return `Example: a ${naira(5000)} Wait & get order costs ${naira(5000 + chargeFor(5000, p.wait_type, p.wait_value))}.`; }
function exampleExpress() { return `Example: a ${naira(5000)} order marked express delivery costs ${naira(5000 + expressFor(5000))}.`; }

/* ---------- Login: remembers who used this phone; number pad for phone and PIN ---------- */
const LAST_KEY = "tb-last";
const lastUser = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (_) { return null; } };
const saveLast = v => { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch (_) { } };
// The washing machine also shows in index.html before this script loads (build.sh inlines src/machine.svg)
const ART_MACHINE = MACHINE_SVG;
const loadingHtml = (msg) => `<div class="loading washing"><div class="lart big">${ART_MACHINE}</div><p>${msg}</p></div>`;
let L = null;
function confirmPin(st) {
  $("#app").classList.remove("is-loading"); $("#app").hidden = true; $("#tabsnav").hidden = true;
  L = { step: "pin", phone: st.phone, pin: "", err: "", busy: false, help: false, last: { name: st.name, phone: st.phone }, confirm: true };
  drawLogin();
}
function showLogin(msg) {
  me = null;
  if (wantsSignup()) { history.replaceState(null, "", "/"); return showSignup(); }
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = true; $("#tabsnav").hidden = true; $("#sheet").hidden = true; document.body.classList.remove("has-sheet");
  const last = lastUser();
  L = { step: last ? "pin" : "phone", phone: last ? last.phone : "", pin: "", err: msg || "", busy: false, help: false, last, choose: !last && !msg };
  drawLogin();
}
/* ---------- Self sign-up: a shop owner starts on their own (tagbook.ordiventa.com/start) ---------- */
// Optional Cloudflare bot check: paste the Turnstile site key here and add TURNSTILE_SECRET in Supabase.
const TURNSTILE_SITE = "";
let S = null; // sign-up form state
const NG_STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];
const stateOpts = cur => `<option value="">Choose a state</option>${NG_STATES.map(x => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("")}`;
const wantsSignup = () => /[?&]start\b/.test(location.search) || location.hash === "#start";
function showSignup() {
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = true; $("#tabsnav").hidden = true;
  L = L || { step: "phone", phone: "", pin: "", err: "", busy: false, help: false, last: null };
  S = { step: "form", shop: "", name: "", phone: "", area: "", state: "", pin: "", pin2: "", err: "", busy: false, t0: Date.now(), pinId: "", code: "", bot: "" };
  drawSignup();
}
const SIGN_ERR = {
  BAD_PHONE: "Type your 11-digit phone number, starting with 0.",
  MISSING_NAME: "Type your shop name and your name.",
  NAME_TOO_LONG: `Shop name is too long. Keep it to ${NAME_MAX} letters.`,
  BAD_PIN: "Your PIN must be 6 digits.",
  BAD_STATE: "Choose the state your shop is in.",
  MISSING_TOWN: "Type the town or area your shop is in.",
  TOO_FAST: "Please check your details, then tap Start again.",
  BOT_CHECK: "Please complete the check above, then try again.",
  TOO_MANY: "Too many sign-ups from this phone today. Message us on WhatsApp and we'll set you up.",
  BUSY: "Lots of shops are signing up today. Message us on WhatsApp and we'll set you up.",
  BAD_CODE: "That code isn't right, or it has expired. Check the text message, or send a new code.",
  CODE_FAILED: "We couldn't send the code. Check the number, or message us on WhatsApp.",
  NOT_VERIFIED: "We haven't got the code on WhatsApp yet. Tap \"Send code on WhatsApp\", send it from the WhatsApp on the number you typed, then tap the button again.",
};
function drawSignup() {
  const box = $("#login"); box.hidden = false;
  const f = (id, label, val, attrs, hint) => `<label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${attrs}>${hint ? `<p class="hint">${hint}</p>` : ""}`;
  const help = `https://wa.me/${TAGBOOK_LINE}?text=${encodeURIComponent("Hello Tagbook, I want to set up my laundry shop.")}`;
  box.innerHTML = `<div class="lwrap">
    <aside class="lside"><div class="lart">${ART_MACHINE}</div>
      <p class="lbrand">Tagbook</p><p class="ltag">Every cloth, accounted for.</p></aside>
    <main class="lmain lsign">
      ${S.step === "wa" ? `<h1 class="lname">Confirm your number on WhatsApp</h1>
        <p class="lask">Send this code to Tagbook from the WhatsApp on <b>${fmtPhone(S.phone)}</b>, so we know the number is yours.</p>
        <p class="wacode">${esc(S.waCode)}</p>
        <a class="btn btn-primary" id="swa" href="https://wa.me/${esc(S.waTo)}?text=${encodeURIComponent("Tagbook code " + S.waCode)}" target="_blank" rel="noopener">Send code on WhatsApp</a>
        <form class="lform" id="sform" novalidate>
          <p class="hint">WhatsApp opens with the code typed in. Tap send, then come back here.</p>
          <p class="lerr" role="alert">${S.err}</p>
          <button class="btn btn-ghost" id="sgo" ${S.busy ? "disabled" : ""}>${S.busy ? "Setting up your shop…" : "I've sent it. Finish sign-up"}</button>
        </form>
        <p class="lfoot"><button class="llink" id="sback">Change my details</button></p>`
      : S.step === "code" ? `<h1 class="lname">Check your text messages</h1>
        <p class="lask">We sent a 6-digit code to ${fmtPhone(S.phone)}.</p>
        <form class="lform" id="sform" novalidate>
          ${f("su-code", "Code", S.code, `inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="pin"`)}
          <p class="lerr" role="alert">${S.err}</p>
          <button class="btn btn-primary" id="sgo" ${S.busy ? "disabled" : ""}>${S.busy ? "Setting up your shop…" : "Start my free month"}</button>
        </form>
        <p class="lfoot"><button class="llink" id="sback">Change my details</button> · <button class="llink" id="sresend">Send a new code</button></p>`
      : `<h1 class="lname">Start your free month</h1>
        <p class="lask">Set up your laundry on Tagbook in 1 minute. No payment now.</p>
        <form class="lform" id="sform" novalidate>
          ${f("su-shop", "Shop name", S.shop, `maxlength="${NAME_MAX}" autocomplete="organization"`)}
          ${f("su-name", "Your name", S.name, `maxlength="40" autocomplete="name"`)}
          ${f("su-phone", "Your phone number", S.phone ? fmtPhone(S.phone) : "", `inputmode="tel" autocomplete="tel" maxlength="13"`, "You'll log in with this number.")}
          <label for="su-state">State</label><select id="su-state">${stateOpts(S.state)}</select>
          ${f("su-area", "Town or area", S.area, `maxlength="60"`)}
          <div class="sgrid">
            <div>${f("su-pin", "Choose a 6-digit PIN", S.pin, `type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" class="pin"`)}</div>
            <div>${f("su-pin2", "Type the PIN again", S.pin2, `type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" class="pin"`)}</div>
          </div>
          <input id="su-web" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
          ${TURNSTILE_SITE ? `<div id="sbot" class="sbot"></div>` : ""}
          <p class="lerr" role="alert">${S.err}</p>
          <button class="btn btn-primary" id="sgo" ${S.busy ? "disabled" : ""}>${S.busy ? "Setting up your shop…" : "Start my free month"}</button>
          <p class="hint">Free for 1 month, then ₦3,000 a month. Stop anytime.</p>
        </form>
        <p class="lfoot">Already have Tagbook? <button class="llink" id="sback">Log in</button></p>
        <p class="lfoot">Rather we set it up for you? <a class="llink" href="${help}" target="_blank" rel="noopener">Message us on WhatsApp</a></p>`}
      <p class="lpriv">By starting, you agree to our <a href="/privacy">Privacy policy</a>.</p><p class="lpriv lco">Tagbook is a product of Ordiventa Technologies Limited (RC 10010214), No. 4, Aule Housing Estate, Aule Street, Akure, Ondo State, Nigeria · WhatsApp +234 812 075 6325</p>
    </main></div>`;
  const keep = () => { if (S.step === "wa") return; if (S.step !== "form") { S.code = digits(($("#su-code") || {}).value || "").slice(0, 6); return; }
    S.shop = $("#su-shop").value; S.name = $("#su-name").value; S.phone = digits($("#su-phone").value); S.area = $("#su-area").value; S.state = $("#su-state").value;
    S.pin = digits($("#su-pin").value).slice(0, 6); S.pin2 = digits($("#su-pin2").value).slice(0, 6); };
  $("#sform").onsubmit = e => { e.preventDefault(); keep(); submitSignup(); };
  $("#sback").onclick = () => { keep(); if (S.step === "code" || S.step === "wa") { S.step = "form"; S.err = ""; S.checkId = ""; return drawSignup(); } S = null; showLogin(); L.choose = false; drawLogin(); };
  if ($("#sresend")) $("#sresend").onclick = () => { S.pinId = ""; S.code = ""; submitSignup(); };
  if (TURNSTILE_SITE && $("#sbot")) loadTurnstile().then(() => { try { window.turnstile.render("#sbot", { sitekey: TURNSTILE_SITE, callback: t => { S.bot = t; } }); } catch (_) { } });
  const first = S.step === "code" ? $("#su-code") : null; if (first) first.focus();
  if ($("#swa")) $("#swa").onclick = () => { S.waSent = true; };
}
// Back from WhatsApp after sending the code: try to finish straight away (once), so they don't have to tap again.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S && S.step === "wa" && S.waSent && !S.busy && !S.autoTried) { S.autoTried = true; setTimeout(() => { if (S && S.step === "wa" && !S.busy) submitSignup(); }, 2500); } });
let tsLoading = null;
const loadTurnstile = () => tsLoading || (tsLoading = new Promise(ok => { const sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); }));
async function signupCall(body) {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/admin`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); return r.ok ? d : { error: d.error || "TRY_LATER" };
  } catch (_) { return { error: "NETWORK" }; }
}
async function submitSignup() {
  const shopName = tidy(S.shop), name = tidy(S.name);
  const err = S.step === "wa" ? "" : S.step === "code" ? (S.code.length !== 6 ? "Type the 6-digit code from the text message." : "")
    : !shopName ? "Type your shop name." : shopName.length > NAME_MAX ? SIGN_ERR.NAME_TOO_LONG : !name ? "Type your name."
    : !/^0\d{10}$/.test(S.phone) ? SIGN_ERR.BAD_PHONE : !S.state ? SIGN_ERR.BAD_STATE : !tidy(S.area) ? SIGN_ERR.MISSING_TOWN : S.pin.length !== 6 ? "Choose a 6-digit PIN." : S.pin !== S.pin2 ? "The two PINs don't match. Type them again." : "";
  if (err) { S.err = esc(err); return drawSignup(); }
  S.err = ""; S.busy = true; drawSignup();
  const base = { phone: S.phone, website: ($("#su-web") || {}).value || "", bot_token: S.bot };
  // Text-message codes switch on from the server; until then the server answers CODES_OFF and we go straight on.
  if (S.step === "form") {
    const c = await signupCall({ action: "signup_code", ...base });
    if (c.pin_id) { S.pinId = c.pin_id; S.step = "code"; S.busy = false; return drawSignup(); }
    if (c.check_id) { S.checkId = c.check_id; S.waTo = c.wa_to; S.waCode = c.wa_code; S.waSent = false; S.autoTried = false; S.step = "wa"; S.busy = false; return drawSignup(); }
    if (c.error !== "CODES_OFF") return signupFailed(c.error);
  }
  const r = await signupCall({ action: "self_signup", ...base, shop: shopName, name, area: tidy(S.area), state: S.state, pin: S.pin, ms: Date.now() - S.t0, pin_id: S.pinId, code: S.code, check_id: S.checkId || "" });
  if (r.error) return signupFailed(r.error);
  // Created: log straight in and land on a welcome card that points at the first customer.
  try { sessionStorage.setItem("tb-welcome", "1"); } catch (_) { }
  const phone = S.phone, pin = S.pin; S = null;
  L = { step: "pin", phone, pin, err: "", busy: false, help: false, last: null };
  tryLogin();
}
function signupFailed(code) {
  S.busy = false;
  const help = `https://wa.me/${TAGBOOK_LINE}?text=${encodeURIComponent("Hello Tagbook, I want to set up my laundry shop.")}`;
  S.err = code === "PHONE_IN_USE" ? `This number already has a Tagbook account. <button class="llink" id="slogin">Log in instead</button>, or <a class="llink" href="${help}" target="_blank" rel="noopener">message us</a> if it isn't yours.`
    : code === "NETWORK" ? "Can't reach Tagbook. Check your internet and try again."
    : (code === "TOO_MANY" || code === "BUSY" || code === "CODE_FAILED") ? `${SIGN_ERR[code]} <a class="llink" href="${help}" target="_blank" rel="noopener">Open WhatsApp</a>`
    : esc(SIGN_ERR[code] || "Tagbook is busy. Try again in a minute.");
  if (code === "BAD_CODE" || code === "TOO_FAST") { /* stay on this step */ }
  drawSignup();
  if ($("#slogin")) $("#slogin").onclick = () => { const p = S.phone; S = null; L = { step: "pin", phone: p, pin: "", err: "", busy: false, help: false, last: null }; drawLogin(); };
}

function drawLogin() {
  const box = $("#login"); box.hidden = false;
  if (L.choose) {
    box.innerHTML = `<div class="lwrap">
      <aside class="lside"><div class="lart">${ART_MACHINE}</div>
        <p class="lbrand">Tagbook</p><p class="ltag">Every cloth, accounted for.</p></aside>
      <main class="lmain lchoose">
        <div class="lart small">${ART_MACHINE}</div>
        <h1 class="lname">Welcome to Tagbook</h1>
        <p class="lask">What would you like to do?</p>
        <button class="lpick" id="pick-in"><b>Log in</b><span>I already use Tagbook, as a shop owner or staff</span></button>
        <button class="lpick" id="pick-new"><b>Start a new shop</b><span>I own a laundry and want to try Tagbook free for 1 month</span></button>
        <p class="lpriv"><a href="/privacy">Privacy policy</a></p><p class="lpriv lco">Tagbook is a product of Ordiventa Technologies Limited (RC 10010214), No. 4, Aule Housing Estate, Aule Street, Akure, Ondo State, Nigeria · WhatsApp +234 812 075 6325</p>
      </main></div>`;
    $("#pick-in").onclick = () => { L.choose = false; drawLogin(); };
    $("#pick-new").onclick = () => { L.choose = false; showSignup(); };
    return;
  }
  if (L.step === "reset") return drawReset();
  const newStep = L.step === "newpin" || L.step === "newpin2";
  const pinStep = L.step === "pin" || newStep;
  const typed = newStep ? (L.step === "newpin" ? L.np : L.np2) : L.pin;
  const boxes = newStep ? `<div class="pinboxes${L.err && !typed ? " shake" : ""}" aria-label="New PIN, ${typed.length} of 6 digits entered">${[0, 1, 2, 3, 4, 5].map(i => `<span class="pb ${i < typed.length ? "full" : ""} ${i === typed.length ? "cur" : ""}"></span>`).join("")}</div>`
    : pinStep
    ? `<div class="pinboxes${L.err && !L.pin ? " shake" : ""}" aria-label="PIN, ${L.pin.length} of 6 digits entered">${[0, 1, 2, 3, 4, 5].map(i => `<span class="pb ${i < L.pin.length ? "full" : ""} ${i === L.pin.length ? "cur" : ""}"></span>`).join("")}</div>`
    : `<div class="phonebox ${L.phone ? "" : "empty"}" aria-live="polite">${L.phone ? fmtPhone(L.phone) + `<i class="pcur"></i>` : `<i class="pcur"></i><span class="pgh">Use the numbers below</span>`}</div>`;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  box.innerHTML = `<div class="lwrap">
    <aside class="lside"><div class="lart">${ART_MACHINE}</div>
      <p class="lbrand">Tagbook</p><p class="ltag">Every cloth, accounted for.</p></aside>
    <main class="lmain">
      <button class="lhelp" id="lhelp" aria-label="Help" aria-expanded="${L.help}">?</button>
      <div class="lart small">${ART_MACHINE}</div>
      ${newStep ? `<h1 class="lname">${L.step === "newpin" ? "Choose a new PIN" : "Type the new PIN again"}</h1>`
        : L.confirm ? `<p class="lhi">One quick safety step,</p><h1 class="lname">${esc(L.last.name)}</h1>`
        : pinStep && L.last ? `<p class="lhi">Welcome back,</p><h1 class="lname">${esc(L.last.name)}</h1>${L.last.shop ? `<p class="lshop">${esc(L.last.shop)}</p>` : ""}`
        : `<h1 class="lname">${pinStep ? "Enter your PIN" : "Welcome to Tagbook"}</h1>`}
      <p class="lask">${newStep ? (L.step === "newpin" ? "6 digits you'll remember. Don't use 123456." : "To make sure it's right") : L.confirm ? "Enter your PIN once to switch on Tagbook's new login protection. You only do this once." : pinStep ? (L.last ? "Enter your 6-digit PIN to continue" : `PIN for ${fmtPhone(L.phone)}`) : "Enter your phone number"}</p>
      ${L.help ? `<p class="lhelptext">Forgot your PIN? Tap “Forgot PIN?” below to reset it with WhatsApp, or ask the shop owner to set a new one in Settings.</p>` : ""}
      ${boxes}
      <p class="lerr" role="alert">${esc(L.err)}</p>
      <div class="keypad">${keys.map(k => k === "" ? `<span></span>` : k === "back"
        ? `<button class="key" data-k="back" aria-label="Delete"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6zM12 10l4 4m0-4-4 4"/></svg></button>`
        : `<button class="key" data-k="${k}" ${L.busy ? "disabled" : ""}>${k}</button>`).join("")}</div>
      ${!pinStep ? `<button class="btn btn-primary lgo" id="lgo" ${L.phone.length === 11 ? "" : "disabled"}>Continue</button>`
        : newStep ? `<p class="lfoot"><button class="llink" id="lrback">Cancel</button></p>`
        : L.confirm ? `<p class="lfoot"><button class="llink" id="llater">Not now</button></p>`
        : `<p class="lfoot"><button class="llink" id="lforgot">Forgot PIN?</button></p><p class="lfoot"><button class="llink" id="lswitch">${L.last ? "Log in with a different number" : "Change phone number"}</button></p>`}
      ${!L.confirm && !pinStep ? `<p class="lnew">New to Tagbook? <button class="llink" id="lnew">Start a new shop</button></p>` : ""}
      ${L.busy ? `<p class="lbusy">${newStep ? "Saving your new PIN…" : L.confirm ? "Checking…" : "Logging in…"}</p>` : ""}
      <p class="lpriv"><a href="/privacy">Privacy policy</a></p><p class="lpriv lco">Tagbook is a product of Ordiventa Technologies Limited (RC 10010214), No. 4, Aule Housing Estate, Aule Street, Akure, Ondo State, Nigeria · WhatsApp +234 812 075 6325</p>
    </main></div>`;
  box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => press(b.dataset.k));
  $("#lhelp").onclick = () => { L.help = !L.help; drawLogin(); };
  if ($("#lgo")) $("#lgo").onclick = () => next();
  if ($("#lnew")) $("#lnew").onclick = () => showSignup();
  if ($("#lforgot")) $("#lforgot").onclick = () => startReset();
  if ($("#lrback")) $("#lrback").onclick = () => { L.step = "pin"; L.pin = ""; L.err = ""; L.np = L.np2 = ""; drawLogin(); };
  if ($("#llater")) $("#llater").onclick = () => { try { sessionStorage.setItem("tb-pin-later", "1"); } catch (_) { } L = null; start(); };
  if ($("#lswitch")) $("#lswitch").onclick = () => { if (L.last) { try { localStorage.removeItem(LAST_KEY); } catch (_) { } } L = { step: "phone", phone: "", pin: "", err: "", busy: false, help: false, last: null }; drawLogin(); };
}
function press(k) {
  if (!L || L.busy) return;
  if (L.step === "phone") {
    if (k === "back") L.phone = L.phone.slice(0, -1); else if (L.phone.length < 11) L.phone += k;
    L.err = ""; drawLogin(); return;
  }
  if (L.step === "newpin" || L.step === "newpin2") {
    const f = L.step === "newpin" ? "np" : "np2";
    if (k === "back") L[f] = L[f].slice(0, -1); else if (L[f].length < 6) L[f] += k;
    L.err = ""; drawLogin();
    if (L[f].length === 6) {
      if (f === "np") { if (/^(\d)\1{5}$/.test(L.np) || L.np === "123456" || L.np === "654321") { L.np = ""; L.err = "That PIN is too easy to guess. Choose another."; drawLogin(); return; } L.step = "newpin2"; L.np2 = ""; drawLogin(); }
      else if (L.np2 !== L.np) { L.step = "newpin"; L.np = L.np2 = ""; L.err = "The two PINs didn't match. Choose your new PIN again."; drawLogin(); }
      else finishReset();
    }
    return;
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
/* Forgot PIN: prove the phone by sending a code from its WhatsApp, then choose a new PIN. */
const RESET_ERR = {
  NO_ACCOUNT: "No Tagbook login uses this number. Check the number, or ask your shop owner.",
  RESET_OFF: "Staff: ask your shop owner to set a new PIN in Settings. Shop owners: message Tagbook on WhatsApp, 0812 075 6325, and we'll set a new PIN for you.",
  TOO_MANY: "Too many tries. Wait an hour, or ask your shop owner to set a new PIN.",
  NOT_VERIFIED: "We haven't got the code on WhatsApp yet. Tap “Send code on WhatsApp”, send it, then come back.",
  NETWORK: "Can't reach Tagbook. Check your internet and try again.",
};
async function startReset() {
  L.busy = true; L.err = ""; drawLogin();
  const r = await signupCall({ action: "pin_reset_start", phone: L.phone });
  L.busy = false;
  if (r.error) { L.err = RESET_ERR[r.error] || "Something went wrong. Please try again."; drawLogin(); return; }
  L.reset = { checkId: r.check_id, to: r.wa_to, code: r.wa_code, sent: false }; L.step = "reset"; L.np = L.np2 = ""; drawLogin();
}
function drawReset() {
  const box = $("#login"), R = L.reset;
  box.innerHTML = `<div class="lwrap">
    <aside class="lside"><div class="lart">${ART_MACHINE}</div><p class="lbrand">Tagbook</p><p class="ltag">Every cloth, accounted for.</p></aside>
    <main class="lmain">
      <div class="lart small">${ART_MACHINE}</div>
      <h1 class="lname">Reset your PIN</h1>
      <p class="lask">Send this code to Tagbook from the WhatsApp on <b>${fmtPhone(L.phone)}</b>, so we know the number is yours.</p>
      <p class="wacode">${esc(R.code.replace(/(\d)(?=\d)/g, "$1 "))}</p>
      <a class="btn btn-primary" id="rwa" href="https://wa.me/${esc(R.to)}?text=${encodeURIComponent("Tagbook PIN " + R.code)}" target="_blank" rel="noopener">Send code on WhatsApp</a>
      <p class="hint">WhatsApp opens with the code typed in. Tap send, then come back here.</p>
      <p class="lerr" role="alert">${esc(L.err)}</p>
      <button class="btn ${R.sent ? "btn-primary" : "btn-ghost"} lgo" id="rnext">I've sent it. Choose a new PIN</button>
      <p class="lfoot"><button class="llink" id="rcancel">Back to log in</button></p>
    </main></div>`;
  $("#rwa").onclick = () => { R.sent = true; setTimeout(drawReset, 400); };
  $("#rnext").onclick = async () => {
    const btn = $("#rnext"); btn.disabled = true; btn.textContent = "Checking…";
    let ok = false;
    try { const { data, error } = await sb.rpc("wa_check_status", { p_id: R.checkId, p_phone: L.phone }); ok = !error && data === true; if (error) throw error; }
    catch (_) { L.err = RESET_ERR.NETWORK; drawReset(); return; }
    if (!ok) { L.err = RESET_ERR.NOT_VERIFIED; drawReset(); return; }
    L.err = ""; L.step = "newpin"; L.np = L.np2 = ""; drawLogin();
  };
  $("#rcancel").onclick = () => { L.step = "pin"; L.pin = ""; L.err = ""; L.reset = null; drawLogin(); };
}
async function finishReset() {
  L.busy = true; drawLogin();
  const r = await signupCall({ action: "pin_reset_finish", phone: L.phone, check_id: L.reset.checkId, pin: L.np });
  L.busy = false;
  if (r.error) {
    if (r.error === "NOT_VERIFIED") { L.step = "reset"; L.err = RESET_ERR.NOT_VERIFIED; drawLogin(); return; }
    L.step = "newpin"; L.np = L.np2 = ""; L.err = RESET_ERR[r.error] || (r.error === "BAD_PIN" ? "The PIN must be 6 digits." : "Something went wrong. Please try again."); drawLogin(); return;
  }
  const pin = L.np; L.reset = null; L.np = L.np2 = ""; L.step = "pin"; L.pin = pin; L.err = "";
  toast("New PIN saved"); tryLogin();
}
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
  if (!L || $("#login").hidden || S) return;
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
  const { data: st, error } = await sb.from("staff").select("user_id,shop_id,role,name,phone,active,can_bill").eq("user_id", user.id).maybeSingle();
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
  if (isAgent) { try { const c = await sb.rpc("is_caller"); isCaller = c.data === true; } catch (_) { isCaller = false; } }
  $("#login").hidden = true; L = null;
  try { await load(); } catch (e) { return cantReach("Can't load your shop. Check your internet and try again."); }
  saveLast({ phone: st.phone, name: st.name, shop: shop.name });
  reset(); subscribe(); route(); syncPush(); checkPaystackReturn();
  if (own() || newOpts()) pushState().then(st => { pushNow = st; if (st === "off" && tab === "orders") keepTyped(renderOrders); }).catch(() => { });
}

(async function boot() {
  const pre = document.getElementById("boot"); if (pre) pre.remove(); // the static loader from index.html
  $("#offline").hidden = navigator.onLine !== false;
  if (!hasSavedLogin()) return showLogin();
  await start();
})();
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && me && !hasSavedLogin()) { location.hash = ""; location.reload(); } });

/* ---------- Phones: #app is the scroll area (see extra.css). If the keyboard nudged the page, put it back. ---------- */
const mainScroll = () => window.matchMedia("(max-width: 899px)").matches ? document.getElementById("app") : document.scrollingElement;
document.addEventListener("focusout", () => setTimeout(() => { if (window.matchMedia("(max-width: 899px)").matches && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) window.scrollTo(0, 0); }, 150));
