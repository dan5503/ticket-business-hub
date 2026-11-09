// charts-sync: copies today's public music charts into the hub once a day.
// Sources: Billboard (Hot 100, Artist 100), kworb.net (Spotify US daily, Apple Music US, YouTube US weekly,
// Shazam US, iTunes US) and Tokchart's free TikTok US trending-songs list (top 10; paid numbers are not taken).
// Called by the daily schedule (cron secret) or by a signed-in hub user pressing Refresh.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ALLOWED_ORIGINS = ["https://dan5503.github.io", "http://localhost:8765"];
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
};
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, " ").trim();
const num = (s?: string) => { const v = Number((s || "").replace(/[^\d-]/g, "")); return s && /\d/.test(s) && isFinite(v) ? v : null; };

type Row = { rank: number; title: string; artist: string | null; move: string | null; metric: number | null; extra: string | null };

// kworb tables: rank | move | "Artist - Title" | ... ; metricCol = which cell holds streams/views
function kworb(html: string, metricCol: number | null): Row[] {
  const body = html.split(/<tbody>/i)[1] || "";
  const out: Row[] = [];
  for (const [, tr] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]));
    const rank = num(cells[0]); if (!rank || !cells[2]) continue;
    const i = cells[2].indexOf(" - ");
    out.push({ rank, artist: i > 0 ? cells[2].slice(0, i) : null, title: i > 0 ? cells[2].slice(i + 3) : cells[2], move: cells[1] || null, metric: metricCol != null ? num(cells[metricCol]) : null, extra: null });
  }
  return out;
}

// billboard.com chart pages
function billboard(html: string, artistChart: boolean): Row[] {
  const out: Row[] = [];
  for (const chunk of html.split("o-chart-results-list-row-container").slice(1)) {
    const rank = num((chunk.match(/<span class="c-label[^"]*"[^>]*>\s*(\d+)\s*<\/span>/) || [])[1]);
    const title = text((chunk.match(/<h3[^>]*id="title-of-a-story"[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || "");
    if (!rank || !title) continue;
    const after = chunk.split(/<\/h3>/)[1] || "";
    const artist = artistChart ? title : text((after.match(/<span class="\s*c-label\s+a-no-trucate[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "") || null;
    const labels = [...after.matchAll(/<span class="[^"]*c-label[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => text(m[1])).filter((l) => l && l !== artist);
    const first = labels.find((l) => l === "-" || /^\d+$/.test(l));
    const lw = first && first !== "-" ? Number(first) : null;
    const isNew = first === "-";
    out.push({ rank, title, artist, move: isNew ? "NEW" : lw != null ? (lw === rank ? "=" : `${lw > rank ? "+" : ""}${lw - rank}`) : null, metric: null, extra: lw != null ? `Last week #${lw}` : null });
    if (out.length >= 100) break;
  }
  return out;
}

// tokchart.com free TikTok trending songs (US): rank, title, artist, genre only
function tokchart(html: string): Row[] {
  const out: Row[] = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rank = num((tr.match(/class="ch-rkn"[^>]*>([\s\S]*?)</) || [])[1]);
    const title = text((tr.match(/class="ui-t[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    if (!rank || !title) continue;
    const artist = text((tr.match(/class="ui-a[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "") || null;
    const mv = (tr.match(/class="ch-mv[^"]*"\s+title="([^"]*)"/) || [])[1] || "";
    const genre = text((tr.match(/class="ch-genre"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || "");
    const n = num(mv);
    out.push({ rank, title, artist, move: /new/i.test(mv) ? "NEW" : /up/i.test(mv) && n ? `+${n}` : /down/i.test(mv) && n ? `-${n}` : mv ? "=" : null, metric: null, extra: genre && genre !== "–" ? genre : null });
  }
  return out;
}

const SOURCES: [string, string, (h: string) => Row[]][] = [
  ["billboard_hot100", "https://www.billboard.com/charts/hot-100/", (h) => billboard(h, false)],
  ["billboard_artist100", "https://www.billboard.com/charts/artist-100/", (h) => billboard(h, true)],
  ["spotify_us", "https://kworb.net/spotify/country/us_daily.html", (h) => kworb(h, 6)],
  ["apple_us", "https://kworb.net/charts/apple_s/us.html", (h) => kworb(h, null)],
  ["youtube_us", "https://kworb.net/youtube/insights/us.html", (h) => kworb(h, 6)],
  ["tiktok_us", "https://tokchart.com/tiktok-trending-songs/united-states", tokchart],
  ["shazam_us", "https://kworb.net/charts/shazam/us.html", (h) => kworb(h, null)],
  ["itunes_us", "https://kworb.net/charts/itunes/us.html", (h) => kworb(h, null)],
];

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
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const done: Record<string, number> = {}, errors: string[] = [];
  await Promise.all(SOURCES.map(async ([chart, url, parse]) => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BusinessHub/1.0; private dashboard, once a day)", "Accept": "text/html" } });
      if (!r.ok) { errors.push(`${chart}: ${r.status}`); return; }
      const seen = new Set<number>();
      const rows = parse(await r.text()).filter((x) => !seen.has(x.rank) && seen.add(x.rank)).slice(0, 200);
      if (rows.length < 5) { errors.push(`${chart}: only ${rows.length} rows`); return; }
      await admin.from("chart_entries").delete().eq("chart", chart).eq("day", day);
      const { error } = await admin.from("chart_entries").insert(rows.map((x) => ({ chart, day, ...x })));
      if (error) errors.push(`${chart}: ${error.message}`); else done[chart] = rows.length;
    } catch (e) { errors.push(`${chart}: ${(e as Error).message}`); }
  }));
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  await admin.from("chart_entries").delete().lt("day", cutoff);
  return json(req, { day, charts: done, errors });
});
