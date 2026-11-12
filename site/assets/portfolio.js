// Portfolio: trading-terminal style sales analytics.
import { sb, h, fetchAll, fmtMoney, fmtInt, fmtPct, fmtDate, monthLabel, todayISO } from "./common.js";
import { barChart, lineChart, legend } from "./charts.js";
import { exportCsv } from "./dashboard.js";
import { loadPrefs, savePrefs, arrange } from "./layout.js";

const COLS = "id,discord_message_id,order_number,artist,venue,city,event_date,section,row_name,quantity,total_sale,total_cost,profit,roi,cost_per,sold_per,purchase_date,purchased_at,sold_date,sold_at,account,marketplace,result,created_at";
export const MY_TABS = [["month", "TAG & Month"], ["recent", "Day · 3 days · Week"], ["overview", "Overview"], ["sales", "Sales"], ["artists", "Artists"], ["venues", "Venues"], ["insights", "Buy insights"], ["buying", "Buy timing"], ["losses", "Losses"]];
export const PLT_TABS = [["recent", "Day · 3 days · Week"], ["month", "Month"], ["overview", "Overview"], ["sales", "Sales"], ["artists", "Artists"], ["venues", "Venues"], ["accounts", "Buyer accounts"], ["insights", "Insights"], ["buying", "Buy timing"], ["losses", "Losses"]];
const KIND = { artist: ["Artist", "Artists", "an artist"], venue: ["Venue", "Venues", "a venue"], account: ["Buyer account", "Buyer accounts", "an account"] };
const NY = "America/New_York";
const nyDay = new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" });
const nyWeekday = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short" });
const DAY = 86400000;

/* ---------- formatting helpers ---------- */
const sm = (v) => (v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "-"}${fmtMoney(Math.abs(v), true)}`);
const sp = (v, d = 2) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const money = (v) => fmtMoney(v, true);
const plural = (n, w) => `${fmtInt(n)} ${n === 1 ? w : /(s|sh|ch|x)$/.test(w) ? w + "es" : w + "s"}`;
const dur = (days) => { if (days == null || !isFinite(days)) return "—"; if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`; const d = Math.floor(days), hr = Math.round((days - d) * 24); return hr ? `${d}d ${hr}h` : `${d}d`; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const dayLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return nyDay.format(d); };
const weekStart = (iso) => { const d = new Date(iso + "T12:00:00"); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return nyDay.format(d); };
const daysInMonth = (key) => { const [y, m] = key.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const prevMonthKey = (key) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/* ---------- result type (from the Discord post, with a fallback) ---------- */
// Win / loss / break-even is decided by the actual profit (same as your TAG math).
// "ehh" marks small wins, using the Discord label when there is one.
function resultOf(r) {
  const p = Math.round(r.profit * 100);
  if (p < 0) return "loss";
  if (p === 0) return "even";
  const t = (r.result || "").toLowerCase();
  if (t) return /ehh|meh|break/.test(t) ? "ehh" : "win";
  return r.roi != null && r.roi < 15 ? "ehh" : "win";
}
const TYPES = [["massive", "Massive"], ["fantastic", "Fantastic"], ["profitable", "Profitable"], ["ehh", "Ehh"], ["breakeven", "Break even"], ["loss", "Loss"]];
function typeOf(r) {
  const t = (r.result || "").toLowerCase();
  if (/massive/.test(t)) return "massive"; if (/fantastic/.test(t)) return "fantastic"; if (/ehh|meh/.test(t)) return "ehh";
  if (/break/.test(t)) return "breakeven"; if (/loss/.test(t)) return "loss"; if (/profit/.test(t)) return "profitable";
  return { win: "profitable", ehh: "ehh", even: "breakeven", loss: "loss" }[r.res];
}
const RESULT_LABEL = { win: ["Profitable", "good"], ehh: ["Ehh", "meh"], even: ["Break-even", ""], loss: ["Loss", "bad"] };
const badge = (r) => { const [t, c] = RESULT_LABEL[r.res]; const own = (r.result || "").replace(/\s*sale$/i, "").trim(); const useOwn = own && !(r.res === "even" && /loss/i.test(own)); return h("span", { class: `pill ${c}`, text: useOwn ? own : t }); };

function sectionLevel(sec) {
  if (!sec) return "Unknown";
  const t = String(sec).trim().toUpperCase();
  if (/FLOOR|FLR|GA|PIT|GENERAL/.test(t)) return "Floor / GA";
  const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
  if (isNaN(n)) return "Other";
  if (n < 100) return "Lower (1–99)";
  if (n < 200) return "100s";
  if (n < 300) return "200s";
  if (n < 400) return "300s";
  return "400s+";
}

function norm(r) {
  const n = (v) => (v == null || v === "" ? null : Number(v));
  const o = { ...r, total_sale: n(r.total_sale) ?? 0, total_cost: n(r.total_cost) ?? 0, profit: n(r.profit) ?? 0, roi: n(r.roi), cost_per: n(r.cost_per), sold_per: n(r.sold_per), quantity: n(r.quantity) ?? 0 };
  // sale time: from the post; if missing, when the Discord message was posted (never "when it was added")
  const posted = /^\d{15,20}$/.test(r.discord_message_id || "") ? Number(BigInt(r.discord_message_id) >> 22n) + 1420070400000 : null;
  o.ts = r.sold_at ? Date.parse(r.sold_at) : r.sold_date ? Date.parse(r.sold_date + "T12:00:00") : posted ?? Date.parse(r.created_at);
  o.day = r.sold_at ? nyDay.format(new Date(r.sold_at)) : r.sold_date || nyDay.format(new Date(o.ts));
  o.month = o.day.slice(0, 7); o.year = o.day.slice(0, 4);
  const bought = r.purchased_at ? Date.parse(r.purchased_at) : r.purchase_date ? Date.parse(r.purchase_date + "T12:00:00") : null;
  o.tts = bought && o.ts >= bought ? (o.ts - bought) / DAY : null;                       // days to sell
  o.lead = bought && r.event_date ? (Date.parse(r.event_date + "T20:00:00") - bought) / DAY : null; // bought this many days before the show
  o.res = resultOf(o); o.type = typeOf(o);
  return o;
}

function agg(rows) {
  const a = { n: rows.length, revenue: 0, cost: 0, profit: 0, tickets: 0, wins: 0, losses: 0, lossAmt: 0, ehh: 0, even: 0 };
  for (const r of rows) {
    a.revenue += r.total_sale; a.cost += r.total_cost; a.profit += r.profit; a.tickets += r.quantity;
    const c = Math.round(r.profit * 100);
    if (c < 0) { a.losses++; a.lossAmt += r.profit; } else if (c === 0) a.even++; else a.wins++;
    if (r.res === "ehh") a.ehh++;
  }
  a.roi = a.cost > 0 ? (a.profit / a.cost) * 100 : null;
  a.margin = a.revenue > 0 ? (a.profit / a.revenue) * 100 : null;
  a.winRate = a.n ? (a.wins / a.n) * 100 : null;
  const t = rows.map((r) => r.tts).filter((v) => v != null); a.tts = avg(t);
  a.last = rows.reduce((m, r) => Math.max(m, r.ts), 0);
  return a;
}
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null || k === "") continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m].map(([key, rs]) => ({ key, rows: rs, ...agg(rs) }));
}

export function makePortfolio(CFG) {
  const isMyRoute = () => location.hash.startsWith(`#${CFG.base}/`) || location.hash === `#${CFG.base}` || (CFG.base === "p" && location.hash === "");
/* ---------- module state (kept while you move between tabs) ---------- */
let ALL = null, rootEl = null, routeArgs = [];
const F = { preset: "all", from: "", to: "", artist: "", venue: "", account: "", result: "", type: "", q: "", monthKey: "", yearKey: "" };
let INV = null, TEAM = null;   // your unsold tickets (with expected profit) and what the company sold in the last 7 days
const UI = { commission: 20, tagMonth: null, tagVisible: false, bestPer: "month", trendBy: "week", salesSort: ["ts", -1], salesPage: 0, entSort: ["profit", -1], entQ: "", month: null, entityFilter: "", scoreSort: ["score", -1] };

function onNewSale(r) {
  if (!ALL) return;
  ALL.push(norm(r));
  if (rootEl && rootEl.isConnected && isMyRoute()) paint();
}

function presetRange(p) {
  const today = todayISO();
  if (p === "month") { const k = F.monthKey || today.slice(0, 7); return [k + "-01", `${k}-${String(daysInMonth(k)).padStart(2, "0")}`]; }
  if (p === "yearpick") { const y = F.yearKey || today.slice(0, 4); return [y + "-01-01", y + "-12-31"]; }
  if (p === "30d") return [addDays(today, -29), today];
  if (p === "year") return [today.slice(0, 5) + "01-01", today];
  return ["", ""];
}

const filtered = () => ALL.filter((r) => {
  if (F.from && r.day < F.from) return false;
  if (F.to && r.day > F.to) return false;
  if (F.artist && r.artist !== F.artist) return false;
  if (F.venue && r.venue !== F.venue) return false;
  if (F.account && r.account !== F.account) return false;
  if (F.result && !(F.result === "win" ? r.profit > 0 && Math.round(r.profit * 100) > 0 : r.res === F.result)) return false;
  if (F.type && r.type !== F.type) return false;
  if (F.q) { const q = F.q.toLowerCase(); if (![r.artist, r.venue, r.city, r.account, r.order_number, r.section, r.marketplace].some((v) => (v || "").toLowerCase().includes(q))) return false; }
  return true;
});

let loadedAt = 0;
async function loadAll() {
  const jobs = [fetchAll(CFG.table, COLS, "created_at")];
  if (CFG.inventory) jobs.push(fetchAll("inventory_outlook", "id,artist,discord_artist,venue,event_date,quantity,remaining_qty,remaining_cost,cost_per,expected_profit,expected_roi,basis", "event_date").catch(() => null),
    fetchAll("plt_artist_7d", "artist,sales,tickets,avg_sold_per,profit,roi,last_sold_at", "artist").catch(() => null));
  const [rows, inv, team] = await Promise.all(jobs);
  ALL = rows.map(norm); INV = inv; TEAM = team; loadedAt = Date.now();
}
/* your unsold tickets for upcoming shows, grouped by the artist name used on Discord */
const lc = (v) => (v || "").trim().toLowerCase();
function holdings() {
  if (!INV) return null;
  const today = todayISO(), m = new Map();
  for (const p of INV) {
    if (!(p.remaining_qty > 0) || !p.event_date || p.event_date < today) continue;
    const k = lc(p.discord_artist || p.artist), g = m.get(k) || { key: p.discord_artist || p.artist, left: 0, cost: 0, exp: 0, expCost: 0, next: p.event_date, soon: 0, soonCost: 0 };
    const cost = Number(p.remaining_cost || 0);
    g.left += p.remaining_qty; g.cost += cost; if (p.event_date < g.next) g.next = p.event_date;
    if (p.expected_profit != null) { g.exp += Number(p.expected_profit); g.expCost += cost; }
    if (p.event_date <= addDays(today, 7)) { g.soon += p.remaining_qty; g.soonCost += cost; }
    m.set(k, g);
  }
  return m;
}
const teamMap = () => new Map((TEAM || []).map((t) => [lc(t.artist), t]));
async function renderPortfolio(root, args) {
  rootEl = root; routeArgs = args || [];
  if (!ALL || Date.now() - loadedAt > 60000) {
    const [, prefs] = await Promise.all([loadAll(), loadPrefs()]);
    if (prefs && prefs.commission != null) UI.commission = Number(prefs.commission);
    if (prefs && prefs.goal) UI.goal = Number(prefs.goal);
  }
  paint();
}
// When you come back to the hub, quietly reload so numbers always match the database.
addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !ALL || Date.now() - loadedAt < 60000) return;
  await loadAll();
  if (rootEl && rootEl.isConnected && isMyRoute()) paint();
});

