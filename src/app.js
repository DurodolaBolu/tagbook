/* Tagbook: the real app. Same screens as the approved demo, backed by Supabase. */
import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://uungxatdvelljmaugzuz.supabase.co";
const SB_KEY = "sb_publishable_oE_-Yt6fovcOpIC01tnrpw_ueK-Zx7v";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "tagbook-auth" } });
// Logins are phone + 6-digit PIN. The phone becomes a hidden email and the PIN the password (same as the admin function).
const emailFor = p => `p${p}@users.tagbook.ordiventa.com`;
const passFor = pin => `tb-${pin}-tagbook`;

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
let me = null, role = "sec", shop = null, priv = null;
let BRANCHES = [], PRICES = [], customers = [], orders = [], staffList = [];
let tab = "orders", filter = "all", query = "", openNo = null;
const own = () => role === "own";
const theme = () => { try { return localStorage.getItem("tb-theme") || "light"; } catch (_) { return "light"; } };
const shopName = () => (shop && shop.name.trim()) || "Your laundry";
const branchName = id => (BRANCHES.find(b => b.id === id) || {}).name || "";
const liveBranches = () => BRANCHES.filter(b => b.active);
const cust = id => customers.find(c => c.id === id) || { name: "Customer", mark: "?", phone: "" };
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
    sb.from("shops").select("id,name,created_at").single(),
    fetchAll("branches", "id,name,sort,active", "sort"),
    fetchAll("items", "id,name,custom,services,sort,hidden", "sort"),
    fetchAll("customers", "id,name,mark"),
    fetchAll("orders", "id,no,customer_id,branch_id,items,express,pickup,status,checking,checked,notified,billed,settled,list_sent,created_at", "no"),
  ]);
  if (base[0].error) throw base[0].error;
  shop = base[0].data; BRANCHES = base[1]; customers = base[3];
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
  }
  PRICES = base[2].map(i => ({ ...i, p: prices[i.id] || {} }));
  customers.forEach(c => c.phone = phones[c.id] || "");
  orders = base[4].map(o => ({
    id: o.id, no: o.no, cid: o.customer_id, branch: o.branch_id, items: o.items || [], express: o.express, pickup: o.pickup,
    status: o.status, checking: o.checking, checked: o.checked || {}, notified: o.notified, billed: o.billed, settled: o.settled, list_sent: o.list_sent,
    at: Date.parse(o.created_at), m: { ...emptyMoney(), ...(money[o.id] || {}) }, again: {},
  }));
}

/* ---------- Saving: change the screen first, then the database; on failure reload what is really saved ---------- */
function failMsg(e) {
  const m = (e && (e.message || e.error_description)) || "";
  if (/fetch|network|Failed to/i.test(m)) return "Not saved. Check your internet and try again.";
  if (/OWNER_ONLY/.test(m)) return "Only the owner can do that.";
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
function refresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await load(); } catch (e) { return; }
    if (busy()) { pending = true; return; }
    render();
  }, 350);
}
document.addEventListener("focusout", () => setTimeout(() => { if (pending && !busy()) { pending = false; render(); } }, 50));
window.addEventListener("online", () => { $("#offline").hidden = true; refresh(); });
window.addEventListener("offline", () => { $("#offline").hidden = false; });

let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("shop-" + shop.id);
  const tables = ["orders", "customers", "items", "branches", "shops"].concat(own() ? ["order_money", "customer_phones", "item_prices", "shop_private"] : []);
  tables.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: t === "shops" ? `id=eq.${shop.id}` : `shop_id=eq.${shop.id}` }, refresh));
  channel.subscribe();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) refresh(); });

/* ---------- Money ---------- */
const sPriv = () => priv || { express_type: "percent", express_value: 0, bank_name: "", acct_no: "", acct_name: "" };
const hasBank = () => { const p = sPriv(); return p.bank_name.trim() && p.acct_no.length === 10 && p.acct_name.trim(); };
const payTo = () => { const p = sPriv(); return hasBank() ? `\n\nPay by transfer to:\n${p.bank_name.trim()}\n${p.acct_no}\n${p.acct_name.trim()}\nPlease send your payment receipt here.` : ""; };
function expressFor(sub) { const p = sPriv(); return p.express_type === "percent" ? Math.round(sub * p.express_value / 100 / 50) * 50 : p.express_value; }
const expressLabel = () => { const p = sPriv(); return p.express_type === "percent" ? `+${p.express_value}%` : `+${naira(p.express_value)}`; };
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
  const exp = o.express ? (o.billed && o.m.express_amt ? o.m.express_amt : expressFor(sub)) : 0;
  const total = Math.max(0, sub + exp + (+o.m.delivery || 0) - (+o.m.discount || 0));
  return { sub, exp, total, count };
}
const owed = o => own() ? (o.billed ? Math.max(0, o.m.total - o.m.paid) : 0) : (o.billed && !o.settled ? 1 : 0);

/* ---------- Navigation ---------- */
const TAB_HASH = { orders: "orders", new: "log", prices: "shop", reports: "reports" };
function go(h) { if (location.hash.slice(1) === h) route(); else location.hash = h; }
function route() {
  if (!me) return;
  const h = location.hash.slice(1);
  const m = h.match(/^order-(\d+)$/);
  if (m && orders.some(o => o.no === +m[1])) { tab = "orders"; openNo = +m[1]; }
  else { openNo = null; tab = h === "log" ? "new" : h === "shop" ? "prices" : (h === "reports" && own()) ? "reports" : "orders"; }
  render();
}
window.addEventListener("hashchange", route);
["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
const backBtn = label => `<div class="topbar"><button class="back" data-back>← ${label}</button></div>`;
function wireBack(root) { root.querySelectorAll("[data-back]").forEach(b => b.onclick = () => go("orders")); }

function render() {
  if (!me) return;
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = false; $("#tabsnav").hidden = false;
  $("#shopname").textContent = shopName();
  const tabs = own() ? [["orders", "Orders"], ["new", "+ Log clothes"], ["reports", "Reports"]] : [["orders", "Orders"], ["new", "+ Log clothes"]];
  const g = $("#gear"); g.hidden = false; g.onclick = () => go("shop"); g.setAttribute("aria-current", tab === "prices" ? "page" : "false");
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" ${k === "new" ? 'class="new"' : ""} ${tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("");
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => go(TAB_HASH[b.dataset.tab]));
  if (tab === "orders") renderOrders(); else if (tab === "new") renderNew(); else if (tab === "reports") renderReports(); else renderSettings();
  if (openNo) openOrder(openNo); else $("#sheet").hidden = true;
}

