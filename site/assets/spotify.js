// Social & Charts: where your artists stand across TikTok, Billboard, Spotify, Apple Music, YouTube, Shazam and iTunes,
// plus Spotify monthly listeners for the artists you deal in and who is climbing.
// Data: public charts copied in once a day (charts-sync) and kworb.net's Spotify monthly listeners (spotify-sync).
import { sb, h, s, fetchAll, fmtMoney, fmtInt, fmtDate, toast, niceError, todayISO } from "./common.js";
import { arrange } from "./layout.js";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const big = (v) => (v == null ? "—" : compact.format(v));
const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "-"}${compact.format(Math.abs(v))}`);
const pct = (v) => (v == null || !isFinite(v) ? "" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`);
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const lc = (v) => (v || "").trim().toLowerCase();
// Ticket listings carry tour names; Spotify has just the artist. Variants in order of preference;
// each name uses only the first variant that exists on Spotify, so loose splits never beat a real match.
const norm = (v) => lc(v).replace(/\s+/g, " ").replace(/ (and|&|\+) /g, " & ");
const swap2 = (v, name) => norm(v) === norm(name);
export function variants(name) {
  const n = lc(name).replace(/\s+/g, " "); if (!n) return [];
  const out = [], add = (v, min = 2) => { v = (v || "").trim(); if (v.length >= min && !out.includes(v)) out.push(v); };
  const swaps = (v) => [" and ", " & ", " + "].filter((j) => v.includes(j)).flatMap((j) => [" and ", " & ", " + "].filter((k) => k !== j).map((k) => v.split(j).join(k)));
  const swap = (v) => swaps(v)[0] || null;
  add(n); swaps(n).forEach((v) => add(v));
  const parts = n.split(/\s*[:|(]\s*|\s+[-–—]\s+/), head = parts[0].replace(/\s+(live|tour|in concert|world tour)\b.*$/, "").replace(/\s+\d{4}$/, "").trim();
  add(parts[0]); swaps(parts[0]).forEach((v) => add(v)); add(head);
  parts.slice(1).forEach((p) => add(p, 4));
  [n, head].forEach((v) => { const m = v.split(/ (?:and|&|\+|with|ft\.?|feat\.?|x) |, /); if (m.length > 1) add(m[0], 4); });
  return out;
}
const UI = { mine: "holding", climb: "day", q: "", chart: "all", chartView: "artists", chartN: 50 };

// the charts we copy in; order = order of the buttons
export const CHARTS = [
  ["tiktok_us", "TikTok", "Songs trending on TikTok in the US, updated daily. The free list is the top 10.", "https://tokchart.com/tiktok-trending-songs/united-states", null],
  ["billboard_hot100", "Billboard Hot 100", "The official US singles chart, updated weekly.", "https://www.billboard.com/charts/hot-100/", null],
  ["billboard_artist100", "Billboard Artist 100", "The most popular artists in the US this week, all platforms combined.", "https://www.billboard.com/charts/artist-100/", null],
  ["spotify_us", "Spotify", "Spotify's US daily top songs.", "https://kworb.net/spotify/country/us_daily.html", "Streams"],
  ["apple_us", "Apple Music", "Apple Music's US top songs, updated through the day.", "https://kworb.net/charts/apple_s/us.html", null],
  ["youtube_us", "YouTube", "YouTube's US top songs this week.", "https://kworb.net/youtube/insights/us.html", "Views"],
  ["shazam_us", "Shazam", "What people in the US are looking up. Songs often show here before they hit the other charts.", "https://kworb.net/charts/shazam/us.html", null],
  ["itunes_us", "iTunes", "Songs people are buying on iTunes in the US.", "https://kworb.net/charts/itunes/us.html", null],
];
const SHORT = { tiktok_us: "TikTok", billboard_hot100: "Hot 100", billboard_artist100: "Artist 100", spotify_us: "Spotify", apple_us: "Apple", youtube_us: "YouTube", shazam_us: "Shazam", itunes_us: "iTunes" };
const key = (v) => lc(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
// "KAROL G, Judeline & rusowsky" + "(feat. Future)" -> each credited artist
export function creditedArtists(artist, title) {
  const out = [], add = (v) => { v = (v || "").trim(); if (v.length >= 2 && !out.includes(v)) out.push(v); };
  if (!artist) return out;
  add(artist);
  artist.split(/\s*,\s*|\s+&\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+with\s+/i).forEach(add);
  const f = (title || "").match(/\((?:feat\.?|ft\.?|with)\s+([^)]+)\)/i);
  if (f) f[1].split(/\s*,\s*|\s+&\s+/).forEach(add);
  return out;
}
// the individual acts behind an entry (no combined "A, B & C" string)
export function soloArtists(artist, title) {
  const c = creditedArtists(artist, title);
  if (c.length < 2) return c;
  const parts = c.slice(1);
  return parts.some((p) => key(p) === key(artist)) ? parts : creditedArtists(artist, "").length > 1 ? parts : [artist, ...parts];
}
async function loadCharts() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("chart_latest").select("chart,day,rank,title,artist,move,metric,extra").order("chart").order("rank").range(from, from + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}

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
  const [sales, inv, watch, first, chartRows] = await Promise.all([
    fetchAll("sales", "artist,profit,total_cost,quantity", "artist"),
    fetchAll("inventory_outlook", "artist,discord_artist,event_date,remaining_qty,remaining_cost,expected_profit", "event_date").catch(() => []),
    sb.from("spotify_watch").select("spotify_id,name").then((r) => r.data || []),
    sb.from("spotify_history").select("day").order("day", { ascending: true }).limit(1).then((r) => r.data?.[0]?.day || null),
    loadCharts().catch(() => []),
  ]);
  const days = first ? Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1 : 0;
  const unlock = first ? new Date(Date.parse(first) + 7 * 86400000 + 43200000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

  // your history and holdings, keyed by lowercase artist name
  const upcoming = inv.filter((p) => p.remaining_qty > 0 && p.event_date && p.event_date >= today);
  const allNames = [...new Set([...sales.map((r) => r.artist), ...upcoming.flatMap((p) => [p.discord_artist, p.artist])].filter(Boolean))];
  const watched = new Set(watch.map((w) => w.spotify_id));
  const [found, followedRows] = await Promise.all([
    allNames.length ? sb.rpc("spotify_lookup", { p_names: [...new Set(allNames.flatMap(variants))] }).then((r) => r.data || []) : [],
    watch.length ? sb.from("spotify_movers").select("*").in("spotify_id", [...watched]).then((r) => r.data || []) : [],
  ]);
  // exact name (or and/&/+ spelling) wins; otherwise the biggest artist among the name's parts
  const listenersOf = new Map(); found.forEach((a) => { const k = lc(a.name); listenersOf.set(k, Math.max(listenersOf.get(k) || 0, a.listeners || 0)); });
  const onSpotify = listenersOf, bestCache = new Map();
  const best = (name) => {
    if (!name) return null;
    if (!bestCache.has(name)) {
      const vs = variants(name), exact = vs.filter((v) => v === lc(name).replace(/\s+/g, " ") || swap2(v, name)).find((v) => listenersOf.has(v));
      const hits = vs.filter((v) => listenersOf.has(v)).sort((a, b) => listenersOf.get(b) - listenersOf.get(a));
      bestCache.set(name, exact || hits[0] || lc(name));
    }
    return bestCache.get(name);
  };
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
      h("button", { type: "button", class: UI.climb === k ? "on" : "", disabled: k.startsWith("week") && days < 8, onclick: () => { UI.climb = k; paintClimb(); } }, t, k.startsWith("week") && days < 8 && unlock ? ` · from ${unlock}` : "")));
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

  // ---------- charts across platforms ----------
  const followNames = new Set(watch.map((w) => lc(w.name)));
  const youOf = (name) => { const k = lc(name); return { h: hist.get(k), hold: hold.get(k), follow: followNames.has(k) }; };
  const byChart = new Map(CHARTS.map(([c]) => [c, []]));
  chartRows.forEach((r) => byChart.get(r.chart)?.push(r));
  const chartDay = chartRows.reduce((m, r) => (r.day > m ? r.day : m), "");
  // every artist credited on any chart, with their best spot on each
  const people = new Map();
  for (const r of chartRows) {
    for (const a of creditedArtists(r.artist, r.title)) {
      const k = key(a);
      const p = people.get(k) || { name: a, k, spots: new Map(), songs: new Set() };
      const cur = p.spots.get(r.chart);
      if (!cur || r.rank < cur.rank) p.spots.set(r.chart, r);
      if (r.chart !== "billboard_artist100") p.songs.add(key(r.title));
      people.set(k, p);
    }
  }
  // your artist names may be the Spotify spelling; match on the accent-free key
  const yoursByKey = new Map();
  for (const [k, v] of hist) yoursByKey.set(key(k), { ...(yoursByKey.get(key(k)) || {}), h: v });
  for (const [k, v] of hold) yoursByKey.set(key(k), { ...(yoursByKey.get(key(k)) || {}), hold: v });
  for (const n of followNames) yoursByKey.set(key(n), { ...(yoursByKey.get(key(n)) || {}), follow: true });
  // a combined credit ("A, B & C") is only kept as its own row when it's an act you deal in or on the Artist 100
  const combined = (n) => creditedArtists(n, "").length > 2;
  const plist = [...people.values()].filter((p) => !combined(p.name) || yoursByKey.has(p.k) || p.spots.has("billboard_artist100")).map((p) => ({ ...p, ...(yoursByKey.get(p.k) || {}) }));
  const order = new Map(CHARTS.map(([c], i) => [c, i]));
  const spots = (p) => h("div", { class: "spots" }, [...p.spots.entries()].sort((a, b) => order.get(a[0]) - order.get(b[0])).map(([c, r]) =>
    h("span", { class: `spot ${r.rank <= 10 ? "top" : ""}`, title: `${CHARTS[order.get(c)][1]} #${r.rank}${c === "billboard_artist100" ? "" : `: ${r.title}`}${r.move ? ` (${r.move})` : ""}` }, h("b", { text: SHORT[c] }), ` #${r.rank}`)));
  const youPills = (a) => (a.h || a.hold ? yours({ h: a.h, hold: a.hold }) : "");
  const followPill = (a) => (a.follow && !a.h && !a.hold ? h("span", { class: "pill", text: "Following" }) : "");
  const score = (p) => p.spots.size * 1000 - [...p.spots.values()].reduce((t, r) => t + Math.min(r.rank, 200), 0) / 10;

  const mineOnCharts = plist.filter((p) => p.h || p.hold || p.follow).sort((a, b) => (b.hold ? 1 : 0) - (a.hold ? 1 : 0) || score(b) - score(a));
  const onChartsBody = chartRows.length ? (mineOnCharts.length
    ? table([["Artist", "", (p) => h("b", { text: p.name })], ["Where they are", "", spots], ["You", "", (p) => h("div", {}, youPills(p), followPill(p))]], mineOnCharts.slice(0, 60))
    : h("p", { class: "muted", text: "None of the artists you hold, sold or follow are on today's charts." }))
    : h("p", { class: "muted", text: "Charts load every morning. Tap Refresh now to load them the first time." });

  const hot = plist.filter((p) => p.spots.size >= 3).sort((a, b) => score(b) - score(a)).slice(0, 40);
  const hotBody = hot.length ? table([["#", "r num", (p) => String(hot.indexOf(p) + 1)], ["Artist", "", (p) => h("b", { text: p.name })], ["Charts", "r num", (p) => String(p.spots.size)], ["Where they are", "", spots], ["You", "", (p) => h("div", {}, youPills(p), followPill(p))]], hot)
    : h("p", { class: "muted", text: "Nothing yet. Charts load every morning." });

  const chartBody = h("div");
  // rank artists inside one chart (or across all of them) by how many songs they have and how high
  function artistBoard(c) {
    const lists = c === "all" ? [...byChart.entries()] : [[c, byChart.get(c) || []]];
    const acc = new Map();
    for (const [ch, list] of lists) {
      const size = Math.max(list.length, 1), per = new Map();
      for (const r of list) {
        for (const a of soloArtists(r.artist, r.title)) {
          const k = key(a), g = per.get(k) || { name: a, pts: 0, songs: [], metric: 0 };
          g.pts += 1 - (r.rank - 1) / size; g.songs.push(r); g.metric += Number(r.metric || 0); per.set(k, g);
        }
      }
      for (const [k, g] of per) {
        const t = acc.get(k) || { k, name: g.name, pts: 0, songs: [], metric: 0, charts: new Set() };
        t.pts += c === "all" ? Math.min(g.pts, 2) : g.pts; t.songs.push(...g.songs); t.metric += g.metric; t.charts.add(ch); acc.set(k, t);
      }
    }
    return [...acc.values()].map((t) => ({ ...t, ...(yoursByKey.get(t.k) || {}), spots: people.get(t.k)?.spots || new Map(), best: t.songs.reduce((b, r) => (!b || r.rank < b.rank ? r : b), null) }))
      .sort((a, b) => b.pts - a.pts);
  }

  function paintChart() {
    const artistsMode = UI.chartView === "artists";
    if (!artistsMode && UI.chart === "all") UI.chart = "tiktok_us";
    const all = ["all", "All charts", "Every chart below combined. Artists score for each song and how high it sits, so acts that are everywhere rise to the top.", null, null];
    const choices = artistsMode ? [all, ...CHARTS] : CHARTS;
    const [c, , about, link, metricLbl] = choices.find(([k]) => k === UI.chart) || choices[0];
    const view = h("div", { class: "seg", role: "group", "aria-label": "Show" }, [["artists", "Artists"], ["songs", "Songs"]].map(([k, t]) =>
      h("button", { type: "button", class: UI.chartView === k ? "on" : "", "aria-pressed": String(UI.chartView === k), onclick: () => { UI.chartView = k; UI.chartN = 50; paintChart(); } }, t)));
    const seg = h("div", { class: "seg wrap", role: "group", "aria-label": "Chart" }, choices.map(([k, t]) =>
      h("button", { type: "button", class: UI.chart === k ? "on" : "", "aria-pressed": String(UI.chart === k), onclick: () => { UI.chart = k; UI.chartN = 50; paintChart(); } }, t)));
    const mv = (r) => { const m = r.move || ""; return (/^(new|re)$/i.test(m) ? h("span", { class: "pill good", text: /new/i.test(m) ? "New" : "Back" }) : h("span", { class: /^\+/.test(m) ? "up" : /^-/.test(m) ? "down" : "muted", text: m === "=" ? "–" : m })); };
    const you = (r) => { const hit = creditedArtists(r.artist, r.title).map((a) => yoursByKey.get(key(a))).filter(Boolean); if (!hit.length) return h("span", { class: "muted", text: "" }); const m = hit.reduce((o, x) => ({ h: o.h || x.h, hold: o.hold || x.hold, follow: o.follow || x.follow }), {}); return h("div", {}, youPills(m), followPill(m)); };
    const isArtistChart = c === "billboard_artist100";
    let list, cols;
    if (artistsMode && !isArtistChart) {
      list = artistBoard(c);
      const n = (a) => list.indexOf(a) + 1;
      const anyNew = (a) => a.songs.some((r) => /^(new|re)$/i.test(r.move || ""));
      cols = c === "all"
        ? [["#", "r num", (a) => String(n(a))], ["Artist", "", (a) => h("b", { text: a.name })], ["Charts", "r num", (a) => String(a.charts.size)], ["Songs", "r num", (a) => String(new Set(a.songs.map((r) => key(r.title))).size)],
           ["Where they are", "", spots], ["You", "", (a) => h("div", {}, youPills(a), followPill(a))]]
        : [["#", "r num", (a) => String(n(a))], ["Artist", "", (a) => h("b", { text: a.name })], ["Songs here", "r num", (a) => String(a.songs.length)],
           ["Top song", "", (a) => h("div", {}, h("span", { text: `#${a.best.rank} ${a.best.title}` }), anyNew(a) ? h("span", { class: "pill good", text: "New entry" }) : "")],
           ...(metricLbl ? [[metricLbl, "r num", (a) => big(a.metric)]] : []),
           ["Also on", "", (a) => { const o = { ...a, spots: new Map([...a.spots].filter(([k]) => k !== c)) }; return o.spots.size ? spots(o) : h("span", { class: "muted", text: "Only here" }); }],
           ["You", "", (a) => h("div", {}, youPills(a), followPill(a))]];
    } else {
      list = byChart.get(c) || [];
      cols = [["#", "r num", (r) => String(r.rank)], ["Move", "num", mv],
        isArtistChart ? ["Artist", "", (r) => h("b", { text: r.title })] : ["Song", "", (r) => h("div", {}, h("b", { text: r.title }), h("span", { class: "sub", text: [r.artist, r.extra && c === "tiktok_us" ? r.extra : ""].filter(Boolean).join(" · ") }))],
        ...(isArtistChart ? [["Also on", "", (r) => { const p = people.get(key(r.title)); const o = p ? { spots: new Map([...p.spots].filter(([k]) => k !== c)) } : null; return o && o.spots.size ? spots(o) : h("span", { class: "muted", text: "" }); }]] : []),
        ...(metricLbl ? [[metricLbl, "r num", (r) => big(r.metric)]] : []),
        ["You", "", you]];
    }
    const shown = list.slice(0, UI.chartN);
    const more = list.length > shown.length ? h("button", { type: "button", class: "mt", onclick: () => { UI.chartN += 50; paintChart(); } }, `Show more (${list.length - shown.length} left)`) : "";
    const day = c === "all" ? chartDay : (byChart.get(c) || [])[0]?.day;
    chartBody.replaceChildren(h("div", { class: "row" }, view, seg),
      h("p", { class: "muted small mt" }, about, day ? ` As of ${fmtDate(day)}. ` : " ", link ? h("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "Open the full chart ↗" }) : ""),
      list.length ? h("div", { class: "mt" }, table(cols, shown), more) : h("p", { class: "muted mt", text: "This chart didn't load today. It will try again tomorrow morning." }));
  }

  const refresh = h("button", { type: "button" }, "Refresh now");
  refresh.onclick = async () => {
    refresh.disabled = true; refresh.textContent = "Refreshing… (about 30 seconds)";
    const [a, b] = await Promise.all([sb.functions.invoke("spotify-sync", { body: {} }), sb.functions.invoke("charts-sync", { body: {} })]);
    if (a.error && b.error) { refresh.disabled = false; refresh.textContent = "Refresh now"; return toast("Couldn't refresh. Try again in a minute.", "error"); }
    toast(`Updated ${b.data ? Object.keys(b.data.charts || {}).length + " charts" : ""}${a.data ? `${b.data ? " and " : ""}${fmtInt(a.data.artists)} Spotify artists` : ""}`, "ok"); reload();
  };
  const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");

  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Social & Charts" }), h("p", { class: "sub", text: `Where your artists stand on TikTok, Billboard, Spotify, Apple Music, YouTube, Shazam and iTunes. ${chartDay ? `Charts from ${fmtDate(chartDay)}.` : ""} Refreshes every morning.` })),
      h("span", { class: "spacer" }), refresh),
    h("div", { class: "stack" },
      card("Your artists on the charts", onChartsBody, "Artists you hold tickets for, have sold, or follow, and their best spot on each chart today. Hover a spot for the song."),
      card("Hot across platforms", hotBody, "Artists on 3 or more charts at once. Showing up everywhere at the same time is a strong demand signal."),
      card("Top charts", chartBody, "Artists view groups each chart's songs by artist. Instagram doesn't publish a public music chart. Its trending Reels audio is only shown inside the Instagram app."),
      card("Spotify: your artists' listeners", mineBody, days < 8 ? `7-day change fills in after a week of daily snapshots (day ${days} of 8); 30-day after a month. Today's change is live now.` : "Monthly listeners is Spotify's 28-day count of unique listeners."),
      card("Spotify: climbing", climbBody, "Artists gaining listeners fast often sell better. ★ follows an artist so it stays in Your artists."),
      card("Find an artist on Spotify", h("div", {}, search, results))));
  paintMine(); paintClimb(); paintChart();
  arrange(root, "social");
}