/* =========================================================
   Page frame: filters, KPIs, tabs
   ========================================================= */
// Repainting rebuilds the page, so remember which search box had focus (with its exact text and cursor)
// and put it back afterwards. Without this the cursor jumps to the start and trailing spaces vanish mid-typing.
function paint() {
  const a = document.activeElement, keep = a && a.dataset && a.dataset.keep
    ? { key: a.dataset.keep, value: a.value, start: a.selectionStart, end: a.selectionEnd } : null;
  paintPage();
  if (!keep) return;
  const el = rootEl && rootEl.querySelector(`[data-keep="${keep.key}"]`);
  if (!el) return;
  el.value = keep.value;
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(keep.start, keep.end); } catch {}
}

function paintPage() {
  const root = rootEl;
  if (!ALL.length) {
    root.replaceChildren(h("div", { class: "card empty" },
      h("h2", { text: "No sales yet" }),
      h("p", { text: CFG.emptyText }),
      h("a", { class: "btn primary", href: "#discord" }, "Go to Discord")));
    return;
  }
  const [tab, name] = routeArgs;
  const isEntity = tab === "artist" || tab === "venue" || tab === "account";
  // Overview and Sales open on this month; other tabs on all time, until you pick a period yourself.
  if (!UI.filtersTouched && !isEntity) {
    const want = ["overview", "sales"].includes(tab || CFG.tabs[0][0]) ? "month" : "all";
    if (F.preset !== want) { F.preset = want; [F.from, F.to] = presetRange(want); }
  }
  const rows = filtered();
  const t = agg(rows);
  const view = isEntity ? entityView(tab, name) : (TABVIEWS[tab === "tag" || tab === "monthly" ? "month" : tab] || TABVIEWS[CFG.tabs[0][0]])(rows, t);
  const banner = CFG.title ? h("div", { class: "book-banner" }, h("b", { text: CFG.title }), h("span", { class: "muted", text: CFG.subtitle || "" })) : "";
  const active = TABVIEWS[tab] && CFG.tabs.some(([k]) => k === tab) ? tab : CFG.tabs[0][0];
  // TAG & Month and Day · 3 days · Week have their own periods, so the filters and top numbers only show on the analysis tabs.
  const ownPeriod = active === "month" || active === "recent";
  const strip = CFG.inventory ? insightStrip() : "";
  if (isEntity) root.replaceChildren(banner, strip, tabsBar("", t), view);
  else root.replaceChildren(banner, strip, ownPeriod ? "" : filterBar(), ownPeriod ? "" : (CFG.showTag ? kpiRow(t, rows) : kpiRowPlain(t)), tabsBar(active, t), view);
  arrange(root, `${CFG.base}/${isEntity ? tab : active}`);
}

/* ---------- rotating insight line ---------- */
let stripTimer = null;
function insightList() {
  const now = Date.now(), last30 = ALL.filter((r) => r.ts > now - 30 * DAY), a30 = agg(last30), out = [];
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], full = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  const bought = ALL.filter((r) => r.purchased_at || r.purchase_date);
  const byBuy = wd.map((d) => ({ d, ...agg(bought.filter((r) => nyWeekday.format(new Date(r.purchased_at || r.purchase_date + "T12:00:00")) === d)) })).filter((b) => b.n >= 10 && b.roi != null).sort((x, y) => y.roi - x.roi);
  if (byBuy.length >= 2) {
    out.push(["Best day to buy", `Tickets bought on a ${full[byBuy[0].d]} returned ${sp(byBuy[0].roi, 1)} on average.`, "up"]);
    const w = byBuy[byBuy.length - 1]; out.push(["Weakest day to buy", `${full[w.d]} purchases averaged ${sp(w.roi, 1)} ROI.`, w.roi < 0 ? "down" : "meh"]);
  }
  const top = groupBy(last30, (r) => r.artist).filter((g) => g.n >= 3).sort((x, y) => y.roi - x.roi)[0];
  if (top) out.push(["Top artist, last 30 days", `${top.key}: ${plural(top.n, "sale")} at ${sp(top.roi, 1)} ROI.`, "up"]);
  if (a30.n) out.push(["Last 30 days", `${fmtPct(a30.winRate, 0)} of ${plural(a30.n, "sale")} made money (${a30.wins} won, ${a30.losses} lost).`, a30.winRate >= 70 ? "up" : "meh"]);
  const sold = wd.map((d) => ({ d, ...agg(ALL.filter((r) => nyWeekday.format(new Date(r.ts)) === d)) })).sort((x, y) => y.n - x.n)[0];
  if (sold && sold.n) out.push(["Busiest selling day", `Most of your sales land on ${full[sold.d]} (${plural(sold.n, "sale")} all time).`, ""]);
  const hold = holdings();
  if (hold) {
    const soon = [...hold.values()].reduce((x, g) => ({ n: x.n + g.soon, c: x.c + g.soonCost }), { n: 0, c: 0 });
    if (soon.n) out.push(["Price to move", `${plural(soon.n, "ticket")} (${money(soon.c)} at cost) are for shows in the next 7 days.`, "meh"]);
    const tm = teamMap();
    const hot = [...hold.values()].map((g) => ({ g, t: tm.get(lc(g.key)) })).filter((x) => x.t && x.t.sales >= 3).sort((x, y) => y.t.sales - x.t.sales)[0];
    if (hot) out.push(["Team is selling", `The company sold ${plural(hot.t.sales, "order")} of ${hot.g.key} this week at ${money(Number(hot.t.avg_sold_per))} a ticket. You hold ${plural(hot.g.left, "ticket")}.`, "up"]);
  }
  return out;
}
function insightStrip() {
  clearInterval(stripTimer);
  const items = insightList(); if (!items.length) return "";
  let i = (UI.stripIndex || 0) % items.length;
  const lbl = h("b"), txt = h("span"), count = h("span", { class: "muted" });
  const show = () => { const [l, t, c] = items[i]; lbl.textContent = l; lbl.className = c; txt.textContent = t; count.textContent = `${i + 1}/${items.length}`; UI.stripIndex = i; };
  const step = (n) => { i = (i + n + items.length) % items.length; show(); };
  const el = h("div", { class: "insight-strip", role: "status", "aria-live": "polite" }, lbl, txt, h("span", { class: "spacer" }), count,
    h("button", { type: "button", class: "icon", "aria-label": "Previous insight", text: "◀", onclick: () => step(-1) }),
    h("button", { type: "button", class: "icon", "aria-label": "Next insight", text: "▶", onclick: () => step(1) }));
  show();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) stripTimer = setInterval(() => { if (!el.isConnected) return clearInterval(stripTimer); if (!el.matches(":hover")) step(1); }, 7000);
  return el;
}

