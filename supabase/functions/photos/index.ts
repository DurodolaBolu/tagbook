import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Drop-off photos.
// GET ?t=<link token>: public. Returns one order's photos as short-lived links, for the customer page.
// POST {cleanup:true} with x-admin-key: nightly. Deletes photos 7 days after collection, or 60 days after drop-off.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ORIGINS = ["https://tagbook.ordiventa.com", "http://localhost:8787"];
const cors = (req: Request) => { const o = req.headers.get("origin") || ""; return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Vary": "Origin" }; };
const json = (req: Request, b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors(req), "Access-Control-Allow-Methods": "GET" } });
    if (req.method === "GET") {
      const t = new URL(req.url).searchParams.get("t") || "";
      if (!/^[0-9a-f]{36}$/.test(t)) return json(req, { error: "NOT_FOUND" }, 404);
      const { data: o } = await admin.from("orders").select("id,no,shop_id,created_at,cancelled_at").eq("photo_token", t).maybeSingle();
      if (!o || o.cancelled_at) return json(req, { error: "NOT_FOUND" }, 404);
      const [{ data: s }, { data: ph }] = await Promise.all([
        admin.from("shops").select("name").eq("id", o.shop_id).single(),
        admin.from("order_photos").select("path,item,notes,created_at").eq("order_id", o.id).order("created_at"),
      ]);
      if (!ph || !ph.length) return json(req, { error: "GONE", shop: s?.name || "" }, 410);
      const { data: urls } = await admin.storage.from("order-photos").createSignedUrls(ph.map((p) => p.path), 900);
      const photos = ph.map((p, i) => ({ url: urls?.[i]?.signedUrl || "", item: p.item, notes: p.notes, at: p.created_at }));
      return json(req, { shop: s?.name || "", no: o.no, dropped: o.created_at, photos });
    }
    if (req.method === "POST") {
      const { data: ok } = await admin.rpc("check_admin_key", { k: req.headers.get("x-admin-key") || "" });
      if (!ok) return json(req, { error: "NOT_ALLOWED" }, 403);
      const { data: old, error } = await admin.rpc("photos_to_delete");
      if (error) throw error;
      const paths = (old || []).map((r: { path: string }) => r.path);
      let removed = 0;
      for (let i = 0; i < paths.length; i += 100) {
        const part = paths.slice(i, i + 100);
        const { error: e } = await admin.storage.from("order-photos").remove(part);
        if (e) throw e;
        await admin.from("order_photos").delete().in("path", part);
        removed += part.length;
      }
      return json(req, { removed });
    }
    return json(req, { error: "METHOD" }, 405);
  } catch (e) {
    console.error(e);
    return json(req, { error: "SERVER_ERROR" }, 500);
  }
});