function pills(o) {
  const m = own()
    ? { new: ["Send list", "p-new"], listed: ["In progress", "p-billed"], ready: ["Ready, not told", "p-new"], told: ["Customer told", "p-ready"], picked: ["Picked up", "p-collected"] }
    : { new: ["In progress", "p-billed"], listed: ["In progress", "p-billed"], ready: ["Ready", "p-ready"], told: ["Ready", "p-ready"], picked: ["Picked up", "p-collected"] };
  let h = `<span class="pill ${m[o.status][1]}">${m[o.status][0]}</span>`;
  if (own() && !o.billed && o.status !== "new") h += `<span class="pill p-new">No bill yet</span>`;
  if (own() && o.m.paid && (o.status === "new" || o.status === "listed")) h += `<span class="pill p-ready">Paid ${naira(o.m.paid)}</span>`;
  if (o.billed && (o.status === "told" || o.status === "picked")) {
    if (own() && owed(o)) h += `<span class="pill p-owed">Owes ${naira(owed(o))}</span>`;
    if (!own()) h += `<span class="pill ${owed(o) ? "p-owed" : "p-collected"}">${owed(o) ? "Not paid" : "Paid"}</span>`;
  }
  return h;
}

/* ---------- Orders ---------- */
function renderOrders() {
  const fresh = orders.filter(o => !o.notified);
  const toList = orders.filter(o => o.status === "new");
  const notTold = orders.filter(o => o.status === "ready");
  const owing = orders.reduce((s, o) => s + ((o.status === "told" || o.status === "picked") ? (own() ? owed(o) : 0) : 0), 0);
  const inShop = orders.filter(o => o.status !== "picked");
  const fl = own()
    ? [["all", "All"], ["new", "Send list"], ["ready", "Ready, not told"], ["owed", "Owing"], ["picked", "Picked up"]]
    : [["all", "All"], ["work", "In progress"], ["ready", "Ready"], ["picked", "Picked up"]];
  const inF = (o, f) => {
    if (f === "work" && !(o.status === "new" || o.status === "listed")) return false;
    if (f === "new" && o.status !== "new") return false;
    if (f === "ready" && !(own() ? o.status === "ready" : (o.status === "ready" || o.status === "told"))) return false;
    if (f === "owed" && !((o.status === "told" || o.status === "picked") && owed(o))) return false;
    if (f === "picked" && o.status !== "picked") return false;
    return true;
  };
  const list = orders.filter(o => {
    if (!inF(o, filter)) return false;
    if (query) {
      const c = cust(o.cid), q = query.toLowerCase().replace(/\s/g, "");
      return (own() && c.phone.includes(q)) || c.name.toLowerCase().replace(/\s/g, "").includes(q) || c.mark.toLowerCase() === q || String(o.no).includes(q);
    }
    return true;
  }).sort((a, b) => b.no - a.no);
  const shown = list.slice(0, 200);
  view.innerHTML = `
    ${own() && fresh.length ? `<div class="alert"><span>${fresh.length} new order${fresh.length > 1 ? "s" : ""} logged by staff. Send the list of clothes to the customer.</span><button id="seen">See</button></div>` : ""}
    ${own() ? `<div class="stats">
      <button class="stat ${toList.length ? "hot" : ""}" data-go="new"><b>${toList.length}</b><span>Send list</span></button>
      <button class="stat ${notTold.length ? "hot" : ""}" data-go="ready"><b>${notTold.length}</b><span>Ready, not told</span></button>
      <button class="stat" data-go="owed"><b>${naira(owing)}</b><span>Owed to you</span></button></div>`
      : `<div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><b>${inShop.length}</b><span>Orders in the shop</span></div>
      <div class="stat"><b>${inShop.reduce((s, o) => s + calc(o).count, 0)}</b><span>Clothes in the shop</span></div></div>`}
    <input class="search" id="q" placeholder="${own() ? "Search phone, name or mark (BO)" : "Search name or mark (BO)"}" value="${esc(query)}" aria-label="Search">
    <div class="chips">${fl.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}<span class="cnt">${orders.filter(o => inF(o, k)).length}</span></button>`).join("")}</div>
    <div class="list">${shown.length ? shown.map(o => {
      const c = cust(o.cid), k = calc(o); return `
      <button class="order" data-no="${o.no}">
        <div class="mark">${esc(c.mark)}</div>
        <div class="who"><b>${esc(c.name)}</b><span>#${o.no} · ${k.count} items${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}</span></div>
        <div class="right">${own() && o.billed ? `<b>${naira(o.m.total)}</b>` : ""}${pills(o)}</div>
      </button>`;
    }).join("") : `<div class="empty">${orders.length ? "No orders here. Change the filter or search." : "No orders yet. Tap “+ Log clothes” to add the first one."}</div>`}</div>
    ${list.length > shown.length ? `<p class="hint" style="text-align:center;margin-top:12px">Showing the newest 200. Search to find older orders.</p>` : ""}
    <p class="foot">Tagbook by Ordiventa</p>`;
  $("#q").oninput = e => { query = e.target.value; const p = e.target.selectionStart; renderOrders(); const q = $("#q"); q.focus(); q.setSelectionRange(p, p); };
  view.querySelectorAll(".chip").forEach(c => c.onclick = () => { filter = c.dataset.f; renderOrders(); });
  view.querySelectorAll("[data-go]").forEach(c => c.onclick = () => { filter = c.dataset.go; renderOrders(); });
  view.querySelectorAll(".order").forEach(b => b.onclick = () => go("order-" + b.dataset.no));
  const s = $("#seen"); if (s) s.onclick = () => {
    const ids = fresh.map(o => o.id); fresh.forEach(o => o.notified = true); filter = "new"; renderOrders();
    sb.from("orders").update({ notified: true }).in("id", ids).then(({ error }) => { if (error) { toast(failMsg(error)); refresh(); } });
  };
}

/* ---------- Log clothes ---------- */
let d;
function reset() { d = { phone: "", found: undefined, name: "", hasMark: null, mark: "", branch: (liveBranches()[0] || {}).id || null, svc: "wi", items: [], express: false, pickup: false, askSpecial: false, specialName: "", paid: 0, saving: false }; }
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
let lookupFor = "";
async function lookup(phone) {
  lookupFor = phone; d.found = "loading";
  const { data, error } = await sb.rpc("find_customer", { p_phone: phone });
  if (lookupFor !== phone || d.phone !== phone) return;
  d.found = error ? undefined : (data && data[0]) || null;
  if (error) toast(failMsg(error));
  if (tab === "new") renderNew();
}
function renderNew() {
  if (!d.branch || !liveBranches().some(b => b.id === d.branch)) d.branch = (liveBranches()[0] || {}).id || null;
  const existing = d.phone.length === 11 && d.found && d.found !== "loading" ? d.found : null;
  let markBlock = "";
  if (d.phone.length === 11 && d.found === "loading") markBlock = `<p class="hint">Checking this number…</p>`;
  else if (existing) markBlock = `<div class="found">Returning customer: <b>${esc(existing.name)}</b>. Their mark is <b>${esc(existing.mark)}</b>.</div>`;
  else if (d.phone.length === 11 && d.found === null) {
    const clash = d.hasMark === "yes" && d.mark && markTaken(d.mark);
    markBlock = `
      <label for="nm">Customer name</label><input id="nm" placeholder="e.g. Bola Ogun" value="${esc(d.name)}" autocomplete="off">
      <label>Does this customer already have a mark on their clothes?</label>
      <div class="chips" style="margin:0"><button class="chip" data-hm="yes" aria-pressed="${d.hasMark === "yes"}">Yes, use it</button><button class="chip" data-hm="no" aria-pressed="${d.hasMark === "no"}">No, give one</button></div>
      ${d.hasMark === "yes" ? `<label for="mk">Their mark</label><input id="mk" placeholder="e.g. BL" value="${esc(d.mark)}" autocomplete="off">
        ${clash ? `<div class="bad">${esc(clash.mark)} is already used by ${esc(clash.name)}. Use a different mark so their clothes don't mix.</div>` : ""}` : ""}
      ${d.hasMark === "no" && d.name.trim() ? `<div class="found">New mark: <b>${suggest(d.name)}</b>. Write this inside every cloth.</div>` : ""}`;
  } else markBlock = `<p class="hint">Type the customer's number. Regular customers come up with their name and mark.</p>`;
  const count = d.items.reduce((s, it) => s + it.qty, 0);
  const pickable = PRICES.filter(p => !p.hidden && (p.custom || (p.services || []).includes(d.svc)));
  view.innerHTML = `
    ${backBtn("Orders")}
    <h2>Log clothes</h2>
    <label for="ph">Customer phone</label>
    <input id="ph" type="text" inputmode="tel" placeholder="0803 412 7790" value="${d.phone}" autocomplete="off">
    ${markBlock}
    ${liveBranches().length > 1 ? `<label for="br">Dropped at</label>
    <select id="br">${liveBranches().map(b => `<option value="${b.id}" ${d.branch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : ""}
    <label>Service</label>
    <div class="chips" style="margin:0">${Object.entries(SERVICES).map(([s, l]) => `<button class="chip" data-svc="${s}" aria-pressed="${d.svc === s}">${l}</button>`).join("")}</div>
    <label>Tap to add clothes</label>
    <div class="picker">${pickable.map(p => `<button data-add="${p.id}">${esc(p.name)}${p.custom ? "<small>Wedding gown, curtain</small>" : ""}</button>`).join("")}</div>
    ${d.askSpecial ? `<div class="check" style="margin-top:8px"><label for="sp" style="margin-top:0">What is the special item?</label>
      <input id="sp" placeholder="e.g. Wedding gown" value="${esc(d.specialName)}" autocomplete="off">
      <div class="row"><button class="btn btn-ghost" id="spc">Cancel</button><button class="btn btn-primary" id="spa" ${d.specialName.trim() ? "" : "disabled"}>Add item</button></div></div>` : ""}
    <div class="items">${d.items.map((it, i) => `
      <div class="item"><span>${esc(pname(it))}<br><small style="color:var(--muted)">${SERVICES[it.svc]}</small></span>
      <div class="qty"><button data-dec="${i}" aria-label="Remove one">−</button><b style="min-width:22px;text-align:center">${it.qty}</b><button data-inc="${i}" aria-label="Add one">+</button></div></div>`).join("")}</div>
    <label class="toggle"><span>Express delivery</span><input type="checkbox" id="ex" ${d.express ? "checked" : ""}></label>
    <label class="toggle"><span>Pickup and delivery</span><input type="checkbox" id="pk" ${d.pickup ? "checked" : ""}></label>
    ${own() ? `<label for="pd">Paid at drop-off (₦)</label><input id="pd" ${moneyAttrs} placeholder="0" value="${d.paid || ""}">
      <p class="hint">Leave empty if the customer will pay when collecting.</p>` : ""}
    <div class="lines"><div><b>Clothes logged</b><b>${count}</b></div></div>
    <p class="hint">${own() ? "After saving, you can send the list of clothes to the customer straight away." : "Saving sends this order to the owner's phone. The owner sends the list of clothes to the customer."}</p>
    <p class="bad" id="saveerr" role="alert" hidden></p>
    <button class="btn btn-primary" id="save" ${d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : own() ? "Save order" : "Save and send to owner"}</button>
    <button class="btn btn-ghost" id="clr">Clear</button>`;
  wireBack(view);
  const keep = (id, fn) => { const el = $(id); if (!el) return; el.oninput = e => { fn(e.target.value); const p = e.target.selectionStart; renderNew(); const n = $(id); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (_) { } } }; };
  keep("#ph", v => { const nv = digits(v).slice(0, 11); if (nv !== d.phone) { d.phone = nv; d.found = undefined; if (nv.length === 11) lookup(nv); } });
  keep("#nm", v => d.name = v.replace(/[^a-z\s'-]/gi, ""));
  keep("#mk", v => d.mark = v.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase());
  keep("#sp", v => d.specialName = v);
  moneyInput($("#pd"), v => d.paid = v);
  if ($("#br")) $("#br").onchange = e => d.branch = e.target.value;
  $("#ex").onchange = e => { d.express = e.target.checked; };
  $("#pk").onchange = e => { d.pickup = e.target.checked; };
  view.querySelectorAll("[data-hm]").forEach(b => b.onclick = () => { d.hasMark = b.dataset.hm; renderNew(); });
  view.querySelectorAll("[data-svc]").forEach(b => b.onclick = () => { d.svc = b.dataset.svc; renderNew(); });
  view.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    if ((item(id) || {}).custom) { d.askSpecial = id; d.specialName = ""; renderNew(); $("#sp").focus(); return; }
    const f = d.items.find(i => i.id === id && i.svc === d.svc && !i.label); f ? f.qty++ : d.items.push({ id, svc: d.svc, qty: 1 }); renderNew();
  });
  if ($("#spc")) $("#spc").onclick = () => { d.askSpecial = false; renderNew(); };
  if ($("#spa")) $("#spa").onclick = () => { d.items.push({ id: d.askSpecial, svc: d.svc, qty: 1, label: d.specialName.trim().slice(0, 40) }); d.askSpecial = false; renderNew(); };
  view.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => { d.items[+b.dataset.inc].qty++; renderNew(); });
  view.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const i = +b.dataset.dec; d.items[i].qty--; if (!d.items[i].qty) d.items.splice(i, 1); renderNew(); });
  $("#clr").onclick = () => { reset(); renderNew(); };
  $("#save").onclick = async () => {
    if (d.saving) return;
    const isNew = d.found === null;
    const clash = isNew && d.hasMark === "yes" && d.mark && markTaken(d.mark);
    const err = !d.phone ? "Enter the customer's phone number."
      : (d.phone.length !== 11 || d.phone[0] !== "0") ? "The phone number is not correct. It must be 11 digits and start with 0, like 0803 412 7790."
      : (d.found === undefined || d.found === "loading") ? "Still checking this number. Try again in a moment."
      : (isNew && !d.name.trim()) ? "Enter the customer's name."
      : (isNew && !d.hasMark) ? "Choose if the customer already has a mark on their clothes."
      : (isNew && d.hasMark === "yes" && !d.mark) ? "Type the customer's mark."
      : clash ? `${clash.mark} is already used by ${clash.name}. Use a different mark.`
      : !d.items.length ? "Add at least one cloth to the order." : "";
    if (err) { showErr(err); if (d.found === undefined && d.phone.length === 11) lookup(d.phone); return; }
    const mark = isNew ? (d.hasMark === "yes" ? d.mark : suggest(d.name)) : d.found.mark;
    d.saving = true; renderNew();
    const { data, error } = await sb.rpc("log_order", {
      p: {
        phone: d.phone, name: d.name.trim(), mark, branch_id: d.branch, items: d.items.map(i => ({ ...i })),
        express: d.express, pickup: d.pickup, paid: own() ? d.paid : 0,
      }
    });
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

/* ---------- Messages ---------- */
function billLines(o) {
  const k = calc(o);
  return o.items.map((it, i) => `${it.qty} x ${pname(it)} ${naira(unitPrice(o, it, i) * it.qty)}`).join("\n")
    + (k.exp ? `\nExpress delivery: ${naira(k.exp)}` : "") + (o.m.delivery ? `\nPickup/delivery: ${naira(o.m.delivery)}` : "") + (o.m.discount ? `\nDiscount: -${naira(o.m.discount)}` : "");
}
function message(o, type) {
  const c = cust(o.cid), k = calc(o), first = c.name.split(" ")[0];
  if (type === "list") {
    const list = o.items.map(it => `${it.qty} x ${pname(it)} (${SERVICES[it.svc]})`).join("\n");
    return `Hello ${first}, ${shopName()} has received your clothes.\nOrder #${o.no} · Mark ${c.mark} · ${k.count} items\n\n${list}${o.m.paid ? `\n\nPayment received: ${naira(o.m.paid)}` : ""}\n\nWe will let you know when your clothes are ready, and send your bill with it.\n\n_Sent with Tagbook_`;
  }
  const where = liveBranches().length > 1 && branchName(o.branch) ? `\nCollect at: ${branchName(o.branch)}` : "";
  if (type === "ready") return `Hello ${first}, your clothes are ready at ${shopName()}.${where}\n\nINVOICE INV-${o.no}\nDate: ${fmtDay(Date.now())}\nCustomer: ${c.name} (Mark ${c.mark})\n${k.count} items\n\n${billLines(o)}\n\nTotal: ${naira(o.m.total)}${o.m.paid ? `\nPaid: ${naira(o.m.paid)}` : ""}${owed(o) ? `\nAmount to pay: ${naira(owed(o))}${payTo()}` : "\nFully paid. Thank you."}\n\n_Sent with Tagbook_`;
  return `Hello ${first}, a reminder from ${shopName()}: invoice INV-${o.no} has ${naira(owed(o))} still to pay.${payTo()}\n\nThank you.\n_Sent with Tagbook_`;
}
const waFmt = t => esc(t).replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<i>$2</i>").replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<b>$2</b>");
const wa = (o, t) => { const p = cust(o.cid).phone; return (p ? "https://wa.me/234" + p.slice(1) : "https://wa.me/") + "?text=" + encodeURIComponent(t); };
const MSG_NAMES = { list: "list of clothes", ready: "clothes ready, with invoice", owe: "payment reminder" };
function waBlock(o, type, markable) {
  return `<p class="wa-label">WhatsApp to customer: ${MSG_NAMES[type]}</p>
    <div class="wa" id="wamsg-${type}">${waFmt(message(o, type))}</div>
    <a class="btn btn-primary" href="${wa(o, message(o, type))}" target="_blank" rel="noopener">Open in WhatsApp</a>
    <div class="row"><button class="btn btn-ghost" data-copy="${type}">Copy</button>${markable ? `<button class="btn btn-ghost" data-done="${type}">I've sent it</button>` : ""}</div>
    ${(type === "ready" || type === "owe") && owed(o) && !hasBank() ? `<p class="bad">Add your bank account in Settings so the invoice tells the customer where to pay.</p>` : ""}
    ${markable ? `<p class="hint">After sending, tap “I've sent it”. Until then this message stays here.</p>` : ""}`;
}
const sentLine = (o, type, text) => o.again[type] ? waBlock(o, type, false) : `<div class="sent"><span>${text}</span><button data-again="${type}">Send again</button></div>`;

/* ---------- Order detail ---------- */
function openOrder(no) {
  const o = orders.find(x => x.no === no); if (!o) { go("orders"); return; }
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
        <div><label class="ck" style="margin:0"><input type="checkbox" id="ex" ${o.express ? "checked" : ""}> Express delivery (${expressLabel()})</label><span id="exv">${naira(k.exp)}</span></div>
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
      ${!o.billed || owed(o) ? `<label for="pay">Amount received (₦)</label><input id="pay" ${moneyAttrs} placeholder="${owed(o) || "0"}">
      <button class="btn btn-primary" id="pp">Record payment</button>
      ${!o.billed ? `<p class="hint">Use this when a customer pays before the clothes are ready.</p>` : ""}` : `<p class="hint">Fully paid.</p>`}`;
    if (o.status === "picked" && owed(o)) html += waBlock(o, "owe", false);
    html += checkHtml();
  } else {
    html += `<div class="lines">${o.items.map(it => `<div><span>${it.qty} × ${esc(pname(it))}</span><span style="color:var(--muted)">${SERVICES[it.svc]}</span></div>`).join("")}
      <div><b>Clothes</b><b>${k.count}</b></div>
      ${o.billed && (o.status === "told" || o.status === "picked") ? `<div><span>Payment</span><span class="pill ${owed(o) ? "p-owed" : "p-collected"}">${owed(o) ? "Not paid" : "Paid"}</span></div>` : ""}</div>`;
    html += checkHtml();
    if (o.status === "ready") html += `<p class="hint" style="margin-top:12px">Ready and bagged. Waiting for the owner to tell the customer.</p>`;
  }
  if (o.status === "ready" || o.status === "told") html += `<button class="btn btn-ghost" id="pick" style="margin-top:16px">Clothes picked up</button>
    <p class="hint">Mark this when the customer takes the clothes${own() ? ". Payment is recorded separately, because some customers pay later." : ". Payment is recorded by the owner."}</p>`;

  const y = sh.hidden ? 0 : sh.scrollTop;
  sh.innerHTML = `<div class="app">
    ${backBtn("All orders")}
    <div class="dhead"><div class="mark">${esc(c.mark)}</div><div><b>${esc(c.name)}</b>
      <span>${own() && c.phone ? fmtPhone(c.phone) + " · " : ""}#${o.no}${liveBranches().length > 1 ? " · " + esc(branchName(o.branch)) : ""}${o.pickup ? " · pickup" : ""}${o.express ? " · express delivery" : ""}</span></div></div>
    <div class="steps"><span class="fill" style="width:${idx * 20}%"></span>${STEPS.map((s, i) => `<div class="st ${i === 1 && !o.list_sent && idx > 1 ? "" : i < idx || (i === idx && o.status === "picked") ? "done" : i === idx ? "cur" : ""}">${s[1]}</div>`).join("")}</div>
    <p class="hint">Dropped ${fmtDay(o.at)}</p>
    ${html}
  </div>`;
  const wasHidden = sh.hidden; sh.hidden = false; sh.scrollTop = wasHidden ? 0 : y;
  wireBack(sh);
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
  const live = () => { const kk = calc(o); $("#tot").textContent = naira(kk.total); $("#exv").textContent = naira(kk.exp); };
  sh.querySelectorAll("[data-cp]").forEach(i => moneyInput(i, v => { o.m.custom[i.dataset.cp] = v; live(); }));
  moneyInput($("#dl"), v => { o.m.delivery = v; live(); });
  moneyInput($("#dc"), v => { o.m.discount = v; live(); });
  moneyInput($("#pay"), () => { });
  if ($("#ex")) $("#ex").onchange = e => { o.express = e.target.checked; o.m.express_amt = 0; live(); };
  const bill = $("#bill"); if (bill) bill.onclick = async () => {
    const miss = o.items.find((it, i) => (item(it.id) || {}).custom && !o.m.custom[i]);
    if (miss) { toast(`Set a price for ${pname(miss)} first`); return; }
    if (!o.billed) lockPrices(o);
    const kk = calc(o);
    o.m.express_amt = kk.exp; o.m.total = kk.total; o.m.billed_at = o.m.billed_at || new Date().toISOString();
    bill.disabled = true;
    if (await put("orders", { id: o.id }, { express: o.express }) && await saveMoney(o)) toast("Bill saved");
    again();
  };
  const pp = $("#pp"); if (pp) pp.onclick = async () => {
    const v = num($("#pay").value); if (!v) { toast("Type the amount received"); return; }
    const before = o.m.paid; o.m.paid = o.billed ? Math.min(o.m.total, o.m.paid + v) : o.m.paid + v;
    if (o.m.paid > before) o.m.payments = [...(o.m.payments || []), { amt: o.m.paid - before, at: Date.now() }];
    pp.disabled = true;
    if (await saveMoney(o)) toast(o.billed && owed(o) ? `Recorded. ${naira(owed(o))} still to pay.` : o.billed ? "Fully paid" : `Recorded ${naira(o.m.paid)} paid early`);
    again();
  };
  const w = $("#washed"); if (w) w.onclick = () => { o.checking = true; again(); put("orders", { id: o.id }, { checking: true }); };
  sh.querySelectorAll("[data-ck]").forEach(b => b.onchange = () => { o.checked = { ...o.checked, [b.dataset.ck]: b.checked }; again(); put("orders", { id: o.id }, { checked: o.checked }); });
  const rd = $("#rd"); if (rd) rd.onclick = () => setStatus("ready", own() ? "Marked ready. Send the ready message." : "Marked ready. The owner has been told.");
  const pk = $("#pick"); if (pk) pk.onclick = () => setStatus("picked", owed(o) ? "Picked up. Not fully paid yet." : "Picked up");
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
    PHONE_IN_USE: "This phone number already has a Tagbook login.", BAD_PHONE: "The phone number must be 11 digits and start with 0.",
    BAD_PIN: "The PIN must be 6 digits.", MISSING_NAME: "Type the name.", OWNER_ONLY: "Only the owner can do that.", CANNOT_REMOVE_SELF: "You can't remove yourself.",
  };
  return { ok: false, msg: msgs[code] || "Something went wrong. Check your internet and try again." };
}
const pinAttrs = 'type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"';
let resetFor = null;
function renderSettings() {
  const meCard = `<p class="who-me">Signed in as <b>${esc(me.name)}</b> (${own() ? "owner" : "staff"}) · ${fmtPhone(me.phone)}</p>`;
  const appearance = `<div class="check"><p><b>Appearance</b></p>
      <div class="chips" style="margin:0"><button class="chip" data-th="light" aria-pressed="${theme() !== "dark"}">Light</button><button class="chip" data-th="dark" aria-pressed="${theme() === "dark"}">Dark</button></div></div>`;
  const myPin = `<div class="check"><p><b>Change my PIN</b></p>
      <label for="np" style="margin-top:0">New 6-digit PIN</label><input id="np" class="pin" ${pinAttrs}>
      <button class="btn btn-ghost" id="npb">Save new PIN</button></div>
    <button class="btn btn-ghost" id="out" style="margin-top:20px">Log out</button>`;
  if (!own()) {
    view.innerHTML = `${backBtn("Orders")}<h2>Settings</h2>${meCard}${appearance}${myPin}<p class="foot">Tagbook by Ordiventa</p>`;
    wireCommon(); return;
  }
  const p = sPriv();
  view.innerHTML = `${backBtn("Orders")}<h2>Settings</h2>${meCard}
    <div class="check">
      <label for="sn" style="margin-top:0">Business name</label>
      <input id="sn" value="${esc(shop.name)}" placeholder="e.g. BrightWash Laundry" autocomplete="off">
      <p class="hint">This name appears at the top of the app and in every WhatsApp message.</p>
    </div>
    ${appearance}
    <div class="check">
      <p><b>Bank account for payments</b></p>
      <p class="hint" style="margin:0">Added to every invoice and payment reminder, so customers know where to pay.</p>
      <label for="bn">Bank name</label><input id="bn" value="${esc(p.bank_name)}" placeholder="e.g. GTBank" autocomplete="off">
      <label for="an">Account number</label><input id="an" ${moneyAttrs} maxlength="10" value="${esc(p.acct_no)}" placeholder="10 digits">
      <p class="hint" id="anx">${p.acct_no.length === 10 ? "" : "Account number must be 10 digits."}</p>
      <label for="am" style="margin-top:6px">Account name</label><input id="am" value="${esc(p.acct_name)}" placeholder="Name on the account" autocomplete="off">
    </div>
    <div class="check">
      <p><b>Express delivery charge</b></p>
      <p class="hint" style="margin:0 0 8px">Added to the bill when an order is marked express delivery.</p>
      <div class="chips" style="margin:0 0 8px"><button class="chip" data-et="percent" aria-pressed="${p.express_type === "percent"}">Percentage extra</button><button class="chip" data-et="fixed" aria-pressed="${p.express_type === "fixed"}">Fixed amount</button></div>
      <label for="ev" style="margin-top:0">${p.express_type === "percent" ? "Extra percentage (%)" : "Extra amount per order (₦)"}</label>
      <input id="ev" ${moneyAttrs} value="${p.express_value}">
      <p class="hint" id="evx">${exampleExpress()}</p>
    </div>
    <div class="check">
      <p><b>Branches</b></p>
      <p class="hint" style="margin:0">Where customers drop clothes. With one branch, the app doesn't ask.</p>
      ${liveBranches().map(b => `<div class="row" style="margin-top:8px;align-items:center"><input data-bn="${b.id}" value="${esc(b.name)}" autocomplete="off" aria-label="Branch name">${liveBranches().length > 1 ? `<button class="mini danger" style="flex:none" data-brm="${b.id}">Remove</button>` : ""}</div>`).join("")}
      <div class="row" style="margin-top:8px"><input id="nb" placeholder="New branch name" autocomplete="off"><button class="mini" style="flex:none" id="nbb">Add</button></div>
    </div>
    <div class="check">
      <p><b>Staff logins</b></p>
      <p class="hint" style="margin:0 0 4px">Staff log clothes and check them before bagging. They never see prices, money or customer numbers.</p>
      ${staffList.map(s => `<div class="staff-row"><div><b>${esc(s.name)}${s.user_id === me.user_id ? " (you)" : ""}</b><span>${s.role === "owner" ? "Owner" : "Staff"} · ${fmtPhone(s.phone)}</span></div>
        ${s.user_id === me.user_id ? "" : `<div class="acts"><button class="mini" data-rp="${s.user_id}">New PIN</button><button class="mini danger" data-srm="${s.user_id}">Remove</button></div>`}</div>
        ${resetFor === s.user_id ? `<div class="row" style="margin:6px 0 10px"><input id="rpi" class="pin" ${pinAttrs} placeholder="6 digits" aria-label="New PIN for ${esc(s.name)}"><button class="mini" style="flex:none" id="rpb">Save</button></div>` : ""}`).join("")}
      <p style="margin:14px 0 0"><b>Add a staff login</b></p>
      <label for="sfn">Name</label><input id="sfn" placeholder="e.g. Grace" autocomplete="off">
      <label for="sfp">Phone number</label><input id="sfp" type="text" inputmode="tel" placeholder="0803 412 7790" autocomplete="off">
      <label for="sfk">6-digit PIN for them</label><input id="sfk" class="pin" ${pinAttrs}>
      <button class="btn btn-primary" id="sfa">Add staff login</button>
      <p class="hint">Tell them their PIN in person. They can change it in their own Settings.</p>
    </div>
    <h2 style="margin-top:18px">Price list</h2>
    <p class="hint" style="margin-top:-6px">Tap any name or price to change it. Leave a price empty if the shop does not offer that service for the item. New prices apply to new bills; saved bills keep their prices.</p>
    ${PRICES.filter(x => !x.custom && !x.hidden).map(x => `<div class="check pitem">
      <div class="row" style="align-items:flex-end"><div><label for="pn-${x.id}" style="margin-top:0">Item name</label><input id="pn-${x.id}" data-pn="${x.id}" value="${esc(x.name)}" autocomplete="off"></div><button class="x" data-prm="${x.id}" aria-label="Remove ${esc(x.name)}">Remove</button></div>
      <div class="pgrid">${Object.entries(SERVICES).map(([k, l]) => `<div><label for="pp-${x.id}-${k}">${l} (₦)</label><input id="pp-${x.id}-${k}" data-pp="${x.id}" data-k="${k}" ${moneyAttrs} value="${x.p[k] != null ? x.p[k] : ""}" placeholder="Not offered"></div>`).join("")}</div>
    </div>`).join("")}
    <div class="check">
      <p><b>Add an item</b></p>
      <label for="ni" style="margin-top:0">Item name</label><input id="ni" placeholder="e.g. Curtain (per panel)" autocomplete="off">
      <div class="pgrid">${Object.entries(SERVICES).map(([k, l]) => `<div><label for="na-${k}">${l} (₦)</label><input id="na-${k}" data-na="${k}" ${moneyAttrs} placeholder="Not offered"></div>`).join("")}</div>
      <button class="btn btn-primary" id="nadd">Add to price list</button>
    </div>
    <p class="hint">Special items, like a wedding gown, get their price when you make the bill.</p>
    ${myPin}
    <p class="foot">Tagbook by Ordiventa</p>`;
  wireCommon();
  const savedToast = ok => { if (ok) toast("Saved"); };
  $("#sn").onchange = async e => { const v = e.target.value.trim().slice(0, 40); if (!v) { e.target.value = shop.name; return; } shop.name = v; $("#shopname").textContent = shopName(); savedToast(await put("shops", { id: shop.id }, { name: v })); };
  const savePriv = async fields => { Object.assign(priv, fields); savedToast(await put("shop_private", { shop_id: shop.id }, fields)); };
  $("#bn").onchange = e => savePriv({ bank_name: e.target.value.trim().slice(0, 40) });
  $("#am").onchange = e => savePriv({ acct_name: e.target.value.trim().slice(0, 60) });
  moneyInput($("#an"), () => { const el = $("#an"); if (el.value.length > 10) el.value = el.value.slice(0, 10); $("#anx").textContent = el.value.length === 10 ? "" : "Account number must be 10 digits."; });
  $("#an").onchange = e => savePriv({ acct_no: e.target.value });
  view.querySelectorAll("[data-et]").forEach(b => b.onclick = async () => { await savePriv({ express_type: b.dataset.et, express_value: b.dataset.et === "percent" ? 50 : 1000 }); renderSettings(); });
  moneyInput($("#ev"), v => { priv.express_value = p.express_type === "percent" ? Math.min(v, 300) : v; $("#evx").textContent = exampleExpress(); });
  $("#ev").onchange = () => savePriv({ express_value: priv.express_value });
  // branches
  view.querySelectorAll("[data-bn]").forEach(i => i.onchange = async () => { const v = i.value.trim().slice(0, 40); if (!v) return; const b = BRANCHES.find(x => x.id === i.dataset.bn); b.name = v; savedToast(await put("branches", { id: b.id }, { name: v })); });
  view.querySelectorAll("[data-brm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again"; return; } const br = BRANCHES.find(x => x.id === b.dataset.brm); br.active = false; renderSettings(); savedToast(await put("branches", { id: br.id }, { active: false })); });
  $("#nbb").onclick = async () => { const v = $("#nb").value.trim().slice(0, 40); if (!v) { toast("Type the branch name first"); return; } const { error } = await sb.from("branches").insert({ shop_id: shop.id, name: v, sort: BRANCHES.length }); if (error) { toast(failMsg(error)); return; } toast(`${v} added`); await load(); renderSettings(); };
  // staff
  view.querySelectorAll("[data-rp]").forEach(b => b.onclick = () => { resetFor = resetFor === b.dataset.rp ? null : b.dataset.rp; renderSettings(); const i = $("#rpi"); if (i) i.focus(); });
  if ($("#rpb")) $("#rpb").onclick = async () => { const pin = digits($("#rpi").value); if (pin.length !== 6) { toast("The PIN must be 6 digits."); return; } $("#rpb").disabled = true; const r = await callAdmin({ action: "reset_pin", user_id: resetFor, pin }); toast(r.ok ? "New PIN saved. Tell them in person." : r.msg); if (r.ok) { resetFor = null; renderSettings(); } else $("#rpb").disabled = false; };
  view.querySelectorAll("[data-srm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again"; return; } b.disabled = true; const r = await callAdmin({ action: "remove_staff", user_id: b.dataset.srm }); toast(r.ok ? "Staff login removed" : r.msg); if (r.ok) { await load(); renderSettings(); } });
  $("#sfa").onclick = async () => {
    const name = $("#sfn").value.trim(), phone = digits($("#sfp").value), pin = digits($("#sfk").value);
    const err = !name ? "Type the staff member's name." : !/^0\d{10}$/.test(phone) ? "The phone number must be 11 digits and start with 0." : pin.length !== 6 ? "The PIN must be 6 digits." : "";
    if (err) { toast(err); return; }
    $("#sfa").disabled = true; $("#sfa").textContent = "Adding…";
    const r = await callAdmin({ action: "add_staff", name, phone, pin });
    if (!r.ok) { toast(r.msg); $("#sfa").disabled = false; $("#sfa").textContent = "Add staff login"; return; }
    toast(`${name} can now log in with ${fmtPhone(phone)} and their PIN`); await load(); renderSettings();
  };
  // price list
  const savePrice = async x => {
    x.services = Object.keys(SERVICES).filter(k => x.p[k] != null);
    const a = await put("items", { id: x.id }, { name: x.name, services: x.services });
    const { error } = await sb.from("item_prices").upsert({ item_id: x.id, shop_id: shop.id, prices: x.p });
    if (error) { toast(failMsg(error)); refresh(); return; }
    savedToast(a);
  };
  view.querySelectorAll("[data-pn]").forEach(i => i.onchange = () => { const x = item(i.dataset.pn); const v = i.value.trim().slice(0, 40); if (!v) { i.value = x.name; return; } x.name = v; savePrice(x); });
  view.querySelectorAll("[data-pp]").forEach(i => { moneyInput(i, () => { }); i.onchange = () => { const x = item(i.dataset.pp); x.p = { ...x.p, [i.dataset.k]: i.value === "" ? null : num(i.value) }; savePrice(x); }; });
  view.querySelectorAll("[data-prm]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; return; } const x = item(b.dataset.prm); x.hidden = true; renderSettings(); if (await put("items", { id: x.id }, { hidden: true })) toast("Item removed from the price list"); });
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
    await load(); renderSettings();
  };
}
function wireCommon() {
  wireBack(view);
  view.querySelectorAll("[data-th]").forEach(b => b.onclick = () => { try { localStorage.setItem("tb-theme", b.dataset.th); } catch (_) { } document.documentElement.dataset.tb = b.dataset.th; renderSettings(); });
  $("#npb").onclick = async () => {
    const pin = digits($("#np").value); if (pin.length !== 6) { toast("The PIN must be 6 digits."); return; }
    $("#npb").disabled = true;
    const { error } = await sb.auth.updateUser({ password: passFor(pin) });
    $("#npb").disabled = false;
    if (error) { toast(failMsg(error)); return; }
    $("#np").value = ""; toast("New PIN saved. Use it next time you log in.");
  };
  $("#out").onclick = async () => { if (!$("#out").dataset.sure) { $("#out").dataset.sure = "1"; $("#out").textContent = "Tap again to log out"; return; } await sb.auth.signOut(); location.hash = ""; location.reload(); };
}
function exampleExpress() { return `Example: a ${naira(5000)} order marked express delivery costs ${naira(5000 + expressFor(5000))}.`; }