function filterBar() {
  const uniq = (k) => [...new Set(ALL.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sel = (id, label, key, opts, allText) => {
    const el = h("select", { id }, h("option", { value: "", text: allText }), opts.map((o) => (Array.isArray(o) ? h("option", { value: o[0], text: o[1] }) : h("option", { value: o, text: o }))));
    el.value = F[key];
    el.onchange = () => { F[key] = el.value; UI.filtersTouched = true; UI.salesPage = 0; paint(); };
    return h("div", { class: "f" }, h("label", { for: id, text: label }), el);
  };
  const date = (id, label, key) => {
    const el = h("input", { type: "date", id, value: F[key] });
    el.onchange = () => { F[key] = el.value; F.preset = "custom"; UI.filtersTouched = true; paint(); };
    return h("div", { class: "f" }, h("label", { for: id, text: label }), el);
  };
  const q = h("input", { type: "search", id: "f-q", placeholder: "Artist, venue, order #…", value: F.q, "data-keep": "f-q" });
  let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { F.q = q.value.trim(); UI.filtersTouched = true; UI.salesPage = 0; paint(); }, 350); };
  const presets = [["month", "Month"], ["yearpick", "Year"], ["30d", "Last 30 days"], ["all", "All time"], ["custom", "Custom dates"]];
  const anyFilter = UI.filtersTouched;
  const activeCount = [F.artist, F.venue, F.account, F.q].filter(Boolean).length + (F.preset === "custom" ? 1 : 0);
  const go = (fn) => () => { fn(); if (F.preset !== "custom") [F.from, F.to] = presetRange(F.preset); UI.filtersTouched = true; UI.salesPage = 0; paint(); };
  const curM = todayISO().slice(0, 7), curY = curM.slice(0, 4);
  const shiftMonth = (k, n) => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  let stepper = "";
  if (F.preset === "month") {
    const k = F.monthKey || curM, recent = Array.from({ length: 6 }, (_, i) => shiftMonth(curM, -i)).reverse();
    stepper = h("div", { class: "stepper" },
      h("button", { type: "button", class: "icon", "aria-label": "Previous month", text: "◀", onclick: go(() => (F.monthKey = shiftMonth(k, -1))) }),
      h("b", { class: "step-label", text: monthLabel(k, true) }),
      h("button", { type: "button", class: "icon", "aria-label": "Next month", text: "▶", disabled: k >= curM, onclick: go(() => (F.monthKey = shiftMonth(k, 1))) }),
      h("span", { class: "month-pills" }, recent.map((m) => h("button", { type: "button", class: m === k ? "on" : "", text: monthLabel(m), onclick: go(() => (F.monthKey = m)) }))));
  } else if (F.preset === "yearpick") {
    const y = F.yearKey || curY;
    stepper = h("div", { class: "stepper" },
      h("button", { type: "button", class: "icon", "aria-label": "Previous year", text: "◀", onclick: go(() => (F.yearKey = String(Number(y) - 1))) }),
      h("b", { class: "step-label", text: y }),
      h("button", { type: "button", class: "icon", "aria-label": "Next year", text: "▶", disabled: y >= curY, onclick: go(() => (F.yearKey = String(Number(y) + 1))) }));
  }
  // sale-type chips, counted on everything else you've filtered
  const saved = F.type; F.type = ""; const base = filtered(); F.type = saved;
  const counts = Object.fromEntries(TYPES.map(([k]) => [k, 0])); base.forEach((r) => counts[r.type]++);
  const typeChips = h("div", { class: "type-chips", role: "group", "aria-label": "Sale type" },
    h("button", { type: "button", class: !F.type ? "on" : "", onclick: go(() => (F.type = "")) }, "All ", h("span", { class: "n", text: fmtInt(base.length) })),
    TYPES.map(([k, label]) => h("button", { type: "button", class: `t-${k} ${F.type === k ? "on" : ""}`, disabled: !counts[k] && F.type !== k, onclick: go(() => (F.type = F.type === k ? "" : k)) }, `${label} `, h("span", { class: "n", text: fmtInt(counts[k]) }))));
  return h("div", {},
    h("button", { type: "button", class: "filter-toggle", "aria-expanded": String(!!UI.filtersOpen), onclick: () => { UI.filtersOpen = !UI.filtersOpen; paint(); } }, `Filters${activeCount ? ` (${activeCount})` : ""}`),
    h("div", { class: `filters ${UI.filtersOpen ? "open" : ""}` },
      F.preset === "custom" ? [date("f-from", "Sold from", "from"), date("f-to", "Sold to", "to")] : "",
      sel("f-artist", "Artist / event", "artist", uniq("artist"), "All artists"),
      sel("f-venue", "Venue", "venue", uniq("venue"), "All venues"),
      sel("f-acct", "Buyer account", "account", uniq("account"), "All accounts"),
      h("div", { class: "f" }, h("label", { for: "f-q", text: "Search" }), q)),
    h("div", { class: "presets" },
      presets.map(([k, label]) => h("button", { type: "button", class: `preset ${F.preset === k ? "on" : ""}`, text: label, onclick: k === "custom" ? () => { F.preset = "custom"; UI.filtersOpen = true; UI.filtersTouched = true; paint(); } : go(() => (F.preset = k)) })),
      stepper,
      anyFilter ? h("button", { type: "button", class: "preset", text: "Reset filters", title: "Show all sales again. Nothing is deleted.", onclick: () => { Object.assign(F, { preset: "all", from: "", to: "", artist: "", venue: "", account: "", result: "", type: "", q: "", monthKey: "", yearKey: "" }); UI.filtersTouched = false; paint(); } }) : ""),
    typeChips);
}

function kpiRow(t) {
  const eye = h("button", { type: "button", class: "eye", text: UI.tagVisible ? "Hide" : "Show", "aria-pressed": String(UI.tagVisible), onclick: () => { UI.tagVisible = !UI.tagVisible; paint(); } });
  const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  const masked = (v, c) => h("div", { class: `v ${UI.tagVisible ? c : "masked"}`, text: UI.tagVisible ? v : "••••••" });
  return h("div", { class: "kpis" },
    h("div", { class: "kpi tag" }, h("div", { class: "lbl", text: "TAG (net profit)" }), eye, masked(sm(t.profit), cls(t.profit)),
      h("div", { class: "f", text: t.losses ? `After ${money(Math.abs(t.lossAmt))} in losses` : "No losses" })),
    h("div", { class: "kpi tag" }, h("div", { class: "lbl", text: `Your commission (${UI.commission}%)` }), masked(money(commissionOf(t.profit)), ""),
      h("div", { class: "f", text: `${UI.commission}% of the TAG` })),
    kpi("Gross sales", money(t.revenue), `Cost ${money(t.cost)}`),
    kpi("Weighted ROI", sp(t.roi), `Margin ${sp(t.margin)}`, cls(t.roi)),
    kpi("Sales", fmtInt(t.n), `${fmtInt(t.tickets)} tickets · ${fmtInt(t.wins)} win · ${fmtInt(t.losses)} loss`));
}
const commissionOf = (profit) => Math.max(0, profit) * (UI.commission / 100);
function kpiRowPlain(t) {
  const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  return h("div", { class: "kpis" },
    kpi("Total profit", sm(t.profit), t.losses ? `After ${money(Math.abs(t.lossAmt))} in losses` : "No losses", cls(t.profit)),
    kpi("Gross sales", money(t.revenue), `Cost ${money(t.cost)}`),
    kpi("Weighted ROI", sp(t.roi), `Margin ${sp(t.margin)}`, cls(t.roi)),
    kpi("Sales", fmtInt(t.n), `${fmtInt(t.tickets)} tickets · ${fmtInt(t.wins)} win · ${fmtInt(t.losses)} loss`),
    kpi("Win rate", fmtPct(t.winRate, 1), `Avg ${sm(t.n ? t.profit / t.n : 0)} per sale`));
}
function venueBoard(rows) {
  const vs = groupBy(rows, (r) => r.venue).filter((g) => g.n >= 3).sort((a, b) => b.roi - a.roi).slice(0, 12);
  return vs.length ? table([["key", "Venue", "", (g) => entityLink("venue", g.key)], ["n", "Sales", "r"], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })], ["winRate", "Win rate", "r", (g) => fmtPct(g.winRate, 0)]], vs) : empty("Not enough sales yet.");
}

function tabsBar(active, t) {
  return h("nav", { class: "tabs", "aria-label": "Portfolio views" },
    CFG.tabs.map(([k, label]) => h("a", { href: `#${CFG.base}/${k}`, class: active === k ? "active" : "", "aria-current": active === k ? "page" : null }, label,
      k === "losses" && t.losses ? h("span", { class: "count", text: fmtInt(t.losses) }) : "")));
}

const card = (title, body, actions = null, note = null) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title }), h("span", { class: "spacer" }), actions), body, note ? h("p", { class: "note-line", text: note }) : "");
const seg = (opts, cur, onPick) => h("div", { class: "seg", role: "group" }, opts.map(([v, t]) => h("button", { type: "button", class: cur === v ? "on" : "", text: t, onclick: () => onPick(v) })));
const entityLink = (kind, name) => name ? h("a", { class: "link-like", href: `#${CFG.base}/${kind}/${encodeURIComponent(name)}`, text: name }) : h("span", { class: "muted", text: "—" });
const empty = (text) => h("p", { class: "muted", text });

