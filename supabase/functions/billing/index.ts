import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Tagbook plan payments through Paystack.
//  - start:   owner picks a plan, we create a pending payment and return Paystack's checkout link
//  - verify:  after checkout, the app asks us to check the payment with Paystack
//  - webhook: Paystack tells us directly when a charge succeeds (signed with the secret key)
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const APP = "https://tagbook.ordiventa.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
// One price for every shop: ₦3,000 a month. 6 months = 5 months' price, 1 year = 10 months' price.
const PRICE: Record<string, number> = { m1: 3000, m6: 15000, m12: 30000 };
const MONTHS: Record<string, number> = { m1: 1, m6: 6, m12: 12 };

async function paystack(path: string, init: RequestInit = {}) {
  const r = await fetch("https://api.paystack.co" + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  return await r.json();
}
async function hmac512(body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function checkAndApply(reference: string) {
  const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  const d = v && v.data;
  if (!v.status || !d) return { error: "NOT_FOUND" };
  if (d.status !== "success") return { error: "NOT_PAID", status: d.status };
  if (d.currency && d.currency !== "NGN") return { error: "BAD_CURRENCY" };
  const { data, error } = await admin.rpc("apply_payment", { p_ref: reference, p_kobo: d.amount });
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST_ONLY" }, 405);
  const raw = await req.text();

  // ---- Paystack webhook ----
  const sig = req.headers.get("x-paystack-signature");
  if (sig) {
    if (!KEY || (await hmac512(raw)) !== sig) return json({ error: "BAD_SIGNATURE" }, 401);
    try {
      const ev = JSON.parse(raw);
      if (ev.event === "charge.success" && ev.data?.reference) {
        const { data: p } = await admin.from("payments").select("id").eq("ref", ev.data.reference).maybeSingle();
        // Not a Tagbook payment (e.g. LegacyOS): refuse it so Paystack keeps retrying instead of marking it delivered.
        if (!p) { console.warn("webhook for unknown reference", ev.data.reference); return json({ error: "NOT_TAGBOOK" }, 404); }
        await checkAndApply(ev.data.reference);
      } else if (ev.event !== "charge.success") { return json({ error: "NOT_TAGBOOK" }, 404); }
    } catch (e) { console.error("webhook", e); }
    return json({ ok: true });
  }

  let body: any; try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "BAD_JSON" }, 400); }
  if (!KEY) return json({ error: "NOT_READY" }, 503);

  // ---- Every 10 minutes the database asks us to re-check unfinished Paystack payments ----
  // (Tagbook doesn't rely on Paystack's webhook, so the webhook box stays free for LegacyOS.)
  if (body.action === "sweep") {
    const { data: ok } = await admin.rpc("check_admin_key", { k: req.headers.get("x-admin-key") || "" });
    if (!ok) return json({ error: "NOT_ALLOWED" }, 403);
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const { data: pend } = await admin.from("payments").select("ref").eq("status", "pending").eq("method", "paystack").gte("created_at", since).limit(50);
    let paid = 0;
    for (const p of pend || []) { try { const r: any = await checkAndApply(p.ref); if (r && r.ok && !r.already) paid++; } catch (e) { console.error("sweep", p.ref, e); } }
    return json({ checked: (pend || []).length, paid });
  }
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await admin.auth.getUser(token) : { data: null };
    const uid = u?.user?.id;
    if (!uid) return json({ error: "NOT_SIGNED_IN" }, 401);
    const { data: st } = await admin.from("staff").select("shop_id, role, active, phone").eq("user_id", uid).maybeSingle();
    if (!st || !st.active) return json({ error: "NOT_SIGNED_IN" }, 401);

    if (body.action === "start") {
      if (st.role !== "owner") return json({ error: "OWNER_ONLY" }, 403);
      const plan = String(body.plan || "m1");
      if (!PRICE[plan]) return json({ error: "BAD_PLAN" }, 400);
      const { data: shop } = await admin.from("shops").select("id, name, founding, is_test").eq("id", st.shop_id).single();
      const amount = PRICE[plan];
      const ref = "TB-" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const { error: e1 } = await admin.from("payments").insert({ shop_id: shop.id, plan, months: MONTHS[plan], amount, ref, method: "paystack", created_by: uid });
      if (e1) throw e1;
      const email = String(body.email || "").trim();
      const init = await paystack("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : `p${st.phone}@users.tagbook.ordiventa.com`,
          amount: amount * 100, reference: ref, currency: "NGN", callback_url: `${APP}/?paid=1`,
          metadata: { shop_id: shop.id, shop: shop.name, plan, custom_fields: [{ display_name: "Shop", variable_name: "shop", value: shop.name }] },
        }),
      });
      if (!init.status || !init.data?.authorization_url) { console.error("init", init); return json({ error: "PAYSTACK_FAILED", detail: init.message }, 502); }
      return json({ ok: true, url: init.data.authorization_url, ref });
    }

    if (body.action === "verify") {
      const ref = String(body.reference || "");
      const { data: p } = await admin.from("payments").select("shop_id").eq("ref", ref).maybeSingle();
      if (!p || p.shop_id !== st.shop_id) return json({ error: "NOT_FOUND" }, 404);
      return json(await checkAndApply(ref));
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
