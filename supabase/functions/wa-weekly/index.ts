import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Weekly WhatsApp report for shop owners, sent from Tagbook's number with an approved template.
// Only the database (holding the admin key) can call this.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("WA_TOKEN") || "";
const PHONE_ID = Deno.env.get("WA_PHONE_ID") || "";
const WABA = "1147029134697413";
const NAME = "tagbook_weekly_report";
const G = "https://graph.facebook.com/v21.0";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const auth = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const BODY = "Hello {{1}}, here is your Tagbook report for last week ({{2}}).\n\n" +
  "Orders taken: {{3}}\nMoney received: {{4}}\nStill owed to the shop: {{5}}\nCustomers still owing: {{6}}\n\n" +
  "Open Tagbook to see who owes and send them a reminder.";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST_ONLY" }, 405);
  const { data: ok } = await admin.rpc("check_admin_key", { k: req.headers.get("x-admin-key") || "" });
  if (!ok) return json({ error: "NOT_ALLOWED" }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "create_template") {
      const r = await fetch(`${G}/${WABA}/message_templates`, { method: "POST", headers: auth, body: JSON.stringify({
        name: NAME, language: "en", category: "UTILITY",
        components: [
          { type: "BODY", text: BODY, example: { body_text: [["BrightWash Laundry", "16 to 22 Nov", "18", "₦96,500", "₦24,000", "4"]] } },
          { type: "FOOTER", text: "Reply STOP to stop these weekly reports." },
        ] }) });
      return json({ status: r.status, body: await r.json() });
    }
    if (b.action === "template_status") {
      const r = await fetch(`${G}/${WABA}/message_templates?name=${NAME}&fields=name,status,category,rejected_reason`, { headers: auth });
      return json({ status: r.status, body: await r.json() });
    }
    if (b.action === "phone_info") {
      const r = await fetch(`${G}/${PHONE_ID}?fields=display_phone_number,verified_name,name_status,new_name_status,quality_rating,messaging_limit_tier,is_official_business_account`, { headers: auth });
      return json({ status: r.status, body: await r.json() });
    }
    if (b.action === "send") {
      const to = String(b.to || "").replace(/\D/g, "");
      const params = (Array.isArray(b.params) ? b.params : []).map((p: unknown) => ({ type: "text", text: String(p ?? "").slice(0, 60) || "-" }));
      if (!/^234\d{10}$/.test(to) || params.length !== 6) return json({ error: "BAD_INPUT" }, 400);
      const r = await fetch(`${G}/${PHONE_ID}/messages`, { method: "POST", headers: auth, body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: NAME, language: { code: "en" }, components: [{ type: "body", parameters: params }] } }) });
      const out = await r.json();
      if (!r.ok) console.error("weekly send", b.shop, r.status, JSON.stringify(out).slice(0, 300));
      return json({ status: r.status, body: out });
    }
    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "SERVER_ERROR", detail: String((e as Error).message || e) }, 500);
  }
});