function table(cols, rows, opts = {}) {
  // cols: [key, label, align('r'|''), render(row) => Node|string, sortVal?(row)]
  const sortState = opts.sortState;
  const thead = h("thead", {}, h("tr", {}, cols.map(([k, label, al, , sv]) => {
    const sortable = !!sortState && sv !== false;
    const active = sortable && sortState[0] === k;
    const th = h("th", { class: al || "", scope: "col", tabindex: sortable ? "0" : null }, label, active ? h("span", { class: "arrow", text: sortState[1] > 0 ? " ▲" : " ▼" }) : "");
    if (sortable) { const go = () => { if (sortState[0] === k) sortState[1] *= -1; else { sortState[0] = k; sortState[1] = al === "r" ? -1 : 1; } opts.onSort(); }; th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter") go(); }; }
    return th;
  })));
  const tbody = h("tbody", {}, rows.map((r, i) => h("tr", { class: opts.rowClass ? opts.rowClass(r, i) : "" }, cols.map(([k, , al, render]) => {
    const v = render ? render(r, i) : r[k];
    return h("td", { class: al || "" }, v instanceof Node ? v : String(v ?? "—"));
  }))));
  return h("div", { class: "table-wrap" }, h("table", {}, thead, tbody));
}
function sortRows(rows, [key, dir], getter) {
  return [...rows].sort((a, b) => {
    const x = getter ? getter(a, key) : a[key], y = getter ? getter(b, key) : b[key];
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

/* =========================================================
   Tabs
   ========================================================= */
const TABVIEWS = {
  month: () => monthView(),
  recent: () => recentView(),
  overview(rows) {
    if (!rows.length) return card("Overview", empty("No sales match these filters."));
    const months = groupBy(rows, (r) => r.month).sort((a, b) => a.key.localeCompare(b.key));
    let run = 0;
    const chart = barChart({
      label: "Revenue and profit by month", height: 300,
      labels: months.map((m) => monthLabel(m.key)), titles: months.map((m) => monthLabel(m.key, true)),
      series: [{ name: "Revenue", values: months.map((m) => m.revenue), color: "var(--series-1)" }, { name: "Profit", values: months.map((m) => m.profit), color: "var(--series-2)", negColor: "var(--down)" }],
      line: { name: "Running profit", values: months.map((m) => (run += m.profit)), color: "#9ec5f4" },
      tip: (i) => [["Revenue", money(months[i].revenue)], ["Profit", sm(months[i].profit), cls(months[i].profit)], ["ROI", sp(months[i].roi)], ["Sales", fmtInt(months[i].n)], ["Running profit", sm(months.slice(0, i + 1).reduce((a, m) => a + m.profit, 0))]],
    });
    const topTable = (kind, groups) => {
      const top = [...groups].sort((a, b) => b.profit - a.profit).slice(0, 8);
      const max = Math.max(1, ...top.map((g) => Math.abs(g.profit)));
      return table([["key", KIND[kind][0], "", (g, i) => h("span", {}, h("span", { class: "muted", text: `${i + 1}  ` }), entityLink(kind, g.key))],
        ["n", "Sales", "r"],
        ["profit", "Profit", "r", (g) => h("div", {}, h("span", { class: cls(g.profit), text: sm(g.profit) }), h("div", { class: "mini-bar" }, h("i", { class: g.profit < 0 ? "down" : "", style: { width: `${(Math.abs(g.profit) / max) * 100}%` } })))],
        ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], top);
    };
    const markets = groupBy(rows, (r) => r.marketplace).sort((a, b) => b.profit - a.profit);
    return h("div", { class: "stack" },
      CFG.inventory ? stillToSell() : "",
      h("div", { class: "grid g-2" }, card("Revenue and profit by month", chart, legend([["Revenue", "var(--series-1)"], ["Profit", "var(--series-2)"], ["Running profit", "#9ec5f4"]])),
        card("Where you sold", markets.length ? table([["key", "Marketplace", ""], ["n", "Sales", "r"], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], markets) : empty("No marketplace info yet."))),
      h("div", { class: "grid g-2e" }, card("Top artists by profit", topTable("artist", groupBy(rows, (r) => r.artist)), h("a", { class: "btn icon", href: `#${CFG.base}/artists` }, "All artists")),
        card("Top venues by profit", topTable("venue", groupBy(rows, (r) => r.venue)), h("a", { class: "btn icon", href: `#${CFG.base}/venues` }, "All venues"))),
    );
  },

  sales(rows) {
    const per = 50;
    const getter = (r, k) => (k === "ts" ? r.ts : r[k]);
    const sorted = sortRows(rows, UI.salesSort, getter);
    const pages = Math.max(1, Math.ceil(sorted.length / per));
    UI.salesPage = Math.min(UI.salesPage, pages - 1);
    const pageRows = sorted.slice(UI.salesPage * per, UI.salesPage * per + per);
    const tbl = table([
      ["ts", "Sold", "", (r) => h("div", { class: "num" }, new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }), h("span", { class: "sub", text: r.tts != null ? `in ${dur(r.tts)}` : "" }))],
      ["artist", "Artist", "", (r) => h("div", {}, entityLink("artist", r.artist), badge(r), h("span", { class: "sub", text: r.account || "" }))],
      ["event_date", "Show date", "", (r) => h("span", { class: "num", text: fmtDate(r.event_date) })],
      ["venue", "Venue", "", (r) => h("div", {}, entityLink("venue", r.venue), h("span", { class: "sub", text: r.city || "" }))],
      ["quantity", "Tickets", "", (r) => h("div", {}, h("span", { class: "num", text: `${r.quantity}×` }), h("span", { class: "sub", text: [r.section && `Sec ${r.section}`, r.row_name && `Row ${r.row_name}`].filter(Boolean).join(" · ") }))],
      ["total_sale", "Total", "r", (r) => money(r.total_sale)],
      ["profit", "Profit", "r", (r) => h("span", { class: `chip-money ${cls(r.profit)}`, text: sm(r.profit) })],
      ["roi", "ROI", "r", (r) => h("span", { class: cls(r.roi), text: sp(r.roi) })],
      ["cost_per", "Cost per", "r", (r) => money(r.cost_per)],
      ["sold_per", "Sold per", "r", (r) => money(r.sold_per)],
      ["marketplace", "Sold on", "", (r) => r.marketplace || "—"],
    ], pageRows, { sortState: UI.salesSort, onSort: paint });
    const cols = [["day", "Sold date"], ["artist", "Artist"], ["event_date", "Show date"], ["venue", "Venue"], ["city", "City"], ["section", "Section"], ["row_name", "Row"], ["quantity", "Tickets"], ["total_sale", "Total"], ["total_cost", "Cost"], ["profit", "Profit"], ["roi", "ROI"], ["cost_per", "Cost per"], ["sold_per", "Sold per"], ["marketplace", "Sold on"], ["account", "Account"], ["order_number", "Order #"]];
    return card(`Sales data · ${fmtInt(rows.length)} of ${fmtInt(ALL.length)}`, h("div", {}, tbl,
      h("div", { class: "pager" }, h("span", { text: `Page ${UI.salesPage + 1} of ${pages}` }),
        h("button", { class: "icon", disabled: UI.salesPage === 0, onclick: () => { UI.salesPage--; paint(); } }, "Previous"),
        h("button", { class: "icon", disabled: UI.salesPage >= pages - 1, onclick: () => { UI.salesPage++; paint(); } }, "Next"))),
      h("button", { type: "button", class: "icon", onclick: () => exportCsv(cols, sorted, "sales") }, "Export CSV"));
  },

  artists: (rows) => entityList("artist", rows),
  accounts: (rows) => entityList("account", rows),
  venues: (rows) => entityList("venue", rows),

  buying(rows) {
    const bucket = (rs, field, edges) => edges.map(([label, lo, hi]) => ({ label, ...agg(rs.filter((r) => r[field] != null && r[field] >= lo && r[field] < hi)) }));
    const lead = bucket(rows, "lead", [["Under 1 week", 0, 7], ["1–4 weeks", 7, 30], ["1–2 months", 30, 60], ["2–4 months", 60, 120], ["4+ months", 120, 1e9]]);
    const tts = bucket(rows, "tts", [["Same day", 0, 1], ["1–7 days", 1, 7], ["1–2 weeks", 7, 14], ["2–4 weeks", 14, 30], ["1–2 months", 30, 60], ["2+ months", 60, 1e9]]);
    const wdOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const bought = rows.filter((r) => r.purchased_at || r.purchase_date);
    const byWd = wdOrder.map((d) => ({ label: d, ...agg(bought.filter((r) => nyWeekday.format(new Date(r.purchased_at || r.purchase_date + "T12:00:00")) === d)) }));
    const hasLead = lead.some((b) => b.n), hasTts = tts.some((b) => b.n);
    const bestLead = [...lead].filter((b) => b.n >= 2).sort((a, b) => b.roi - a.roi)[0];
    const cash = avg(rows.map((r) => r.tts).filter((v) => v != null));
    const roiChart = (bs, name) => barChart({ label: name, labels: bs.map((b) => b.label), series: [{ name: "Avg ROI", values: bs.map((b) => (b.n ? b.roi : null)), color: "var(--accent)", negColor: "var(--down)" }],
      fmt: (v) => `${Math.round(v)}%`, tip: (i) => [["Avg ROI", sp(bs[i].roi), cls(bs[i].roi)], ["Sales", fmtInt(bs[i].n)], ["Profit", sm(bs[i].profit), cls(bs[i].profit)]], height: 190 });
    return h("div", { class: "stack" },
      card("What the data says", h("ul", { class: "summary" },
        bestLead ? h("li", {}, "Your best ROI comes from buying ", h("b", { text: bestLead.label.toLowerCase() }), ` before the show (${sp(bestLead.roi)} average over ${plural(bestLead.n, "sale")}).`) : h("li", { text: "Buy-timing insights appear once sales include a purchase date." }),
        cash != null ? h("li", {}, "Your money is tied up for ", h("b", { text: dur(cash) }), " on average between buying and the sale.") : "",
        (() => { const w = [...byWd].filter((b) => b.n >= 2).sort((a, b) => b.roi - a.roi)[0]; return w ? h("li", {}, `Tickets bought on a `, h("b", { text: w.label }), ` returned the most (${sp(w.roi)} average ROI).`) : ""; })())),
      h("div", { class: "grid g-2e" },
        card("ROI by how early you bought", hasLead ? roiChart(lead, "ROI by how early you bought") : empty("Needs purchase and show dates."), null, "Time between your purchase and the show date."),
        card("How long until it sold", hasTts ? barChart({ label: "Sales by time to sell", labels: tts.map((b) => b.label), series: [{ name: "Sales", values: tts.map((b) => b.n), color: "var(--series-1)" }],
          fmt: (v) => fmtInt(v), tip: (i) => [["Sales", fmtInt(tts[i].n)], ["Avg ROI", sp(tts[i].roi), cls(tts[i].roi)], ["Profit", sm(tts[i].profit), cls(tts[i].profit)]], height: 190 }) : empty("Needs purchase dates."), null, "How long your money was tied up before each sale.")),
      card("ROI by the day you bought", bought.length ? roiChart(byWd, "ROI by purchase weekday") : empty("Needs purchase dates.")));
  },

  losses(rows) {
    const losers = rows.filter((r) => Math.round(r.profit * 100) < 0).sort((a, b) => a.profit - b.profit);
    const ehh = rows.filter((r) => r.res === "ehh" || r.res === "even");
    const lost = losers.reduce((a, r) => a + r.profit, 0);
    const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
    const byA = groupBy(losers, (r) => r.artist).sort((a, b) => a.profit - b.profit).slice(0, 10);
    const byV = groupBy(losers, (r) => r.venue).sort((a, b) => a.profit - b.profit).slice(0, 10);
    const lossTable = (kind, gs) => gs.length ? table([["key", KIND[kind][0], "", (g) => entityLink(kind, g.key)], ["n", "Losses", "r"], ["profit", "Lost", "r", (g) => h("span", { class: "down", text: sm(g.profit) })]], gs) : empty("No losses here.");
    return h("div", { class: "stack" },
      h("div", { class: "kpis" },
        kpi("Losing sales", fmtInt(losers.length), rows.length ? `${fmtPct((losers.length / rows.length) * 100, 1)} of sales` : "", losers.length ? "down" : ""),
        kpi("Total lost", sm(lost), "Money lost on losing sales", lost < 0 ? "down" : ""),
        kpi("Biggest loss", losers[0] ? sm(losers[0].profit) : "—", losers[0] ? losers[0].artist : "None", losers[0] ? "down" : ""),
        kpi("Barely made money", fmtInt(ehh.length), "Ehh or break-even sales", ehh.length ? "meh" : "")),
      h("div", { class: "grid g-2e" }, card("Losses by artist", lossTable("artist", byA)), card("Losses by venue", lossTable("venue", byV))),
      card(`Losing sales · ${fmtInt(losers.length)}`, losers.length ? table([
        ["day", "Sold", "", (r) => h("span", { class: "num", text: fmtDate(r.day) })],
        ["artist", "Artist", "", (r) => h("div", {}, entityLink("artist", r.artist), h("span", { class: "sub", text: r.account || "" }))],
        ["venue", "Venue", "", (r) => entityLink("venue", r.venue)],
        ["quantity", "Tickets", "r"], ["cost_per", "Cost per", "r", (r) => money(r.cost_per)], ["sold_per", "Sold per", "r", (r) => money(r.sold_per)],
        ["profit", "Lost", "r", (r) => h("span", { class: "chip-money down", text: sm(r.profit) })], ["roi", "ROI", "r", (r) => h("span", { class: "down", text: sp(r.roi) })]], losers.slice(0, 100)) : empty("No losing sales. Nice.")));
  },

  insights(rows) {
    return insightsView(rows);
  },
};

function whenText(r) { return new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

/* ---------- what you still hold, and what it should make ---------- */
function stillToSell() {
  const hold = holdings();
  if (!hold || !hold.size) return "";
  const gs = [...hold.values()], left = gs.reduce((a, g) => a + g.left, 0), cost = gs.reduce((a, g) => a + g.cost, 0);
  const exp = gs.reduce((a, g) => a + g.exp, 0), expCost = gs.reduce((a, g) => a + g.expCost, 0);
  const soon = gs.reduce((a, g) => a + g.soon, 0);
  const hide = !UI.tagVisible, kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  return h("div", { class: "kpis four" },
    kpi("Still to sell", fmtInt(left), `${plural(hold.size, "artist")} with upcoming shows`),
    kpi("Money tied up", money(cost), "What those tickets cost you"),
    kpi("Expected profit", hide ? "••••••" : sm(exp), expCost ? `${sp((exp / expCost) * 100, 1)} expected ROI on ${money(expCost)} with history` : "No sales history yet", hide ? "masked" : cls(exp)),
    kpi("Shows in the next 7 days", fmtInt(soon), soon ? "Tickets to price and move" : "Nothing urgent", soon ? "meh" : ""));
}

/* ---------- artists / venues list ---------- */
function trendOf(rs) {
  const now = Date.now(), a = rs.filter((r) => r.ts > now - 30 * DAY), b = rs.filter((r) => r.ts <= now - 30 * DAY && r.ts > now - 60 * DAY);
  const pa = a.reduce((x, r) => x + r.profit, 0), pb = b.reduce((x, r) => x + r.profit, 0);
  if (!a.length && !b.length) return { dir: 0, text: "Quiet" };
  return pa >= pb ? { dir: 1, text: "Up" } : { dir: -1, text: "Down" };
}
function entityList(kind, rows) {
  const held = kind === "artist" ? holdings() : null;
  const groups = groupBy(rows, (r) => r[kind]).map((g) => ({ ...g, trend: trendOf(g.rows), avgCost: g.tickets ? g.cost / g.tickets : null, left: held ? held.get(lc(g.key))?.left || 0 : null }));
  const q = h("input", { type: "search", placeholder: `Find ${KIND[kind][2]}`, value: UI.entQ, "data-keep": `ent-${kind}`, style: { maxWidth: "260px" } });
  let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { UI.entQ = q.value.trim(); paint(); }, 300); };
  const list = sortRows(groups.filter((g) => !UI.entQ || g.key.toLowerCase().includes(UI.entQ.toLowerCase())), UI.entSort);
  const max = Math.max(1, ...list.map((g) => Math.abs(g.profit)));
  const hold = kind === "artist" ? holdings() : null;
  const leftCol = hold ? [["left", "Left", "r", (g) => (g.left ? h("b", { text: fmtInt(g.left), title: "Unsold tickets for upcoming shows" }) : h("span", { class: "muted", text: "—" }))]] : [];
  return card(`${KIND[kind][1]} · ${fmtInt(list.length)}`, table([
    ["key", KIND[kind][0], "", (g) => entityLink(kind, g.key)],
    ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ...leftCol, ["revenue", "Revenue", "r", (g) => money(g.revenue)],
    ["profit", "Profit", "r", (g) => h("div", {}, h("span", { class: cls(g.profit), text: sm(g.profit) }), h("div", { class: "mini-bar" }, h("i", { class: g.profit < 0 ? "down" : "", style: { width: `${(Math.abs(g.profit) / max) * 100}%` } })))],
    ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })],
    ["winRate", "Win rate", "r", (g) => fmtPct(g.winRate, 0)],
    ["avgCost", "Avg cost/tix", "r", (g) => money(g.avgCost)],
    ["tts", "Avg time to sell", "r", (g) => dur(g.tts)],
    ["last", "Last sale", "r", (g) => fmtDate(nyDay.format(new Date(g.last)))],
    ["trend", "30-day trend", "r", (g) => h("span", { class: g.trend.dir > 0 ? "up" : g.trend.dir < 0 ? "down" : "muted", text: `${g.trend.dir > 0 ? "▲ " : g.trend.dir < 0 ? "▼ " : ""}${g.trend.text}` }), false],
  ], list, { sortState: UI.entSort, onSort: paint }), q, "Click a name to see its full breakdown. Trend compares the last 30 days of profit with the 30 before.");
}

