import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Sends a push notification to the shop owner's phones (or, for due-date reminders, owner and staff). Called by the database with the admin key.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const naira = (n: number) => "₦" + Math.round(n || 0).toLocaleString("en-NG");
let ready = false;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST_ONLY" }, 405);
  const { data: ok } = await admin.rpc("check_admin_key", { k: req.headers.get("x-admin-key") || "" });
  if (!ok) return json({ error: "NOT_ALLOWED" }, 403);
  try {
    if (!ready) {
      const { data: v } = await admin.rpc("get_vapid");
      webpush.setVapidDetails("https://tagbook.ordiventa.com", v.public, v.private);
      ready = true;
    }
    const body = await req.json();
    let shopId: string, title: string, text: string, url = "/#orders", tag = "tagbook";
    // Staff only ever get due-date reminders (names and order numbers, never money).
    const toAll = body.to === "all";
    if (body.test_shop) {
      shopId = body.test_shop; title = "Tagbook"; text = "Notifications are working.";
    } else if (body.nudge_shop) {
      // Reminder sent by a daily check.
      shopId = String(body.nudge_shop); title = String(body.title || "Tagbook").slice(0, 80); text = String(body.text || "").slice(0, 240);
      url = typeof body.url === "string" && body.url.startsWith("/#") ? body.url : "/#log"; tag = toAll ? "due" : "nudge";
    } else {
      const { data: o } = await admin.from("orders").select("id,no,shop_id,items,customer_id").eq("id", body.order_id).single();
      if (!o) return json({ error: "NO_ORDER" }, 404);
      const { data: c } = await admin.from("customers").select("name,mark").eq("id", o.customer_id).single();
      const who = `${c?.name} (${c?.mark})`;
      const count = (o.items || []).reduce((s: number, it: { qty: number }) => s + (it.qty || 0), 0);
      shopId = o.shop_id; url = `/#order-${o.no}`; tag = `order-${o.no}-${body.kind}`;
      if (body.kind === "ready") { title = "Clothes ready"; text = `${who}, order #${o.no}. Send the ready message.`; }
      else if (body.kind === "payment") { title = "Payment recorded"; text = `${naira(body.amount)} from ${who}, order #${o.no}${body.by ? `, by ${body.by}` : ""}.`; tag += "-" + Date.now(); }
      else {
        title = "New order";
        const { data: m } = await admin.from("order_money").select("paid").eq("order_id", o.id).maybeSingle();
        const p = m && m.paid ? ` Paid ${naira(m.paid)}.` : "";
        text = `${who}, ${count} item${count === 1 ? "" : "s"}.${p} Send the list of clothes.`;
      }
    }
    let q = admin.from("staff").select("user_id").eq("shop_id", shopId).eq("active", true);
    if (!(toAll && body.nudge_shop)) q = q.eq("role", "owner");
    const { data: people } = await q;
    const ids = (people || []).map((x) => x.user_id);
    if (!ids.length) return json({ sent: 0 });
    const { data: subs } = await admin.from("push_subs").select("endpoint,p256dh,auth,user_id,shop_id,created_at").in("user_id", ids);
    const payload = JSON.stringify({ title, body: text, url, tag });
    let sent = 0, gone = 0; const errors: string[] = [];
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          gone++;
          // Apple or Google says this phone's link no longer works. Keep a record so we can see how often and why.
          const host = (() => { try { return new URL(s.endpoint).host; } catch { return "?"; } })();
          await admin.from("push_log").insert({ user_id: s.user_id, shop_id: s.shop_id, kind: "expired", detail: `${code} from ${host}, link made ${String(s.created_at).slice(0, 16)}` });
          await admin.from("push_subs").delete().eq("endpoint", s.endpoint);
        }
        else errors.push(String(code || (e as Error).message));
      }
    }));
    return json({ sent, gone, errors, title, text });
  } catch (e) {
    console.error(e);
    return json({ error: "SERVER_ERROR", detail: String((e as Error).message || e) }, 500);
  }
});