/* ---------- Login ---------- */
function showLogin(msg) {
  me = null;
  document.documentElement.dataset.tb = theme() === "dark" ? "dark" : "light";
  $("#app").hidden = true; $("#tabsnav").hidden = true; $("#sheet").hidden = true;
  const box = $("#login"); box.hidden = false;
  box.innerHTML = `<div class="lbrand">Tagbook<small>For laundry and dry cleaning shops</small></div>
    <form class="card" id="lf" novalidate>
      <label for="lp">Phone number</label><input id="lp" type="text" inputmode="tel" autocomplete="username" placeholder="0803 412 7790">
      <label for="lk">6-digit PIN</label><input id="lk" class="pin" ${pinAttrs} autocomplete="current-password">
      <p class="bad" id="le" role="alert" ${msg ? "" : "hidden"}>${esc(msg || "")}</p>
      <button class="btn btn-primary" id="lb" type="submit">Log in</button>
    </form>
    <p class="hint" style="margin-top:14px">Forgot your PIN? Ask the shop owner to set a new one.</p>
    <p class="foot">Tagbook by Ordiventa</p>`;
  $("#lp").oninput = e => { const v = digits(e.target.value).slice(0, 11); if (e.target.value !== v) e.target.value = v; };
  $("#lk").oninput = e => { const v = digits(e.target.value).slice(0, 6); if (e.target.value !== v) e.target.value = v; };
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const phone = digits($("#lp").value), pin = digits($("#lk").value), le = $("#le");
    const err = !/^0\d{10}$/.test(phone) ? "Type your 11-digit phone number, starting with 0." : pin.length !== 6 ? "Type your 6-digit PIN." : "";
    if (err) { le.textContent = err; le.hidden = false; return; }
    $("#lb").disabled = true; $("#lb").textContent = "Logging in…"; le.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: emailFor(phone), password: passFor(pin) });
    if (error) {
      $("#lb").disabled = false; $("#lb").textContent = "Log in";
      le.textContent = /fetch|network/i.test(error.message) ? "Can't reach Tagbook. Check your internet and try again." : "Wrong phone number or PIN.";
      le.hidden = false; return;
    }
    box.hidden = true; await start();
  };
}

async function start() {
  view.innerHTML = `<div class="loading">Loading your shop…</div>`; $("#app").hidden = false;
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return showLogin();
  const { data: st, error } = await sb.from("staff").select("user_id,shop_id,role,name,phone,active").eq("user_id", u.user.id).maybeSingle();
  if (error) { view.innerHTML = `<div class="loading">Can't reach Tagbook. Check your internet, then pull down to try again.</div>`; return; }
  if (!st || !st.active) { await sb.auth.signOut(); return showLogin("This login has been removed. Ask the shop owner."); }
  me = st; role = st.role === "owner" ? "own" : "sec";
  try { await load(); } catch (e) { view.innerHTML = `<div class="loading">Can't load your shop. Check your internet, then pull down to try again.</div>`; return; }
  reset(); subscribe(); route();
}

(async function boot() {
  $("#offline").hidden = navigator.onLine !== false;
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  await start();
})();
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && me) { location.hash = ""; location.reload(); } });