/* ---------- artist / venue detail ---------- */
function entityView(kind, rawName) {
  const name = decodeURIComponent(rawName || "");
  const other = kind === "artist" ? "venue" : "artist";
  const base = ALL.filter((r) => r[kind] === name);
  if (!base.length) return card("Not found", h("div", {}, empty(`No sales found for “${name}”.`), h("a", { class: "btn", href: `#${CFG.base}/${kind}s` }, "Back")));
  if (UI.entName !== kind + name) { UI.entName = kind + name; UI.entityFilter = ""; }
  const others = groupBy(base, (r) => r[other]).sort((a, b) => b.n - a.n);
  if (UI.entityFilter && !others.some((o) => o.key === UI.entityFilter)) UI.entityFilter = "";
  const rows = UI.entityFilter ? base.filter((r) => r[other] === UI.entityFilter) : base;
  const t = agg(rows), tr = trendOf(rows);
  const shows = new Set(rows.map((r) => `${r.event_date}|${r.venue}`)).size;

  // trend chart
  const keyFn = UI.trendBy === "day" ? (r) => r.day : UI.trendBy === "week" ? (r) => weekStart(r.day) : (r) => r.month;
  const periods = groupBy(rows, keyFn).sort((a, b) => a.key.localeCompare(b.key));
  let run = 0;
  const lab = (k) => (UI.trendBy === "month" ? monthLabel(k) : dayLabel(k));
  const chart = barChart({ label: "Trend", labels: periods.map((p) => lab(p.key)), titles: periods.map((p) => (UI.trendBy === "week" ? `Week of ${dayLabel(p.key)}` : UI.trendBy === "month" ? monthLabel(p.key, true) : dayLabel(p.key))),
    series: [{ name: "Profit", values: periods.map((p) => p.profit), color: "var(--accent)", negColor: "var(--down)" }],
    line: { name: "Running total", values: periods.map((p) => (run += p.profit)), color: "#9ec5f4" },
    tip: (i) => [["Profit", sm(periods[i].profit), cls(periods[i].profit)], ["Sales", fmtInt(periods[i].n)], ["Tickets", fmtInt(periods[i].tickets)], ["Running total", sm(periods.slice(0, i + 1).reduce((a, p) => a + p.profit, 0))]], height: 230 });

  // period cards
  const today = todayISO(), ws = weekStart(today), lws = addDays(ws, -7), ms = today.slice(0, 7), lms = prevMonthKey(ms);
  const period = (label, rs, range) => { const a = agg(rs); return h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${cls(a.profit)}`, text: a.n ? sm(a.profit) : "—" }), h("div", { class: "f", text: a.n ? `${plural(a.n, "sale")} · ${plural(a.tickets, "ticket")} · ${sp(a.roi)}` : "No sales" }), h("div", { class: "f", text: range })); };
  const first = rows.reduce((m, r) => Math.min(m, r.ts), Infinity);
  const secs = groupBy(rows, (r) => r.section).sort((a, b) => b.profit - a.profit);
  const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  const avgCostT = t.tickets ? t.cost / t.tickets : null, avgSoldT = t.tickets ? t.revenue / t.tickets : null;
  const showsList = groupBy(rows, (r) => `${r.event_date || ""}|${kind === "artist" ? r.venue : kind === "venue" ? r.artist : `${r.artist} @ ${r.venue || ""}`}`).sort((a, b) => (b.key > a.key ? 1 : -1));

  return h("div", { class: "stack" },
    h("div", {},
      h("div", { class: "crumbs" }, h("a", { href: `#${CFG.base}/${kind}s`, text: KIND[kind][1] }), "/", name),
      h("div", { class: "entity-title" }, h("h1", { text: name }),
        h("span", { class: "muted", text: `${KIND[kind][0]} · ${plural(others.length, other)} · ${plural(shows, "show")} · Recent trend ` }),
        h("span", { class: tr.dir > 0 ? "up" : tr.dir < 0 ? "down" : "muted", text: `${tr.dir > 0 ? "▲" : tr.dir < 0 ? "▼" : "•"} ${tr.text.toLowerCase()}` })),
      h("div", { class: "chipset" }, h("span", { class: "lbl", text: `${other}s:` }),
        h("button", { type: "button", class: UI.entityFilter ? "" : "on", onclick: () => { UI.entityFilter = ""; paint(); } }, `All ${other}s `, h("span", { class: "muted", text: String(base.length) })),
        others.slice(0, 12).map((o) => h("button", { type: "button", class: UI.entityFilter === o.key ? "on" : "", onclick: () => { UI.entityFilter = o.key; paint(); } }, `${o.key} `, h("span", { class: cls(o.profit), text: sm(o.profit) }))))),
    card("How it's trending", chart, seg([["day", "Day"], ["week", "Week"], ["month", "Month"]], UI.trendBy, (v) => { UI.trendBy = v; paint(); }), "Bars = profit in each period (hover for tickets and sales). Line = running total."),
    h("div", { class: "kpis" },
      period("This week", rows.filter((r) => r.day >= ws), `${dayLabel(ws)} – ${dayLabel(addDays(ws, 6))}`),
      period("Last week", rows.filter((r) => r.day >= lws && r.day < ws), `${dayLabel(lws)} – ${dayLabel(addDays(lws, 6))}`),
      period("This month", rows.filter((r) => r.month === ms), monthLabel(ms, true)),
      period("Last month", rows.filter((r) => r.month === lms), monthLabel(lms, true)),
      period("All time", rows, `${fmtDate(nyDay.format(new Date(first)))} – now`)),
    h("div", { class: "kpis" },
      kpi("Revenue", money(t.revenue), `Cost ${money(t.cost)}`),
      kpi("Profit per ticket", sm(t.tickets ? t.profit / t.tickets : 0), `${sm(t.n ? t.profit / t.n : 0)} per sale`, cls(t.profit)),
      kpi("Avg cost → sold", money(avgCostT), `Sold for ${money(avgSoldT)} per ticket`),
      kpi("Win-loss", `${t.wins}-${t.losses}`, `${fmtPct(t.winRate, 0)} profitable`),
      kpi("Avg time to sell", dur(t.tts), secs[0] && secs[0].key ? `Best section: ${secs[0].key}` : "")),
    h("div", { class: "grid g-2e" },
      card("By section", secs.length ? table([["key", "Section", ""], ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], secs.slice(0, 12)) : empty("No section info.")),
      card("By show", table([["key", "Show", "", (g) => { const [d, o] = g.key.split("|"); return h("div", {}, h("span", { class: "num", text: d ? fmtDate(d) : "No date" }), h("span", { class: "sub", text: o })); }],
        ["n", "Sales", "r"], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], showsList.slice(0, 12)))),
    card(`Sales · ${fmtInt(rows.length)}`, table([
      ["ts", "Sold", "", (r) => h("div", { class: "num" }, new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }), h("span", { class: "sub", text: r.tts != null ? `in ${dur(r.tts)}` : "" }))],
      [other, other === "venue" ? "Venue" : "Artist", "", (r) => entityLink(other, r[other])],
      ["quantity", "Tickets", "", (r) => h("div", {}, h("span", { class: "num", text: `${r.quantity}×` }), h("span", { class: "sub", text: [r.section && `Sec ${r.section}`, r.row_name && `Row ${r.row_name}`].filter(Boolean).join(" · ") }))],
      ["profit", "Profit", "r", (r) => h("span", { class: `chip-money ${cls(r.profit)}`, text: sm(r.profit) })], ["roi", "ROI", "r", (r) => h("span", { class: cls(r.roi), text: sp(r.roi) })],
      ["cost_per", "Cost per", "r", (r) => money(r.cost_per)], ["sold_per", "Sold per", "r", (r) => money(r.sold_per)], ["account", "Account", "", (r) => r.account || "—"]],
      [...rows].sort((a, b) => b.ts - a.ts).slice(0, 60))));
}

