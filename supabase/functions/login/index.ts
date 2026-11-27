import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Tagbook login: phone + 6-digit PIN. Every attempt goes through here so wrong PINs are counted.
// 5 wrong PINs on a phone = locked 15 minutes, doubling on each repeat (max 24 hours).
// 30 wrong PINs from one connection in 15 minutes = that connection blocked 15 minutes.
// The real Supabase password mixes the PIN with a server-only secret, so PINs can't be
// guessed against Supabase directly.
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const ORIGINS = ["https://tagbook.ordiventa.com", "https://tagbook.pages.dev"];
const corsFor = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};

const emailFor = (phone: string) => `p${phone}@users.tagbook.ordiventa.com`;
const legacyPass = (pin: string) => `tb-${pin}-tagbook`;
let pepper = "";
async function realPass(phone: string, pin: string) {
  if (!pepper) { const { data, error } = await admin.rpc("login_pepper"); if (error || !data) throw new Error("NO_PEPPER"); pepper = data as string; }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${phone}:${pin}`)));
  return "tbk-" + Array.from(sig, b => b.toString(16).padStart(2, "0")).join("");
}

async function signIn(email: string, password: string, ip: string) {
  // Pass the person's own address on, so Supabase's own limits apply per person, not to this server.
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "X-Forwarded-For": ip } } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { session: null, wrong: error.status === 400 && /invalid/i.test(error.message), user: null };
  return { session: data.session, wrong: false, user: data.user };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST_ONLY" }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }

  const phone = String(body?.phone ?? "").replace(/\D/g, "");
  const pin = String(body?.pin ?? "");
  if (!/^0\d{10}$/.test(phone) || !/^\d{6}$/.test(pin)) return json({ error: "BAD_LOGIN" }, 401);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  try {
    // Counts this attempt before the PIN is checked, so parallel guesses can't get past the limit.
    const { data: wait, error: we } = await admin.rpc("login_begin", { p_phone: phone, p_ip: ip });
    if (we) throw we;
    if (wait > 0) return json({ error: "LOCKED", wait }, 429);

    const email = emailFor(phone);
    const pass = await realPass(phone, pin);
    let r = await signIn(email, pass, ip);
    let onNewPassword = !!r.session;

    // Accounts made before the lockout still have the old password: check it once, then switch them over.
    if (!r.session && r.wrong) {
      const old = await signIn(email, legacyPass(pin), ip);
      if (old.session && old.user) {
        const { error: ue } = await admin.auth.admin.updateUserById(old.user.id, { password: pass, app_metadata: { pin_v2: true } });
        if (ue) console.error("upgrade", ue.message);
        const again = ue ? null : await signIn(email, pass, ip);
        if (again && again.session) { r = again; onNewPassword = true; } else r = old;
      }
    }

    if (r.session) {
      // Mark the account as switched to the secure password, so the app stops asking them to confirm their PIN.
      if (onNewPassword && r.user && !r.user.app_metadata?.pin_v2) {
        const { error: me } = await admin.auth.admin.updateUserById(r.user.id, { app_metadata: { pin_v2: true } });
        if (me) console.error("flag", me.message);
      }
      await admin.rpc("login_result", { p_phone: phone, p_ip: ip, p_ok: true });
      return json({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
    }
    if (!r.wrong) return json({ error: "TRY_LATER" }, 503); // Supabase busy or down: don't count it against them

    const { data: lock, error: le } = await admin.rpc("login_result", { p_phone: phone, p_ip: ip, p_ok: false });
    if (le) throw le;
    if (lock > 0) return json({ error: "LOCKED", wait: lock }, 429);
    return json({ error: "BAD_LOGIN" }, 401);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return json({ error: "TRY_LATER" }, 503);
  }
});
