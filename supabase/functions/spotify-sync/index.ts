// spotify-sync: copies kworb.net's public "Spotify top artists by monthly listeners" (top 27,500) into the hub once a day.
// Called by the daily schedule (cron secret) or by a signed-in hub user pressing Refresh.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const ALLOWED_ORIGINS = ["https://dan5503.github.io", "http://localhost:8765"];
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
};
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/<[^>]*>/g, "").trim();
const num = (s: string) => Number(s.replace(/[^\d-]/g, ""));

export function parsePage(html: string) {
  const out: { id: string; name: string; rank: number; listeners: number; daily: number; peak: number }[] = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const a = tr.match(/href="(?:\.\.\/)?(?:spotify\/)?artist\/([A-Za-z0-9]{22})_songs\.html"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    // skip the artist's own cell, so names that are numbers (311, 112, 5050) aren't read as figures
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].filter((m) => !/_songs\.html/i.test(m[1])).map((m) => decode(m[1])).filter((c) => /^[-+]?[\d,]+$/.test(c));
    if (cells.length < 3) continue;
    const [rank, listeners, daily, peak] = cells.length >= 4 ? cells : [cells[0], cells[1], "0", cells[2]];
    out.push({ id: a[1], name: decode(a[2]), rank: num(rank), listeners: num(listeners), daily: num(daily), peak: num(peak) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await admin.rpc("check_cron_secret", { p_secret: secret });
    if (data !== true) return json(req, { error: "Not allowed" }, 401);
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(token);
    if (!data?.user) return json(req, { error: "Please sign in again." }, 401);
  }
  let total = 0; const errors: string[] = [];
  for (let p = 1; p <= 11; p++) {
    const url = `https://kworb.net/spotify/listeners${p === 1 ? "" : p}.html`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "BusinessHub/1.0 (private dashboard; daily)" } });
      if (!r.ok) { errors.push(`page ${p}: ${r.status}`); continue; }
      const rows = parsePage(await r.text());
      if (!rows.length) { errors.push(`page ${p}: no rows`); continue; }
      const { data, error } = await admin.rpc("ingest_spotify_page", { p_rows: rows });
      if (error) errors.push(`page ${p}: ${error.message}`); else total += data as number;
    } catch (e) { errors.push(`page ${p}: ${(e as Error).message}`); }
  }
  if (total > 1000) await admin.rpc("prune_spotify");
  return json(req, { artists: total, errors });
});