/* ---------- buy insights ---------- */
function rate(g) {
  if (g.n < 3) return ["new", "Too new", 0];
  if (g.roi >= 25 && g.winRate >= 80) return ["buy", "Buy more", 4];
  if (g.roi >= 10 && g.winRate >= 65) return ["ok", "Good", 3];
  if (g.roi >= 0) return ["careful", "Careful", 2];
  return ["avoid", "Avoid", 1];
}
let invCache = null;
function insightsView(rows) {
  const groups = groupBy(rows, (r) => r.artist).map((g) => { const [c, label, score] = rate(g); return { ...g, rc: c, rl: label, score: score * 1000 + (g.roi || 0), trend: trendOf(g.rows), ppt: g.tickets ? g.profit / g.tickets : null }; });
  const scored = sortRows(groups, UI.scoreSort);
  const scoreCard = card("Artist scorecard", table([
    ["key", "Artist", "", (g) => entityLink("artist", g.key)],
    ["score", "Rating", "", (g) => h("span", { class: `rating ${g.rc}`, text: g.rl })],
    ["n", "Sales", "r"], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })],
    ["winRate", "Win rate", "r", (g) => fmtPct(g.winRate, 0)], ["ppt", "Profit/ticket", "r", (g) => h("span", { class: cls(g.ppt), text: sm(g.ppt) })],
    ["tts", "Avg time to sell", "r", (g) => dur(g.tts)],
    ["trend", "30-day trend", "r", (g) => h("span", { class: g.trend.dir > 0 ? "up" : g.trend.dir < 0 ? "down" : "muted", text: `${g.trend.dir > 0 ? "▲ " : g.trend.dir < 0 ? "▼ " : ""}${g.trend.text}` }), false],
  ], scored.slice(0, 40), { sortState: UI.scoreSort, onSort: paint }), null,
    "Buy more: 25%+ ROI and 80%+ win rate. Good: 10%+ ROI and 65%+ wins. Careful: profitable but thin. Avoid: losing money overall. Too new: fewer than 3 sales.");

  const bands = [["Under $50", 0, 50], ["$50–99", 50, 100], ["$100–199", 100, 200], ["$200–349", 200, 350], ["$350–499", 350, 500], ["$500+", 500, 1e9]]
    .map(([label, lo, hi]) => ({ label, ...agg(rows.filter((r) => r.cost_per != null && r.cost_per >= lo && r.cost_per < hi)) }));
  const levels = groupBy(rows, (r) => sectionLevel(r.section)).filter((g) => g.key !== "Unknown").sort((a, b) => b.roi - a.roi);
  const roiBars = (items, labelKey, name) => barChart({ label: name, labels: items.map((x) => x[labelKey]), series: [{ name: "Avg ROI", values: items.map((x) => (x.n ? x.roi : null)), color: "var(--accent)", negColor: "var(--down)" }],
    fmt: (v) => `${Math.round(v)}%`, tip: (i) => [["Avg ROI", sp(items[i].roi), cls(items[i].roi)], ["Sales", fmtInt(items[i].n)], ["Profit", sm(items[i].profit), cls(items[i].profit)], ["Win rate", fmtPct(items[i].winRate, 0)]], height: 190 });
  const accounts = groupBy(rows, (r) => r.account).sort((a, b) => b.profit - a.profit);

  // inventory watch (loads your inventory once)
  const watch = h("div", {}, empty("Loading your inventory…"));
  if (CFG.inventory) (async () => {
    try {
      if (!invCache) invCache = await fetchAll("inventory_live", "id,artist,venue,event_date,quantity,remaining_qty,remaining_cost,cost_per,order_number", "event_date");
      const today = todayISO(), soon = addDays(today, 21);
      const byArtist = new Map(groupBy(ALL, (r) => r.artist).map((g) => [g.key.toLowerCase(), g]));
      const list = invCache.filter((p) => p.event_date && p.event_date >= today && p.event_date <= soon && p.remaining_qty > 0)
        .map((p) => { const g = byArtist.get((p.artist || "").toLowerCase()); return { ...p, hist: g, risk: !g ? "No history" : g.roi < 0 ? "High" : g.roi < 10 ? "Medium" : "Low" }; })
        .sort((a, b) => a.event_date.localeCompare(b.event_date));
      watch.replaceChildren(list.length ? table([
        ["event_date", "Show", "", (p) => h("span", { class: "num", text: fmtDate(p.event_date) })],
        ["artist", "Artist", "", (p) => h("div", {}, p.hist ? entityLink("artist", p.hist.key) : h("span", { text: p.artist || "—" }), h("span", { class: "sub", text: p.venue || "" }))],
        ["remaining_qty", "Left", "r"], ["remaining_cost", "At cost", "r", (p) => money(Number(p.remaining_cost || 0))],
        ["hist", "History", "r", (p) => (p.hist ? h("span", { class: cls(p.hist.roi), text: `${sp(p.hist.roi)} ROI` }) : h("span", { class: "muted", text: "—" }))],
        ["risk", "Risk", "", (p) => h("span", { class: `rating ${p.risk === "High" ? "avoid" : p.risk === "Medium" ? "careful" : p.risk === "Low" ? "buy" : "new"}`, text: p.risk })],
      ], list.slice(0, 40)) : empty(invCache.length ? "No unsold tickets for shows in the next 3 weeks." : "Connect your Google Sheet on the Inventory page to see this."));
    } catch { watch.replaceChildren(empty("Couldn't load inventory.")); }
  })();

  return h("div", { class: "stack" },
    scoreCard,
    h("div", { class: "grid g-2e" },
      card("ROI by price paid per ticket", roiBars(bands, "label", "ROI by price paid"), null, "Which price range earns you the best return."),
      card("ROI by section level", levels.length ? roiBars(levels, "key", "ROI by section level") : empty("Needs section info."), null, "Floor, lower bowl, upper levels. Based on the section number.")),
    h("div", { class: "grid g-2e" },
      CFG.inventory ? card("Unsold tickets, shows in the next 3 weeks", watch, null, "Risk is based on how that artist has sold for you before.") : card("Best venues (3+ sales)", venueBoard(rows)),
      card("Buyer accounts", accounts.length ? table([["key", "Account", ""], ["n", "Sales", "r"], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })], ["winRate", "Win rate", "r", (g) => fmtPct(g.winRate, 0)]], accounts.slice(0, 15)) : empty("No buyer accounts recorded yet."))),
    calculator());
}

function calculator() {
  const inp = (id, label, val, step = "0.01") => { const el = h("input", { type: "number", id, value: val, min: "0", step }); return [el, h("div", {}, h("label", { for: id, text: label }), el)]; };
  const [cost, costF] = inp("c-cost", "Cost per ticket ($)", "100");
  const [qty, qtyF] = inp("c-qty", "Tickets", "2", "1");
  const [fee, feeF] = inp("c-fee", "Selling fee (%)", "0", "0.5");
  const [target, targetF] = inp("c-target", "Target ROI (%)", "20", "1");
  const out = h("div", { class: "calc-out" });
  const k = (label, v, f) => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: "v", text: v }), h("div", { class: "f", text: f }));
  const calc = () => {
    const c = Number(cost.value) || 0, q = Math.max(1, Number(qty.value) || 1), fe = Math.min(95, Number(fee.value) || 0) / 100, tr = Number(target.value) || 0;
    const price = (roi) => (c * (1 + roi / 100)) / (1 - fe);
    out.replaceChildren(
      k("Break-even price", money(price(0)), "Per ticket, to not lose money"),
      k(`Price for ${tr}% ROI`, money(price(tr)), `Profit ${sm(c * tr / 100 * q)} on ${q} tickets`),
      k("Price for 10% ROI", money(price(10)), `Profit ${sm(c * 0.1 * q)}`),
      k("Price for 30% ROI", money(price(30)), `Profit ${sm(c * 0.3 * q)}`),
      k("Total cost", money(c * q), `${q} × ${money(c)}`));
  };
  [cost, qty, fee, target].forEach((el) => (el.oninput = calc));
  calc();
  return card("Price calculator", h("div", {}, h("div", { class: "calc" }, costF, qtyF, feeF, targetF), out), null, "Use before buying to check the listing price you'd need. If your payouts are already after fees, leave the fee at 0.");
}

