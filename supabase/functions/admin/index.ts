import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Tagbook staff and shop management. Logins are phone + 6-digit PIN.
// The phone becomes a hidden email. The password mixes the PIN with a server-only secret
// (same as the login function), so PINs can only be tried through Tagbook's own login, which locks after 5 wrong tries.
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, status = 400) => json({ error: code }, status);

const cleanPhone = (p: unknown) => String(p ?? "").replace(/\D/g, "");
const okPhone = (p: string) => /^0\d{10}$/.test(p);
const okPin = (p: unknown) => /^\d{6}$/.test(String(p ?? ""));
const emailFor = (phone: string) => `p${phone}@users.tagbook.ordiventa.com`;
let pepper = "";
async function passFor(phone: string, pin: string) {
  if (!pepper) { const { data, error } = await admin.rpc("login_pepper"); if (error || !data) throw new Error("NO_PEPPER"); pepper = data as string; }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${phone}:${pin}`)));
  return "tbk-" + Array.from(sig, b => b.toString(16).padStart(2, "0")).join("");
}
const isUuid = (s: unknown) => /^[0-9a-f-]{36}$/i.test(String(s ?? ""));
const isoIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
// Names pasted from WhatsApp can carry invisible characters; drop them and squeeze spaces.
const tidy = (v: unknown) => String(v ?? "").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
const SHOP_NAME_MAX = 50;
// Where shops are, for Bolu's marketing tracking. Only these values are stored.
const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
const okState = (v: unknown) => STATES.includes(String(v ?? ""));

// Starter items. Real shops get the names and services only, with NO prices (from 20 Nov 2026): owners type
// their own, and Tagbook asks for a price the first time an unpriced item is logged or billed.
// The sample prices below are only used for demo shops.
const DEFAULT_ITEMS: [string, Record<string, number | null> | null][] = [
  ["Shirt", { wi: 800, wo: 500, io: 300, wsi: 1000 }],
  ["Trouser", { wi: 800, wo: 500, io: 300, wsi: 1000 }],
  ["Round neck", { wi: 500, wo: 300, io: 200, wsi: null }],
  ["Native (2 piece)", { wi: 1500, wo: 1000, io: 600, wsi: 2000 }],
  ["Agbada (3 piece)", { wi: 3000, wo: 2000, io: 1200, wsi: 4000 }],
  ["Hoodie / cardigan", { wi: 1000, wo: 700, io: null, wsi: null }],
  ["Singlet / underwear", { wi: null, wo: 200, io: null, wsi: null }],
  ["Suit (2 piece)", { wi: 2500, wo: 1500, io: 1000, wsi: 3000 }],
  ["Duvet", { wi: null, wo: 3000, io: null, wsi: null }],
  ["Special item", null],
];
const offered = (p: Record<string, number | null> | null) =>
  p ? Object.entries(p).filter(([, v]) => v != null).map(([k]) => k) : ["wi", "wo", "io", "wsi"];

async function makeUser(phone: string, pin: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailFor(phone), password: await passFor(phone, pin), email_confirm: true, user_metadata: { phone }, app_metadata: { pin_v2: true },
  });
  if (error) throw new Error(/already/i.test(error.message) ? "PHONE_IN_USE" : "CREATE_FAILED: " + error.message);
  return data.user!.id;
}

async function userOf(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user?.id || null;
}
async function staffOf(uid: string | null) {
  if (!uid) return null;
  const { data: s } = await admin.from("staff").select("user_id, shop_id, role, active").eq("user_id", uid).maybeSingle();
  return s && s.active ? s : null;
}

// Creates a shop, its owner login, branches and the starter price list (names only for real shops).
async function newShop(o: { shopName: string; ownerName: string; phone: string; pin: string; branches: string[]; startNo: number; trial: string | null; founding: boolean; referredBy: string | null; createdBy: string | null; isTest?: boolean; withItems?: boolean }) {
  const userId = await makeUser(o.phone, o.pin);
  const { data: shop, error: e1 } = await admin.from("shops").insert({ name: o.shopName, trial_ends: o.trial, next_no: o.startNo, founding: o.founding, referred_by: o.referredBy, created_by: o.createdBy, is_test: !!o.isTest }).select("id").single();
  if (e1) { await admin.auth.admin.deleteUser(userId); throw e1; }
  await admin.from("staff").insert({ user_id: userId, shop_id: shop.id, role: "owner", name: o.ownerName, phone: o.phone });
  await admin.from("shop_private").insert({ shop_id: shop.id, acct_name: o.shopName });
  await admin.from("branches").insert((o.branches.length ? o.branches : ["Main branch"]).map((b, i) => ({ shop_id: shop.id, name: b, sort: i })));
  if (o.withItems !== false) for (let i = 0; i < DEFAULT_ITEMS.length; i++) {
    const [n, p] = DEFAULT_ITEMS[i];
    const { data: it } = await admin.from("items").insert({ shop_id: shop.id, name: n, custom: p === null, services: offered(p), sort: i }).select("id").single();
    if (p) await admin.from("item_prices").insert({ item_id: it!.id, shop_id: shop.id, prices: o.isTest ? p : {} });
  }
  return { shopId: shop.id as string, userId };
}

// Optional checks for self sign-up. Each switches on when its secret is added in Supabase.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") || "";
const TERMII_KEY = Deno.env.get("TERMII_KEY") || Deno.env.get("TERMII_API_KEY") || "";
const TERMII_BASE = (Deno.env.get("TERMII_BASE_URL") || "https://api.ng.termii.com").replace(/\/$/, "");
// Until the "Tagbook" sender ID is approved, Termii's default sender carries the codes (Termii support, 25 Nov 2026).
const TERMII_FROM = Deno.env.get("TERMII_SENDER_ID") || "OE Alert"; // Termii approved OE Alert for Ordiventa, 26 Nov 2026
// Bolu's own phone for a text alert on every self sign-up (set ADMIN_SMS_TO in Supabase, e.g. 0903...).
const ADMIN_SMS_TO = (Deno.env.get("ADMIN_SMS_TO") || "").replace(/\D/g, "");
async function textBolu(msg: string) {
  if (!TERMII_KEY || !/^0\d{10}$/.test(ADMIN_SMS_TO)) return;
  try {
    const r = await fetch(`${TERMII_BASE}/api/sms/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      api_key: TERMII_KEY, to: "234" + ADMIN_SMS_TO.slice(1), from: TERMII_FROM, sms: msg.slice(0, 300), type: "plain", channel: "dnd",
    }) });
    if (!r.ok) console.error("termii alert", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("termii alert", String(e)); }
}
async function humanCheck(token: unknown, ip: string) {
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  const f = new FormData(); f.append("secret", TURNSTILE_SECRET); f.append("response", String(token)); f.append("remoteip", ip);
  try { const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f }); const d = await r.json(); return !!d.success; } catch { return false; }
}
async function sendCode(phone: string): Promise<string | null> {
  try {
    const r = await fetch(`${TERMII_BASE}/api/sms/otp/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      api_key: TERMII_KEY, message_type: "NUMERIC", to: "234" + phone.slice(1), from: TERMII_FROM, channel: "dnd",
      pin_attempts: 3, pin_time_to_live: 10, pin_length: 6, pin_placeholder: "< 1234 >", pin_type: "NUMERIC",
      message_text: "Your Tagbook code is < 1234 >. It expires in 10 minutes. Don't share it with anyone.",
    }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !(d.pinId || d.pin_id)) { console.error("termii send", r.status, JSON.stringify(d).slice(0, 200)); return null; }
    return String(d.pinId || d.pin_id);
  } catch (e) { console.error("termii send", String(e)); return null; }
}
// Text-message codes for sign-up and Forgot PIN. Off until test codes reach every network; then set to true.
const SMS_LIVE = false;
const SMS_ON = SMS_LIVE && !!TERMII_KEY;
async function codeOk(pinId: string, code: string) {
  if (!pinId || !/^\d{6}$/.test(code)) return false;
  try {
    const r = await fetch(`${TERMII_BASE}/api/sms/otp/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: TERMII_KEY, pin_id: pinId, pin: code }) });
    const d = await r.json().catch(() => ({}));
    return d.verified === true || String(d.verified).toLowerCase() === "true";
  } catch { return false; }
}

