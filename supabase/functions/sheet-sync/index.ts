// sheet-sync: pulls the owner's Google Sheet (as CSV) into the hub's inventory.
// Called by the hub (signed-in user) or by the 30-minute schedule (cron secret).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseCsv, detect, toRecords, FIELDS } from "./csv.js";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const ALLOWED_ORIGINS = ["https://dan5503.github.io", "http://localhost:8765"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

class UserError extends Error {}

// Turn any Google Sheets link into its CSV download link. Only Google Sheets is allowed.
export function toExportUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new UserError("That doesn't look like a link. Copy it from your browser's address bar while the sheet is open."); }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) {
    throw new UserError("Only Google Sheets links work here (they start with https://docs.google.com/spreadsheets/).");
  }
  const gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/) || [])[1] || "";
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
  if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ""}`;
  const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
  if (!id) throw new UserError("I couldn't find the sheet ID in that link.");
  return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

async function fetchCsv(exportUrl: string): Promise<string> {
  const r = await fetch(exportUrl, { redirect: "follow" });
  const type = r.headers.get("content-type") || "";
  if (r.status === 401 || r.status === 403 || type.includes("text/html")) {
    throw new UserError("Google wouldn't share the sheet. In Google Sheets click Share, set General access to “Anyone with the link” (Viewer), then try again.");
  }
  if (r.status === 404) throw new UserError("Google says that sheet doesn't exist. Check the link.");
  if (!r.ok) throw new UserError(`Google returned an error (${r.status}). Try again in a minute.`);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > 15_000_000) throw new UserError("That sheet is over 15 MB, too large to sync.");
  const text = await r.text();
  if (text.length > 15_000_000) throw new UserError("That sheet is over 15 MB, too large to sync.");
  return text;
}

async function sha(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// mapping is saved by HEADER NAME so it survives column moves
function applyMapping(det: ReturnType<typeof detect>, mapping?: Record<string, string | null>) {
  if (!mapping) return det;
  const map: Record<string, number> = {};
  for (const [key] of FIELDS) {
    const name = mapping[key];
    if (name == null) continue;
    const idx = det.headers.indexOf(name);
    if (idx >= 0) map[key] = idx;
  }
  return { ...det, map };
}

async function syncOwner(owner: string, force = false, csvFromExtension?: string) {
  const { data: src, error } = await admin.from("inventory_sources").select("*").eq("owner_id", owner).maybeSingle();
  if (error) throw error;
  if (!src) throw new UserError("No Google Sheet is connected yet.");
  try {
    const csv = csvFromExtension ?? await fetchCsv(src.export_url);
    const hash = await sha(csv + JSON.stringify(src.mapping || {}));
    if (!force && hash === src.last_hash) {
      await admin.from("inventory_sources").update({ last_checked_at: new Date().toISOString(), last_status: "ok", last_error: null }).eq("owner_id", owner);
      return { changed: false, rows: src.last_rows };
    }
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new UserError("The sheet looks empty.");
    const det = applyMapping(detect(rows), src.mapping);
    if (det.map.artist == null) throw new UserError("The Artist / event column wasn't found. Open the hub's Inventory page and click “Change columns”.");
    const recs = toRecords(det);
    const { data, error: e2 } = await admin.rpc("replace_purchases_service", { p_owner: owner, p_rows: recs, p_source: "sheet" });
    if (e2) throw e2;
    const now = new Date().toISOString();
    await admin.from("inventory_sources").update({ last_hash: hash, last_rows: data.rows, last_synced_at: now, last_checked_at: now, last_status: "ok", last_error: null }).eq("owner_id", owner);
    return { changed: true, rows: data.rows };
  } catch (e) {
    const msg = e instanceof UserError ? e.message : "Sync failed: " + (e as Error).message;
    await admin.from("inventory_sources").update({ last_checked_at: new Date().toISOString(), last_status: "error", last_error: msg.slice(0, 500) }).eq("owner_id", owner);
    throw e instanceof UserError ? e : new UserError(msg);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  try {
    // ---- scheduled run ----
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data: ok } = await admin.rpc("check_cron_secret", { p_secret: cronSecret });
      if (!ok) return json(req, { error: "forbidden" }, 403);
      // sheets the Chrome extension delivers are skipped here; Google won't hand them to the server
      const { data: srcs } = await admin.from("inventory_sources").select("owner_id").eq("enabled", true).eq("via_extension", false);
      const results = [];
      for (const s of srcs || []) {
        try { results.push({ owner: s.owner_id, ...(await syncOwner(s.owner_id)) }); }
        catch (e) { results.push({ owner: s.owner_id, error: (e as Error).message }); }
      }
      return json(req, { ran: results.length });
    }

    const body = await req.json().catch(() => ({}));

    // ---- Chrome extension delivering the sheet (signed in to Google as you) ----
    if (body.action === "push") {
      const { data: owner, error: ke } = await admin.rpc("owner_for_sync_key", { p_key: String(body.key || "") });
      if (ke || !owner) return json(req, { error: "Invalid or revoked sync key" }, 401);
      const stamp = { last_checked_at: new Date().toISOString(), via_extension: true };
      if (body.error) {
        await admin.from("inventory_sources").update({ ...stamp, last_status: "error", last_error: ("Chrome extension: " + String(body.error)).slice(0, 500) }).eq("owner_id", owner);
        return json(req, { ok: true });
      }
      if (body.unchanged) {
        await admin.from("inventory_sources").update({ ...stamp, last_status: "ok", last_error: null }).eq("owner_id", owner);
        return json(req, { changed: false });
      }
      const csv = String(body.csv || "");
      if (!csv || csv.length > 15_000_000) throw new UserError("The sheet was empty or over 15 MB.");
      await admin.from("inventory_sources").update(stamp).eq("owner_id", owner);
      return json(req, await syncOwner(owner as string, true, csv));
    }

    // ---- signed-in owner ----
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json(req, { error: "Please sign in again." }, 401);
    const owner = u.user.id;

    if (body.action === "preview") {
      const exportUrl = toExportUrl(String(body.url || ""));
      const rows = parseCsv(await fetchCsv(exportUrl));
      if (rows.length < 2) throw new UserError("The sheet looks empty.");
      const det = detect(rows);
      const mapping = Object.fromEntries(FIELDS.map(([k]) => [k, det.map[k] != null ? det.headers[det.map[k]] : null]));
      return json(req, { headers: det.headers, mapping, rowCount: det.data.length, sample: det.data.slice(0, 5) });
    }
    if (body.action === "connect") {
      const exportUrl = toExportUrl(String(body.url || ""));
      const mapping = body.mapping && typeof body.mapping === "object" ? body.mapping : null;
      const { error } = await admin.from("inventory_sources").upsert({
        owner_id: owner, sheet_url: String(body.url).slice(0, 2000), export_url: exportUrl, mapping, enabled: true, last_hash: null,
      });
      if (error) throw error;
      try { return json(req, await syncOwner(owner, true)); }
      catch (e) {
        if (e instanceof UserError && /wouldn't share|doesn't exist/.test(e.message)) return json(req, { saved: true, rows: 0, note: "Saved. Google won't share this sheet with the server, so your Chrome extension will pull it in the next 30 minutes." });
        throw e;
      }
    }
    if (body.action === "sync") return json(req, await syncOwner(owner, true));
    if (body.action === "disconnect") {
      await admin.from("inventory_sources").delete().eq("owner_id", owner);
      return json(req, { ok: true });
    }
    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    if (e instanceof UserError) return json(req, { error: e.message }, 400);
    console.error(e);
    return json(req, { error: "Something went wrong on the server. Try again." }, 500);
  }
});