/* ---------- TAG & Month (one place for your month: TAG, commission, totals, trend) ---------- */
function monthView() {
  const pool = ALL;  // this tab always shows everything for the chosen month
  const months = [...new Set(pool.map((r) => r.month))].sort().reverse();
  const curKey = nyDay.format(new Date()).slice(0, 7);
  if (!UI.tagMonth || (UI.tagMonth !== "all" && !months.includes(UI.tagMonth))) UI.tagMonth = months.includes(curKey) ? curKey : months[0] || "all";
  const key = UI.tagMonth, isAll = key === "all", isCurrent = key === curKey;
  const rows = isAll ? pool : pool.filter((r) => r.month === key);
  const t = agg(rows), comm = commissionOf(t.profit);
  const hide = CFG.showTag && !UI.tagVisible, mask = (v) => (hide ? "••••••" : v);
  const latest = [...rows].sort((a, b) => b.ts - a.ts)[0];
  const asOf = latest ? new Date(latest.ts).toLocaleString("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  // controls
  const select = h("select", { id: "tag-month", style: { width: "auto", minWidth: "210px" } },
    months.map((k) => h("option", { value: k, text: `${monthLabel(k, true)}${k === curKey ? " (this month)" : ""}` })), h("option", { value: "all", text: "All time" }));
  select.value = key; select.onchange = () => { UI.tagMonth = select.value; paint(); };
  let controls = [h("span", { class: "lbl", text: "Period" }), select, h("span", { class: "spacer" })];
  if (CFG.showTag) {
    const rate = h("input", { type: "number", id: "comm-rate", min: "0", max: "100", step: "0.5", value: String(UI.commission), style: { width: "80px" } });
    rate.onchange = async () => { const v = Math.min(100, Math.max(0, Number(rate.value) || 0)); UI.commission = v; const p = await loadPrefs(); p.commission = v; savePrefs(); paint(); };
    controls = controls.concat([h("label", { for: "comm-rate", class: "inline-lbl", text: "Commission %" }), rate,
      h("button", { type: "button", onclick: () => { UI.tagVisible = !UI.tagVisible; paint(); } }, hide ? "Show numbers" : "Hide numbers")]);
  }

  // headline: TAG + your commission (yours) / profit (company)
  const big = (label, value, c, foot) => h("div", { class: "kpi tag big" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${hide ? "masked" : c}`, text: mask(value) }), h("div", { class: "f", text: foot }));
  const period = isAll ? "All time" : monthLabel(key, true);
  const head = CFG.showTag
    ? h("div", { class: "kpis two" }, big(`TAG · ${period}`, sm(t.profit), cls(t.profit), latest ? `Through ${asOf} ET` : "No sales"),
        big(`Your commission (${UI.commission}% of TAG)`, money(comm), "", "What you've earned for this period"))
    : h("div", { class: "kpis two" }, big(`Profit · ${period}`, sm(t.profit), cls(t.profit), latest ? `Through ${asOf} ET` : "No sales"),
        big("Gross sales", money(t.revenue), "", `Cost ${money(t.cost)}`));

  // profit goals for the month (your book only)
  let goals = "";
  if (CFG.showTag && !isAll) {
    const dim = daysInMonth(key), dayNow = isCurrent ? Number(nyDay.format(new Date()).slice(8)) : dim, daysLeft = dim - dayNow + 1; // today counts, it isn't over
    const custom = UI.goal > 0;
    const steps = custom ? [UI.goal] : [10000, 25000, 50000, 75000, 100000];
    const next = steps.find((g) => g > t.profit), pace = dayNow ? (t.profit / dayNow) * dim : 0;
    const max = Math.max(next || steps[steps.length - 1], t.profit, 1);
    const bar = h("div", { class: "goal-bar", role: "img", "aria-label": hide ? "Goal progress hidden" : `TAG ${sm(t.profit)} of ${money(next || max)}` },
      h("i", { style: { width: hide ? "0%" : `${Math.max(0, Math.min(100, (t.profit / max) * 100))}%` } }),
      steps.filter((g) => g <= max).map((g) => h("span", { class: `mark ${t.profit >= g && !hide ? "hit" : ""} ${g === UI.goal ? "mine" : ""}`, style: { left: `${(g / max) * 100}%` }, title: money(g) }, h("em", { text: `$${g >= 1000 ? g / 1000 + "k" : g}` }))));
    const goalIn = h("input", { type: "text", inputmode: "numeric", id: "goal-in", value: custom ? String(UI.goal) : "", placeholder: "e.g. 40000", style: { width: "130px" } });
    const saveGoal = async (v) => { UI.goal = Math.max(0, Math.round(v) || 0); const p = await loadPrefs(); p.goal = UI.goal; savePrefs(); paint(); };
    const setBtn = h("button", { class: "btn primary", type: "button", text: custom ? "Update goal" : "Set goal" });
    setBtn.onclick = () => { const v = Number(String(goalIn.value).replace(/[^0-9.]/g, "")); if (v > 0) saveGoal(v); else goalIn.focus(); };
    goalIn.onkeydown = (e) => { if (e.key === "Enter") setBtn.onclick(); };
    const resetBtn = custom ? h("button", { class: "btn", type: "button", text: "Use default milestones" }) : "";
    if (resetBtn) resetBtn.onclick = () => saveGoal(0);
    const lines = hide ? [h("li", { text: "Tap Show numbers to see your progress." })] : [
      steps.filter((g) => t.profit >= g).length ? h("li", {}, "Reached: ", h("b", { text: steps.filter((g) => t.profit >= g).map((g) => money(g)).join(", ") }), ".") : "",
      next ? h("li", {}, h("b", { text: money(next - t.profit) }), ` more TAG to reach ${money(next)}` + (isCurrent && daysLeft > 0 ? `, about ${money((next - t.profit) / daysLeft)} a day for the ${plural(daysLeft, "day")} left, today included.` : ".")) : h("li", { text: "Every goal reached this month." }),
      isCurrent ? h("li", {}, "On pace for ", h("b", { class: cls(pace), text: sm(pace) }), (() => { const hit = steps.filter((g) => pace >= g).pop(); return hit ? `, which clears ${money(hit)}.` : "."; })()) : "",
    ];
    const perDay = next && isCurrent && daysLeft > 0 ? (next - t.profit) / daysLeft : null, soFar = dayNow ? t.profit / dayNow : 0;
    const stat = (label, value, sub, c = "") => h("div", { class: "goal-stat" }, h("span", { class: "lbl", text: label }), h("b", { class: c, text: value }), h("span", { class: "sub", text: sub }));
    const stats = hide || !isCurrent ? "" : h("div", { class: "goal-stats" },
      perDay != null ? stat("Needed per day", money(perDay), `to reach ${money(next)}`, perDay > soFar ? "down" : "up") : stat("Needed per day", "$0.00", "Every goal reached", "up"),
      stat("Your average so far", sm(soFar), `per day over ${plural(dayNow, "day")}`, cls(soFar)),
      stat("Days left", String(daysLeft), "today included"));
    goals = card("Profit goals", h("div", {}, stats, bar, h("ul", { class: "summary mt" }, lines)), h("div", { class: "row" }, h("label", { for: "goal-in", class: "inline-lbl", text: "My goal $" }), goalIn, setBtn, resetBtn), custom ? `Your monthly TAG goal: ${money(UI.goal)}. It replaces the default milestones.` : "Default milestones at $10k, $25k, $50k, $75k and $100k of monthly TAG. Set your own goal to replace them.");
  }

  // plain-English summary (one month only)
  let summary = "", trend = "";
  if (!isAll) {
    const prevKey = prevMonthKey(key), dim = daysInMonth(key), dayNow = isCurrent ? Number(nyDay.format(new Date()).slice(8)) : dim;
    const pRows = pool.filter((r) => r.month === prevKey), pSame = pRows.filter((r) => Number(r.day.slice(8)) <= dayNow), p = agg(pSame);
    const artists = groupBy(rows, (r) => r.artist).sort((a, b) => b.profit - a.profit), venues = groupBy(rows, (r) => r.venue).sort((a, b) => b.profit - a.profit);
    const pace = isCurrent && dayNow ? (t.profit / dayNow) * dim : null;
    summary = card(`${period}${isCurrent ? " so far" : ""}`, h("ul", { class: "summary" },
      rows.length ? [
        h("li", {}, h("b", { text: plural(t.n, "sale") }), ` (${plural(t.tickets, "ticket")}) brought in ${money(t.revenue)} at ${sp(t.roi)} weighted ROI.`),
        pace != null && !hide ? h("li", {}, "At this pace the month finishes around ", h("b", { text: sm(pace) }), CFG.showTag ? ` TAG, about ${money(commissionOf(pace))} commission.` : ".") : "",
        pSame.length ? h("li", {}, `Compared with ${monthLabel(prevKey, true)} through day ${dayNow}: `, h("b", { class: hide ? "" : cls(t.profit - p.profit), text: mask(sm(t.profit - p.profit)) }), `, ${t.n - p.n >= 0 ? "+" : ""}${t.n - p.n} sales.`) : "",
        artists[0] ? h("li", {}, "Top artist: ", entityLink("artist", artists[0].key), ` (${mask(sm(artists[0].profit))}). Top venue: `, entityLink("venue", venues[0] && venues[0].key), venues[0] ? ` (${mask(sm(venues[0].profit))}).` : "") : "",
        h("li", {}, t.losses ? `${plural(t.losses, "losing sale")}, ${money(Math.abs(t.lossAmt))} lost.` : "No losing sales."),
      ] : [h("li", {}, "No sales in this month yet.")]));
    const days = Array.from({ length: dim }, (_, i) => i + 1);
    const cum = (rs, upto) => { const m = new Map(); rs.forEach((r) => { const d = Number(r.day.slice(8)); m.set(d, (m.get(d) || 0) + r.profit); }); let x = 0; return days.map((d) => (d > upto ? null : (x += m.get(d) || 0))); };
    trend = card("Running profit through the month", lineChart({ label: "Running profit", labels: days.map(String), titles: days.map((d) => `${monthLabel(key, true).split(" ")[0]} ${d}`),
      fmt: hide ? () => "•••" : undefined,
      series: [{ name: monthLabel(key, true), values: cum(rows, dayNow), color: "var(--accent)" }, { name: monthLabel(prevKey, true), values: cum(pRows, daysInMonth(prevKey)).slice(0, dim), color: "#5b6878", dashed: true }] }),
      legend([[monthLabel(key, true), "var(--accent)"], [monthLabel(prevKey, true), "#5b6878", true]]));
  }

  // totals (each number once)
  const line = (k, v, c = "") => [h("div", { class: "k", text: k }), h("div", { class: `v ${c}`, text: v })];
  const byDay = groupBy(rows, (r) => r.day);
  const bestDay = [...byDay].sort((a, b) => b.profit - a.profit)[0], bestSale = [...rows].sort((a, b) => b.profit - a.profit)[0];
  const wd = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const totals = card(`${period} totals`, h("div", { class: "kv" }, [
    line("Transactions", fmtInt(t.n)), line("Tickets", fmtInt(t.tickets)),
    line("Gross sales", money(t.revenue)), line("Total cost", money(t.cost)),
    line("Total losses", money(Math.abs(t.lossAmt)), t.lossAmt ? "down" : ""),
    line("Weighted ROI", sp(t.roi), cls(t.roi)), line("Profit margin", sp(t.margin)),
    line("Profitable / losing / break-even", `${t.wins} / ${t.losses} / ${t.even}`),
    line("Win rate", fmtPct(t.winRate, 2)), line("Profit per ticket", mask(sm(t.tickets ? t.profit / t.tickets : 0))),
    line("Avg time to sell", dur(t.tts)),
    line("Best day", bestDay ? `${wd(bestDay.key)} · ${mask(sm(bestDay.profit))}` : "—"),
    line("Best sale", bestSale ? `${bestSale.artist} · ${mask(sm(bestSale.profit))}` : "—"),
    line("Latest entry", latest ? `${latest.artist}${latest.section ? `, Sec ${latest.section}` : ""}${latest.row_name ? ` Row ${latest.row_name}` : ""}, ${latest.quantity} tix, ${asOf} ET` : "—"),
  ].flat()), null, "New York time. Win, loss and break-even go by actual profit." + (CFG.showTag ? " Commission is earned on a positive TAG only." : ""));

  // month-by-month book
  const byMonth = groupBy(pool, (r) => r.month).sort((a, b) => b.key.localeCompare(a.key));
  const cols = [
    ["key", "Month", "", (g) => g.key === "all" ? "All time" : h("a", { class: "link-like", href: `#${CFG.base}/month`, text: monthLabel(g.key, true), onclick: (e) => { e.preventDefault(); UI.tagMonth = g.key; paint(); scrollTo(0, 0); } })],
    ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ["revenue", "Gross", "r", (g) => money(g.revenue)],
    ["lossAmt", "Losses", "r", (g) => h("span", { class: g.lossAmt ? "down" : "", text: money(Math.abs(g.lossAmt)) })],
    ["profit", CFG.showTag ? "TAG" : "Profit", "r", (g) => h("span", { class: hide ? "" : cls(g.profit), text: mask(sm(g.profit)) })],
    ["roi", "ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })],
  ];
  if (CFG.showTag) cols.push(["comm", `Commission ${UI.commission}%`, "r", (g) => h("b", { text: mask(money(commissionOf(g.profit))) })]);
  const book = card("Month by month", table(cols, [...byMonth, { key: "all", ...agg(pool) }], { rowClass: (g) => (g.key === key ? "best" : g.key === "all" ? "total" : "") }), null, "Click a month to open it.");

  return h("div", { class: "stack" },
    h("div", { class: "row" }, controls), head, goals,
    isAll ? "" : h("div", { class: "grid g-2" }, summary, trend),
    h("div", { class: "grid g-tag" }, totals, book));
}

/* ---------- how you did: today, last 3 days, last 7 days ---------- */
function recentView() {
  // Uses every filter except the date range, and only this book's own sales.
  const pool = ALL;  // this tab always shows everything (no filters)
  const today = nyDay.format(new Date());
  const range = (from, to) => pool.filter((r) => r.day >= from && r.day <= to);
  const hide = CFG.showTag && !UI.tagVisible;
  const mask = (v) => (hide ? "••••••" : v);
  const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const span = (from, to) => (from === to ? new Date(from + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : `${dayLabel(from)} – ${dayLabel(to)}`);

  const windowCard = (label, n) => {
    const from = addDays(today, -(n - 1)), pFrom = addDays(today, -(2 * n - 1)), pTo = addDays(today, -n);
    const rows = range(from, today), prevRows = range(pFrom, pTo);
    const a = agg(rows), b = agg(prevRows), d = a.profit - b.profit, dp = pct(a.profit, b.profit);
    const best = [...rows].sort((x, y) => y.profit - x.profit)[0];
    const top = groupBy(rows, (r) => r.artist).sort((x, y) => y.profit - x.profit)[0];
    const line = (k, v, c = "") => [h("div", { class: "k", text: k }), h("div", { class: `v ${c}`, text: v })];
    return h("section", { class: "card window" },
      h("div", { class: "card-head" }, h("h2", { class: "card-title", text: label }), h("span", { class: "spacer" }), h("span", { class: "muted small", text: span(from, today) })),
      h("div", { class: `big ${hide ? "masked" : cls(a.profit)}`, text: mask(sm(a.profit)) }),
      h("div", { class: `delta ${hide ? "" : cls(d)}`, text: hide ? "Tap Show to see profit" : `${d >= 0 ? "▲" : "▼"} ${sm(d)}${dp != null ? ` (${dp >= 0 ? "+" : ""}${dp.toFixed(0)}%)` : ""} vs previous ${n === 1 ? "day" : `${n} days`} (${sm(b.profit)})` }),
      h("div", { class: "kv mt" }, [
        line("Sales", `${fmtInt(a.n)}  (prev ${fmtInt(b.n)})`),
        line("Tickets", fmtInt(a.tickets)),
        line("Gross sales", money(a.revenue)),
        line("Cost", money(a.cost)),
        line("Weighted ROI", sp(a.roi), cls(a.roi)),
        line("Win / loss / even", `${a.wins} / ${a.losses} / ${a.even}`),
        line("Lost on losing sales", money(Math.abs(a.lossAmt)), a.lossAmt ? "down" : ""),
        CFG.showTag ? line(`Commission (${UI.commission}%)`, mask(money(commissionOf(a.profit)))) : [],
        line("Best sale", best ? `${best.artist} ${mask(sm(best.profit))}` : "—"),
        line("Top artist", top ? `${top.key} ${mask(sm(top.profit))}` : "—"),
      ].flat()));
  };

  // daily view for the last 14 days
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byDay = new Map(groupBy(range(days[0], today), (r) => r.day).map((g) => [g.key, g]));
  const chart = barChart({ label: "Profit by day, last 14 days", height: 200,
    labels: days.map((d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric" })),
    titles: days.map((d) => span(d, d)),
    series: [{ name: "Profit", values: days.map((d) => (hide ? (byDay.get(d)?.n || 0) : byDay.get(d)?.profit || 0)), color: "var(--series-2)", negColor: "var(--down)" }],
    fmt: hide ? (v) => fmtInt(v) : undefined,
    tip: (i) => { const g = byDay.get(days[i]); return g ? [["Profit", mask(sm(g.profit)), hide ? "" : cls(g.profit)], ["Sales", fmtInt(g.n)], ["Tickets", fmtInt(g.tickets)], ["ROI", sp(g.roi)]] : [["Sales", "0"]]; } });
  const last7 = days.slice(-7).reverse().map((d) => ({ key: d, ...(byDay.get(d) || agg([])) }));
  const todays = range(today, today).sort((a, b) => b.ts - a.ts);

  return h("div", { class: "stack" },
    h("div", { class: "row" }, h("span", { class: "muted small", text: `${CFG.title ? "PLT company sales only" : "Your sales only"}. New York time. Each period is compared with the one just before it.` }), h("span", { class: "spacer" }),
      CFG.showTag ? h("button", { type: "button", onclick: () => { UI.tagVisible = !UI.tagVisible; paint(); } }, UI.tagVisible ? "Hide numbers" : "Show numbers") : ""),
    h("div", { class: "grid g-3" }, windowCard("Today", 1), windowCard("Last 3 days", 3), windowCard("Last 7 days", 7)),
    card(hide ? "Sales by day, last 14 days" : "Profit by day, last 14 days", chart),
    h("div", { class: "grid g-2e" },
      card("Last 7 days, day by day", table([
        ["key", "Day", "", (g) => span(g.key, g.key)], ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ["revenue", "Gross", "r", (g) => money(g.revenue)],
        ["profit", "Profit", "r", (g) => h("span", { class: hide ? "" : cls(g.profit), text: mask(sm(g.profit)) })], ["roi", "ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })],
        ["wl", "W / L", "r", (g) => `${g.wins} / ${g.losses}`]], last7)),
      card(`Today's sales · ${fmtInt(todays.length)}`, todays.length ? table([
        ["ts", "Time", "", (r) => new Date(r.ts).toLocaleTimeString("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit" })],
        ["artist", "Artist", "", (r) => h("div", {}, entityLink("artist", r.artist), badge(r))], ["quantity", "Tix", "r"],
        ["profit", "Profit", "r", (r) => h("span", { class: `chip-money ${hide ? "" : cls(r.profit)}`, text: mask(sm(r.profit)) })], ["roi", "ROI", "r", (r) => h("span", { class: cls(r.roi), text: sp(r.roi) })]], todays.slice(0, 40))
        : empty(CFG.title ? "No company sales synced yet today. Open #plt-sales with Live on, or click Sync New Sales." : "No sales yet today."))));
}

  return { renderPortfolio, onNewSale };
}