// WhatsApp check for sign-ups and PIN resets. The person sends a 6-digit code from their own WhatsApp to Tagbook's number;
// the "wa" function confirms it. Needs WA_TOKEN and WA_NUMBER in Supabase, and WA_LIVE set to true here.
// WA_LIVE switched on 19 Nov after Meta replies were confirmed working end to end. Set to false to pause both checks.
// 22 Nov 2026: paused. Meta banned the WhatsApp Business account, so codes sent to the number never arrive.
// Sign-ups now go through unconfirmed (Bolu calls every new shop), and forgotten PINs go to Bolu on 0812.
const WA_LIVE = false;
const WA_NUMBER = (Deno.env.get("WA_NUMBER") || "").replace(/\D/g, "");
const WA_READY = WA_LIVE && !!(Deno.env.get("WA_TOKEN") && /^\d{10,15}$/.test(WA_NUMBER));
const WA_ON = WA_READY; // sign-up check (an SMS key, if ever added, takes priority)
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
const ipOf = (req: Request) => (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST_ONLY", 405);
  let body: any;
  try { body = await req.json(); } catch { return fail("BAD_JSON"); }
  const action = body?.action;

  try {
    // ---- Anyone: reset a forgotten PIN by proving the phone on WhatsApp ----
    // Step 1 gives a code to send from that number's WhatsApp. Step 2 sets the new PIN once the "wa" function has
    // confirmed the message came from the same number. Each code works once and only for 30 minutes.
    // With a Termii key, the code comes by text message instead: start sends it, "pin_reset_code" checks it and
    // marks a check row as verified, and finish (unchanged) sets the PIN against that row.
    if (action === "pin_reset_start" || action === "pin_reset_finish" || action === "pin_reset_code") {
      if (!WA_READY && !SMS_ON) return fail("RESET_OFF");
      const ip = ipOf(req), phone = cleanPhone(body.phone);
      if (!okPhone(phone)) return fail("BAD_PHONE");
      const { data: who } = await admin.from("staff").select("user_id").eq("phone", phone).eq("active", true).limit(1).maybeSingle();
      if (!who) return fail("NO_ACCOUNT", 404);
      if (action === "pin_reset_start") {
        const { data: why } = await admin.rpc("signup_check", { p_ip: ip, p_phone: phone, p_kind: "code" });
        if (why) return fail(String(why), 429);
        if (SMS_ON) {
          const pinId = await sendCode(phone);
          return pinId ? json({ ok: true, pin_id: pinId }) : fail("CODE_FAILED", 502);
        }
        const code = sixDigits();
        const { data: ck, error: ce } = await admin.from("wa_checks").insert({ phone, code, kind: "pin" }).select("id").single();
        if (ce || !ck) throw ce || new Error("WA_CHECK_FAILED");
        return json({ ok: true, wa_to: WA_NUMBER, wa_code: code, check_id: ck.id });
      }
      if (action === "pin_reset_code") {
        if (!SMS_ON) return fail("RESET_OFF");
        if (!(await codeOk(String(body.pin_id || ""), String(body.code || "")))) return fail("BAD_CODE");
        const { data: ck, error: ce } = await admin.from("wa_checks").insert({ phone, code: "sms", kind: "pin", verified_at: new Date().toISOString(), from_wa: "sms" }).select("id").single();
        if (ce || !ck) throw ce || new Error("CHECK_FAILED");
        return json({ ok: true, check_id: ck.id });
      }
      if (!isUuid(body.check_id)) return fail("NOT_VERIFIED");
      if (!okPin(body.pin)) return fail("BAD_PIN");
      const { data: ck } = await admin.from("wa_checks").select("phone, kind, verified_at, used_at, created_at").eq("id", body.check_id).maybeSingle();
      if (!ck || ck.kind !== "pin" || ck.phone !== phone || !ck.verified_at || ck.used_at || Date.now() - Date.parse(ck.created_at) > 30 * 60e3) return fail("NOT_VERIFIED");
      const { data: claimed } = await admin.from("wa_checks").update({ used_at: new Date().toISOString() }).eq("id", body.check_id).is("used_at", null).select("id");
      if (!claimed || !claimed.length) return fail("NOT_VERIFIED");
      const { error } = await admin.auth.admin.updateUserById(who.user_id, { password: await passFor(phone, String(body.pin)), app_metadata: { pin_v2: true } });
      if (error) throw error;
      await admin.rpc("login_result", { p_phone: phone, p_ip: "reset", p_ok: true }); // a new PIN clears any lock
      return json({ ok: true });
    }

    // ---- Anyone: a shop owner signs up on their own (tagbook.ordiventa.com/start) ----
    // No login yet, so this is guarded instead by: a hidden honeypot field, a minimum fill time, limits per
    // device and per day, an optional Cloudflare bot check, and (once switched on) an SMS or WhatsApp check of the phone.
    if (action === "signup_code" || action === "self_signup") {
      const ip = ipOf(req);
      const phone = cleanPhone(body.phone);
      if (!okPhone(phone)) return fail("BAD_PHONE");
      if (body.website) return fail("BAD_FORM"); // honeypot: people never see this field, bots fill it
      if (!(await humanCheck(body.bot_token, ip))) return fail("BOT_CHECK", 403);

      if (action === "signup_code") {
        if (!SMS_ON && !WA_ON) return fail("CODES_OFF");
        const { data: why } = await admin.rpc("signup_check", { p_ip: ip, p_phone: phone, p_kind: "code" });
        if (why) return fail(String(why), 429);
        if (SMS_ON) {
          const pinId = await sendCode(phone);
          return pinId ? json({ ok: true, pin_id: pinId }) : fail("CODE_FAILED", 502);
        }
        const code = sixDigits();
        const { data: ck, error: ce } = await admin.from("wa_checks").insert({ phone, code }).select("id").single();
        if (ce || !ck) throw ce || new Error("WA_CHECK_FAILED");
        return json({ ok: true, wa_to: WA_NUMBER, wa_code: code, check_id: ck.id });
      }

      const shopName = tidy(body.shop), name = tidy(body.name).slice(0, 40), area = tidy(body.area).slice(0, 60), pin = String(body.pin || "");
      if (!shopName || !name) return fail("MISSING_NAME");
      if (!okState(body.state)) return fail("BAD_STATE");
      if (!area) return fail("MISSING_TOWN");
      if (shopName.length > SHOP_NAME_MAX) return fail("NAME_TOO_LONG");
      if (!okPin(pin)) return fail("BAD_PIN");
      if (Number(body.ms) < 4000) return fail("TOO_FAST"); // a person can't fill the form in under 4 seconds
      let verified = false;
      if (SMS_ON) {
        if (!(await codeOk(String(body.pin_id || ""), String(body.code || "")))) return fail("BAD_CODE");
        verified = true;
      } else if (WA_ON) {
        if (!isUuid(body.check_id)) return fail("NOT_VERIFIED");
        const { data: ck } = await admin.from("wa_checks").select("phone, kind, verified_at, created_at").eq("id", body.check_id).maybeSingle();
        if (!ck || ck.kind !== "signup" || ck.phone !== phone || !ck.verified_at || Date.now() - Date.parse(ck.created_at) > 2 * 3600e3) return fail("NOT_VERIFIED");
        verified = true;
      }
      const { data: why } = await admin.rpc("signup_check", { p_ip: ip, p_phone: phone, p_kind: "shop" });
      if (why) return fail(String(why), 429);
      const r = await newShop({ shopName, ownerName: name, phone, pin, branches: ["Main branch"], startNo: 1, trial: isoIn(30), founding: true, referredBy: null, createdBy: null });
      const state = String(body.state);
      await admin.from("shops").update({ self_signup: true, confirmed: verified, area, state }).eq("id", r.shopId);
      const where = `${area}, ${state}`;
      const { error: en } = await admin.rpc("signup_done", { p_ip: ip, p_phone: phone, p_text: `${shopName} (${where}). ${name}, ${phone}. Call to welcome them.` });
      if (en) console.error("signup_done", en.message);
      await textBolu(`Tagbook: new shop signed up. ${shopName} (${where}). ${name}, ${phone}. Call to welcome them.`);
      return json({ ok: true });
    }

    const uid = await userOf(req);
    const { data: keyOk } = await admin.rpc("check_admin_key", { k: req.headers.get("x-admin-key") || "" });
    const { data: isAdmin } = uid ? await admin.rpc("admin_is", { uid }) : { data: false };
    const { data: isAgent } = uid ? await admin.rpc("agent_is", { uid }) : { data: false };

    // ---- Ordiventa only: check the Termii key, balance and sender IDs, and send a test code ----
    if (action === "termii_check" || action === "termii_test") {
      if (!keyOk && !isAdmin) return fail("FORBIDDEN", 403);
      if (!TERMII_KEY) return fail("NO_TERMII_KEY");
      if (action === "termii_check") {
        const bal = await fetch(`${TERMII_BASE}/api/get-balance?api_key=${encodeURIComponent(TERMII_KEY)}`).then(r => r.json()).catch(e => ({ error: String(e) }));
        const ids = await fetch(`${TERMII_BASE}/api/sender-id?api_key=${encodeURIComponent(TERMII_KEY)}`).then(r => r.json()).catch(e => ({ error: String(e) }));
        return json({ balance: bal, sender_ids: ids, from: TERMII_FROM });
      }
      const phone = cleanPhone(body.phone);
      if (!okPhone(phone)) return fail("BAD_PHONE");
      const from = String(body.from || TERMII_FROM), channel = String(body.channel || "dnd");
      const r = await fetch(`${TERMII_BASE}/api/sms/otp/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        api_key: TERMII_KEY, message_type: "NUMERIC", to: "234" + phone.slice(1), from, channel,
        pin_attempts: 3, pin_time_to_live: 10, pin_length: 6, pin_placeholder: "< 1234 >", pin_type: "NUMERIC",
        message_text: "Your Tagbook code is < 1234 >. It expires in 10 minutes. Don't share it with anyone.",
      }) });
      return json({ status: r.status, termii: await r.json().catch(() => null), from, channel });
    }

    // ---- Ordiventa and its agents: set up a new shop with its owner ----
    if (action === "create_shop") {
      if (!keyOk && !isAdmin && !isAgent) return fail("NOT_ALLOWED", 403);
      const shopName = tidy(body.shop);
      const phone = cleanPhone(body.owner?.phone), pin = String(body.owner?.pin || ""), name = tidy(body.owner?.name).slice(0, 40);
      if (!shopName || !name) return fail("MISSING_NAME");
      // Never cut a shop name silently: refuse it so the person shortens it themselves.
      if (shopName.length > SHOP_NAME_MAX) return fail("NAME_TOO_LONG");
      if (!okPhone(phone)) return fail("BAD_PHONE");
      if (!okPin(pin)) return fail("BAD_PIN");
      const branches: string[] = (Array.isArray(body.branches) && body.branches.length ? body.branches : ["Main branch"]).map((b: unknown) => tidy(b).slice(0, 40)).filter(Boolean);
      const startNo = Math.max(1, Math.min(1000000, parseInt(body.start_no) || 1));
      let trial = /^\d{4}-\d{2}-\d{2}$/.test(String(body.trial_ends || "")) ? body.trial_ends : null;
      // Agents can give at most the standard 1-month trial.
      if (!isAdmin && !keyOk) { const max = isoIn(31); if (!trial || trial > max) trial = isoIn(30); }
      let referredBy: string | null = null;
      if (isUuid(body.referred_by)) { const { data: r } = await admin.from("shops").select("id").eq("id", body.referred_by).maybeSingle(); referredBy = r ? r.id : null; }
      const r = await newShop({ shopName, ownerName: name, phone, pin, branches, startNo, trial, founding: body.founding !== false, referredBy, createdBy: uid });
      if (okState(body.state) || tidy(body.area)) await admin.from("shops").update({ state: okState(body.state) ? String(body.state) : "", area: tidy(body.area).slice(0, 60) }).eq("id", r.shopId);
      // Who found it and who set it up. Bolu sets both; an agent is the helper and only claims who found it.
      if (uid && (isAdmin || isAgent)) {
        const id = (x: unknown) => isUuid(x) ? String(x) : null;
        const { error: et } = await admin.rpc("set_new_shop_team", {
          p_shop: r.shopId, p_by: uid, p_is_admin: !!isAdmin, p_kind: String(body.claim_kind || "ordiventa"),
          p_for: id(body.claim_for), p_brought: id(body.brought_by), p_setup: id(body.setup_by),
        });
        if (et) console.error("set_new_shop_team", et);
      }
      return json({ ok: true, shop_id: r.shopId });
    }

    // ---- Ordiventa only: give a shop owner a new PIN, and fix their login phone if it was typed wrong ----
    if (action === "owner_login") {
      if (!isAdmin && !keyOk) return fail("NOT_ALLOWED", 403);
      if (!isUuid(body.shop_id)) return fail("NOT_FOUND", 404);
      const pin = String(body.pin || ""), phone = cleanPhone(body.phone);
      if (!okPin(pin)) return fail("BAD_PIN");
      if (!okPhone(phone)) return fail("BAD_PHONE");
      const { data: own } = await admin.from("staff").select("user_id, phone").eq("shop_id", body.shop_id).eq("role", "owner").eq("active", true).order("created_at").limit(1).maybeSingle();
      if (!own) return fail("NOT_FOUND", 404);
      if (phone !== own.phone) {
        const { data: taken } = await admin.from("staff").select("user_id").eq("phone", phone).limit(1).maybeSingle();
        if (taken) return fail("PHONE_IN_USE", 409);
      }
      const { error } = await admin.auth.admin.updateUserById(own.user_id, {
        email: emailFor(phone), email_confirm: true, user_metadata: { phone }, password: await passFor(phone, pin), app_metadata: { pin_v2: true } });
      if (error) throw new Error(/already/i.test(error.message) ? "PHONE_IN_USE" : error.message);
      if (phone !== own.phone) {
        const { error: se } = await admin.from("staff").update({ phone }).eq("user_id", own.user_id);
        if (se) throw se;
      }
      await admin.rpc("login_result", { p_phone: phone, p_ip: "reset", p_ok: true }); // clears any lock
      return json({ ok: true, phone });
    }

    // ---- Ordiventa only: add someone who can set up shops ----
    if (action === "create_agent") {
      if (!isAdmin) return fail("NOT_ALLOWED", 403);
      const phone = cleanPhone(body.phone), pin = String(body.pin || ""), name = tidy(body.name).slice(0, 40);
      if (!name) return fail("MISSING_NAME");
      if (!okPhone(phone)) return fail("BAD_PHONE");
      if (!okPin(pin)) return fail("BAD_PIN");
      const { data: src } = await admin.from("shops").select("id,name").eq("is_test", true).ilike("name", "BrightWash%").order("created_at").limit(1).maybeSingle();
      const demo = await newShop({ shopName: "BrightWash Laundry", ownerName: name, phone, pin, branches: ["Main branch"], startNo: 1, trial: null, founding: false, referredBy: null, createdBy: uid, isTest: true, withItems: !src });
      if (src) {
        const { error } = await admin.rpc("clone_demo", { src: src.id, dst: demo.shopId });
        if (error) console.error("clone", error.message);
        const { data: sp } = await admin.from("shop_private").select("bank_name,acct_no,acct_name,express_type,express_value").eq("shop_id", src.id).maybeSingle();
        if (sp) await admin.from("shop_private").update(sp).eq("shop_id", demo.shopId);
      }
      const { error: e2 } = await admin.rpc("add_agent", { uid: demo.userId, nm: name, ph: phone, demo: demo.shopId });
      if (e2) throw e2;
      return json({ ok: true, user_id: demo.userId });
    }

    // ---- Everything below needs a signed-in staff member ----
    const me = await staffOf(uid);
    if (!me) return fail("NOT_SIGNED_IN", 401);

    // Anyone signed in can change their own PIN.
    if (action === "change_my_pin") {
      if (!okPin(body.pin)) return fail("BAD_PIN");
      const { data: row } = await admin.from("staff").select("phone").eq("user_id", me.user_id).maybeSingle();
      if (!row?.phone) return fail("NOT_FOUND", 404);
      const { error } = await admin.auth.admin.updateUserById(me.user_id, { password: await passFor(row.phone, String(body.pin)), app_metadata: { pin_v2: true } });
      if (error) throw error;
      return json({ ok: true });
    }
    if (me.role !== "owner") return fail("OWNER_ONLY", 403);

    if (action === "add_staff") {
      const phone = cleanPhone(body.phone), pin = String(body.pin || ""), name = tidy(body.name).slice(0, 40);
      const role = body.role === "owner" ? "owner" : "secretary";
      if (!name) return fail("MISSING_NAME");
      if (!okPhone(phone)) return fail("BAD_PHONE");
      if (!okPin(pin)) return fail("BAD_PIN");
      const userId = await makeUser(phone, pin);
      const { error } = await admin.from("staff").insert({ user_id: userId, shop_id: me.shop_id, role, name, phone });
      if (error) { await admin.auth.admin.deleteUser(userId); throw error; }
      return json({ ok: true, user_id: userId });
    }

    const { data: target } = await admin.from("staff").select("user_id, shop_id, role, phone").eq("user_id", body.user_id || "").maybeSingle();
    if (!target || target.shop_id !== me.shop_id) return fail("NOT_FOUND", 404);

    if (action === "reset_pin") {
      if (!okPin(body.pin)) return fail("BAD_PIN");
      const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: await passFor(target.phone, String(body.pin)), app_metadata: { pin_v2: true } });
      if (error) throw error;
      await admin.rpc("login_result", { p_phone: target.phone, p_ip: "reset", p_ok: true }); // a new PIN clears any lock
      return json({ ok: true });
    }

    if (action === "remove_staff") {
      if (target.user_id === me.user_id) return fail("CANNOT_REMOVE_SELF");
      await admin.from("orders").update({ created_by: null }).eq("created_by", target.user_id);
      await admin.from("staff").delete().eq("user_id", target.user_id);
      await admin.auth.admin.deleteUser(target.user_id);
      return json({ ok: true });
    }

    return fail("UNKNOWN_ACTION");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "PHONE_IN_USE") return fail("PHONE_IN_USE", 409);
    console.error(m);
    return fail("SERVER_ERROR", 500);
  }
});
