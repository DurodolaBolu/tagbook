import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// WhatsApp webhook for Tagbook's number (WhatsApp Cloud API).
// Someone sends "Tagbook code 123456" (sign-up) or "Tagbook PIN 123456" (PIN reset) from their own WhatsApp.
// If the code matches the one Tagbook showed them, and the message came from the same phone number they typed,
// that number is confirmed. Owners can also reply STOP / START to the weekly report.
// Replies are service messages: Meta gives 1,000 free a month per number, then charges per message.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("WA_TOKEN") || "";
const PHONE_ID = Deno.env.get("WA_PHONE_ID") || "";
const VERIFY = Deno.env.get("WA_VERIFY") || "";
const APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const MAIN_LINE = "0812 075 6325";
const SAVE = "\n\nPlease save this number as *Tagbook*, so you know it's us when your weekly report comes.";

async function signedOk(raw: string, header: string | null) {
  if (!APP_SECRET || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig, b => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function reply(to: string, text: string) {
  if (!TOKEN || !PHONE_ID) return;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
      method: "POST", headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!r.ok) console.error("wa reply", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("wa reply", String(e)); }
}

const local = (from: string) => from.startsWith("234") ? "0" + from.slice(3) : from;

async function handle(from: string, text: string) {
  const t = text.trim().toLowerCase();
  if (/^(stop|unsubscribe)\b/.test(t)) {
    await admin.rpc("wa_optout_set", { p_phone: local(from), p_stop: true });
    await reply(from, "Done. You won't get the weekly Tagbook report any more. Reply START if you want it back.");
    return;
  }
  if (/^start\b/.test(t)) {
    await admin.rpc("wa_optout_set", { p_phone: local(from), p_stop: false });
    await reply(from, "Done. You'll get your Tagbook report every Monday morning." + SAVE);
    return;
  }
  const m = /\b(\d{6})\b/.exec(text);
  if (!m) {
    await reply(from, `Hello! This number sends Tagbook reports and confirms sign-ups. To chat with us, message ${MAIN_LINE} on WhatsApp.`);
    return;
  }
  const since = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data: rows } = await admin.from("wa_checks").select("id, phone, kind, verified_at").eq("code", m[1]).is("used_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(5);
  const intl = (p: string) => "234" + p.slice(1);
  const mine = (rows || []).find(r => intl(r.phone) === from);
  if (mine) {
    if (!mine.verified_at) await admin.from("wa_checks").update({ verified_at: new Date().toISOString(), from_wa: from }).eq("id", mine.id);
    await reply(from, (mine.kind === "pin"
      ? "Thank you! Your number is confirmed. Go back to Tagbook and choose your new PIN."
      : "Thank you! Your number is confirmed. Go back to Tagbook and tap \"Finish sign-up\".") + SAVE);
  } else if (rows && rows.length) {
    await reply(from, "This code was made for a different phone number. Please send it from the WhatsApp of the number you typed in Tagbook.");
  } else {
    await reply(from, `We couldn't find that code, or it has expired. Go back to Tagbook to get a new one, or message ${MAIN_LINE} for help.`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta checks the webhook once when it's connected.
  if (req.method === "GET") {
    if (VERIFY && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY)
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text();
  if (!(await signedOk(raw, req.headers.get("x-hub-signature-256")))) return new Response("bad signature", { status: 401 });
  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      for (const msg of ch.value?.messages || []) {
        const from = String(msg.from || "").replace(/\D/g, "");
        const text = msg.type === "text" ? String(msg.text?.body || "") : msg.type === "button" ? String(msg.button?.text || "") : "";
        if (from) await handle(from, text);
      }
    }
  } catch (e) { console.error("wa webhook", String(e)); }
  return new Response("ok", { status: 200 }); // always 200, so Meta doesn't keep resending
});
