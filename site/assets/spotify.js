// Spotify Charts: monthly listeners for the artists you deal in, plus who is climbing.
// Data: kworb.net's public top-artists-by-monthly-listeners list, copied in once a day.
import { sb, h, s, fetchAll, fmtMoney, fmtInt, fmtDate, toast, niceError, todayISO } from "./common.js";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const big = (v) => (v == null ? "—" : compact.format(v));
const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "-"}${compact.format(Math.abs(v))}`);
const pct = (v) => (v == null || !isFinite(v) ? "" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`);
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const lc = (v) => (v || "").trim().toLowerCase();
// Ticket listings carry tour names; Spotify has just the artist. Variants in order of preference;
// each name uses only the first variant that exists on Spotify, so loose splits never beat a real match.
export function variants(name) {
  const n = lc(name).replace(/\s+/g, " "); if (!n) return [];
  const out = [], add = (v, min = 2) => { v = (v || "").trim(); if (v.length >= min && !out.includes(v)) out.push(v); };
  const swap = (v) => (v.includes(" and ") ? v.replace(/ and /g, " & ") : v.includes(" & ") ? v.replace(/ & /g, " and ") : null);
  add(n); add(swap(n));
  const parts = n.split(/\s*[:|(]\s*|\s+[-–—]\s+/), head = parts[0].replace(/\s+(live|tour|in concert|world tour)\b.*$/, "").replace(/\s+\d{4}$/, "").trim();
  add(parts[0]); add(swap(parts[0])); add(head);
  parts.slice(1).forEach((p) => add(p, 4));
  [n, head].forEach((v) => { const m = v.split(/ (?:and|&|with|ft\.?|feat\.?|x) |, /); if (m.length > 1) add(m[0], 4); });
  return out;
}
const UI = { mine: "holding", climb: "day", q: "" };

function spark(points) {
  if (!points || points.length < 2) return h("span", { class: "muted small", text: "Building" });
  const w = 90, ht = 24, ys = points.map((p) => p.listeners), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(1)},${(ht - 2 - ((p.listeners - lo) / span) * (ht - 4)).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= ys[0];
  return s("svg", { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, role: "img", "aria-label": `${up ? "Up" : "Down"} over ${points.length} days` },
    s("path", { d, fill: "none", stroke: up ? "var(--up)" : "var(--down)", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }));
}

export async function renderSpotify(root) {
  const reload = () => renderSpotify(root);
  const today = todayISO();
  const [sales, inv, watch, first] = await Promise.all([
    fetchAll("sales", "artist,profit,total_cost,quantity", "artist"),
    fetchAll("inventory_outlook", "artist,discord_artist,event_date,remaining_qty,remaining_cost,expected_profit", "event_date").catch(() => []),
    sb.from("spotify_watch").select("spotify_id,name").then((r) => r.data || []),
    sb.from("spotify_history").select("day").order("day", { ascending: true }).limit(1).then((r) => r.data?.[0]?.day || null),
  ]);
  const days = first ? Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1 : 0;

  // your history and holdings, keyed by lowercase artist name
  const upcoming = inv.filter((p) => p.remaining_qty > 0 && p.event_date && p.event_date >= today);
  const allNames = [...new Set([...sales.map((r) => r.artist), ...upcoming.flatMap((p) => [p.discord_artist, p.artist])].filter(Boolean))];
  const watched = new Set(watch.map((w) => w.spotify_id));
  const [found, followedRows] = await Promise.all([
    allNames.length ? sb.rpc("spotify_lookup", { p_names: [...new Set(allNames.flatMap(variants))] }).then((r) => r.data || []) : [],
    watch.length ? sb.from("spotify_movers").select("*").in("spotify_id", [...watched]).then((r) => r.data || []) : [],
  ]);
  const onSpotify = new Set(found.map((a) => lc(a.name))), bestCache = new Map();
  const best = (name) => { if (!name) return null; if (!bestCache.has(name)) bestCache.set(name, variants(name).find((v) => onSpotify.has(v)) || lc(name)); return bestCache.get(name); };
  const hist = new Map();
  for (const r of sales) {
    const k = best(r.artist); if (!k) continue;
    const g = hist.get(k) || { n: 0, profit: 0, cost: 0 };
    g.n++; g.profit += Number(r.profit || 0); g.cost += Number(r.total_cost || 0); hist.set(k, g);
  }
  const hold = new Map();
  for (const p of upcoming) {
    const k = best(p.discord_artist) && onSpotify.has(best(p.discord_artist)) ? best(p.discord_artist) : best(p.artist || p.discord_artist);
    const g = hold.get(k) || { left: 0, cost: 0, next: p.event_date };
    g.left += p.remaining_qty; g.cost += Number(p.remaining_cost || 0); if (p.event_date < g.next) g.next = p.event_date; hold.set(k, g);
  }
  const all = new Map([...found, ...followedRows].map((a) => [a.spotify_id, a]));
  const rows = [...all.values()].map((a) => ({ ...a, h: hist.get(lc(a.name)), hold: hold.get(lc(a.name)), follow: watched.has(a.spotify_id) }));
  const updated = rows.reduce((m, a) => (a.updated_on > m ? a.updated_on : m), "");

  async function toggleFollow(a, btn) {
    btn.disabled = true;
    const { error } = watched.has(a.spotify_id)
      ? await sb.from("spotify_watch").delete().eq("spotify_id", a.spotify_id)
      : await sb.from("spotify_watch").insert({ spotify_id: a.spotify_id, name: a.name });
    if (error) { btn.disabled = false; return toast(niceError(error), "error"); }
    toast(watched.has(a.spotify_id) ? `Stopped following ${a.name}` : `Following ${a.name}`, "ok");
    reload();
  }
  const followBtn = (a) => { const on = watched.has(a.spotify_id); const b = h("button", { type: "button", class: `star ${on ? "on" : ""}`, "aria-pressed": String(on), "aria-label": `${on ? "Unfollow" : "Follow"} ${a.name}`, title: on ? "Following" : "Follow", text: on ? "★" : "☆" }); b.onclick = () => toggleFollow(a, b); return b; };
  const change = (v, p) => h("span", { class: cls(v) }, signed(v), p != null && p !== "" ? h("span", { class: "sub", text: pct(p) }) : "");
  const yours = (a) => h("div", {},
    a.hold ? h("span", { class: "pill warn", text: `${fmtInt(a.hold.left)} tix left`, title: `${fmtMoney(a.hold.cost)} at cost · next show ${fmtDate(a.hold.next)}` }) : "",
    a.h ? h("span", { class: `pill ${a.h.profit >= 0 ? "good" : "bad"}`, text: `${a.h.n} sold · ${a.h.cost ? pct((a.h.profit / a.h.cost) * 100) : ""} ROI` }) : "",
    !a.hold && !a.h ? h("span", { class: "muted", text: "—" }) : "");
  const artistCell = (a) => h("div", {}, h("a", { class: "link-like", href: `https://open.spotify.com/artist/${a.spotify_id}`, target: "_blank", rel: "noopener noreferrer", text: a.name }), h("span", { class: "sub", text: `#${fmtInt(a.rank)} on Spotify` }));
  const table = (cols, list) => h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, cols.map(([t, c]) => h("th", { class: c || "", scope: "col", text: t })))),
    h("tbody", {}, list.map((a) => h("tr", {}, cols.map(([, c, f]) => h("td", { class: c || "" }, f(a))))))));

  // ---------- your artists ----------
  const mineBody = h("div");
  const sparkFor = new Map();
  async function paintMine() {
    const pick = { holding: (a) => a.hold, following: (a) => a.follow, sold: (a) => a.h, all: () => true }[UI.mine];
    const list = rows.filter(pick).sort((a, b) => UI.mine === "holding" ? b.hold.cost - a.hold.cost : (b.daily_change ?? 0) - (a.daily_change ?? 0)).slice(0, 80);
    const need = list.map((a) => a.spotify_id).filter((id) => !sparkFor.has(id));
    if (need.length) {
      const { data } = await sb.from("spotify_history").select("spotify_id,day,listeners").in("spotify_id", need).gte("day", new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)).order("day");
      need.forEach((id) => sparkFor.set(id, []));
      (data || []).forEach((p) => sparkFor.get(p.spotify_id).push(p));
    }
    const counts = { holding: rows.filter((a) => a.hold).length, following: rows.filter((a) => a.follow).length, sold: rows.filter((a) => a.h).length, all: rows.length };
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Which artists" }, [["holding", "Holding tickets"], ["following", "Following"], ["sold", "Sold before"], ["all", "All"]]
      .map(([k, t]) => h("button", { type: "button", class: UI.mine === k ? "on" : "", onclick: () => { UI.mine = k; paintMine(); } }, `${t} ${counts[k]}`)));
    mineBody.replaceChildren(h("div", { class: "row" }, seg),
      list.length ? h("div", { class: "mt" }, table([
        ["", "", followBtn], ["Artist", "", artistCell],
        ["Monthly listeners", "r num", (a) => h("b", { text: big(a.listeners) })],
        ["Today", "r num", (a) => change(a.daily_change, a.pct_1d)],
        ["7 days", "r num", (a) => (a.change_7d == null ? h("span", { class: "muted", text: "—" }) : change(a.change_7d, a.pct_7d))],
        ["30 days", "r num", (a) => (a.change_30d == null ? h("span", { class: "muted", text: "—" }) : change(a.change_30d, a.pct_30d))],
        ["Trend", "", (a) => spark(sparkFor.get(a.spotify_id))],
        ["Of peak", "r num", (a) => (a.peak ? `${Math.round((a.listeners / a.peak) * 100)}%` : "—")],
        ["You", "", yours],
      ], list)) : h("p", { class: "muted mt", text: UI.mine === "following" ? "You're not following anyone yet. Search below or tap ☆ on any artist." : "No matching artists in Spotify's top 27,500." }));
  }

  // ---------- climbing ----------
  const climbBody = h("div");
  async function paintClimb() {
    const modes = { day: ["daily_change", 0, "Most listeners added today"], dayPct: ["pct_1d", 500000, "Fastest growing today (500k+ listeners)"], week: ["change_7d", 0, "Most added in 7 days"], weekPct: ["pct_7d", 500000, "Fastest growing in 7 days"] };
    const [col, min] = modes[UI.climb];
    climbBody.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
    let q = sb.from("spotify_movers").select("*").not(col, "is", null).order(col, { ascending: false }).limit(40);
    if (min) q = q.gte("listeners", min);
    const { data, error } = await q;
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Climbing" }, Object.entries(modes).map(([k, [, , t]]) =>
      h("button", { type: "button", class: UI.climb === k ? "on" : "", disabled: k.startsWith("week") && days < 8, title: k.startsWith("week") && days < 8 ? `Available once a week of history is in (day ${days} of 8)` : "", onclick: () => { UI.climb = k; paintClimb(); } }, t)));
    const list = (data || []).map((a) => ({ ...a, h: hist.get(lc(a.name)), hold: hold.get(lc(a.name)) }));
    climbBody.replaceChildren(h("div", { class: "row" }, seg),
      error ? h("p", { class: "msg error", text: niceError(error) }) :
      h("div", { class: "mt" }, table([
        ["", "", followBtn], ["#", "r num", (a) => String(list.indexOf(a) + 1)], ["Artist", "", artistCell],
        ["Monthly listeners", "r num", (a) => big(a.listeners)],
        ["Today", "r num", (a) => change(a.daily_change, a.pct_1d)],
        ["7 days", "r num", (a) => (a.change_7d == null ? h("span", { class: "muted", text: "—" }) : change(a.change_7d, a.pct_7d))],
        ["You", "", yours],
      ], list)));
  }

  // ---------- search ----------
  const results = h("div");
  const search = h("input", { type: "search", id: "sp-q", placeholder: "Find any artist in Spotify's top 27,500", "aria-label": "Find an artist" });
  let t; search.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const v = search.value.trim().replace(/[%_,()\\]/g, " ").trim();
    if (v.length < 2) return results.replaceChildren();
    const { data } = await sb.from("spotify_movers").select("*").ilike("name", `%${v}%`).order("listeners", { ascending: false }).limit(8);
    const list = (data || []).map((a) => ({ ...a, h: hist.get(lc(a.name)), hold: hold.get(lc(a.name)) }));
    results.replaceChildren(list.length ? h("div", { class: "mt" }, table([["", "", followBtn], ["Artist", "", artistCell], ["Monthly listeners", "r num", (a) => big(a.listeners)], ["Today", "r num", (a) => change(a.daily_change, a.pct_1d)], ["You", "", yours]], list)) : h("p", { class: "muted mt", text: "No artist by that name in the top 27,500." }));
  }, 300); };

  const refresh = h("button", { type: "button" }, "Refresh now");
  refresh.onclick = async () => {
    refresh.disabled = true; refresh.textContent = "Refreshing… (about 30 seconds)";
    const { data, error } = await sb.functions.invoke("spotify-sync", { body: {} });
    if (error) { refresh.disabled = false; refresh.textContent = "Refresh now"; return toast("Couldn't refresh. Try again in a minute.", "error"); }
    toast(`Updated ${fmtInt(data.artists)} artists`, "ok"); reload();
  };
  const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");

  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Spotify Charts" }), h("p", { class: "sub", text: `Monthly listeners for the artists you deal in, and who is climbing. ${updated ? `Updated ${fmtDate(updated)}.` : ""} Refreshes every morning.` })),
      h("span", { class: "spacer" }), refresh),
    h("div", { class: "stack" },
      card("Your artists", mineBody, days < 8 ? `7-day change fills in after a week of daily snapshots (day ${days} of 8); 30-day after a month. Today's change is live now.` : "Monthly listeners is Spotify's 28-day count of unique listeners."),
      card("Climbing", climbBody, "Artists gaining listeners fast often sell better. ★ follows an artist so it stays in Your artists."),
      card("Find an artist", h("div", {}, search, results))));
  paintMine(); paintClimb();
}
