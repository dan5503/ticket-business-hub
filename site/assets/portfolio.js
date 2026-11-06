// Portfolio: trading-terminal style sales analytics.
import { sb, h, fetchAll, fmtMoney, fmtInt, fmtPct, fmtDate, monthLabel, todayISO } from "./common.js";
import { barChart, lineChart, legend } from "./charts.js";
import { exportCsv } from "./dashboard.js";
import { loadPrefs, savePrefs } from "./layout.js";

const COLS = "id,discord_message_id,order_number,artist,venue,city,event_date,section,row_name,quantity,total_sale,total_cost,profit,roi,cost_per,sold_per,purchase_date,purchased_at,sold_date,sold_at,account,marketplace,result,created_at";
export const MY_TABS = [["tag", "TAG & Commission"], ["recent", "Day · 3 days · Week"], ["overview", "Overview"], ["monthly", "Monthly"], ["sales", "Sales data"], ["artists", "Artists"], ["venues", "Venues"], ["buying", "Buy timing"], ["losses", "Losses"], ["insights", "Buy insights"]];
export const PLT_TABS = [["recent", "Day · 3 days · Week"], ["overview", "Overview"], ["monthly", "Monthly"], ["sales", "Sales data"], ["artists", "Artists"], ["venues", "Venues"], ["accounts", "Buyer accounts"], ["buying", "Buy timing"], ["losses", "Losses"], ["insights", "Insights"]];
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
  o.res = resultOf(o);
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
const F = { preset: "all", from: "", to: "", artist: "", venue: "", account: "", result: "", q: "" };
const UI = { commission: 20, tagMonth: null, tagVisible: false, bestPer: "month", trendBy: "week", salesSort: ["ts", -1], salesPage: 0, entSort: ["profit", -1], entQ: "", month: null, entityFilter: "", scoreSort: ["score", -1] };

function onNewSale(r) {
  if (!ALL) return;
  ALL.push(norm(r));
  if (rootEl && rootEl.isConnected && isMyRoute()) paint();
}

function presetRange(p) {
  const today = todayISO();
  if (p === "month") return [today.slice(0, 8) + "01", today];
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
  if (F.q) { const q = F.q.toLowerCase(); if (![r.artist, r.venue, r.city, r.account, r.order_number, r.section, r.marketplace].some((v) => (v || "").toLowerCase().includes(q))) return false; }
  return true;
});

let loadedAt = 0;
async function loadAll() { ALL = (await fetchAll(CFG.table, COLS, "created_at")).map(norm); loadedAt = Date.now(); }
async function renderPortfolio(root, args) {
  rootEl = root; routeArgs = args || [];
  if (!ALL || Date.now() - loadedAt > 60000) {
    const [, prefs] = await Promise.all([loadAll(), loadPrefs()]);
    if (prefs && prefs.commission != null) UI.commission = Number(prefs.commission);
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
function paint() {
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
  const rows = filtered();
  const t = agg(rows);
  const view = isEntity ? entityView(tab, name) : (TABVIEWS[tab] || TABVIEWS[CFG.tabs[0][0]])(rows, t);
  const banner = CFG.title ? h("div", { class: "book-banner" }, h("b", { text: CFG.title }), h("span", { class: "muted", text: CFG.subtitle || "" })) : "";
  if (isEntity) root.replaceChildren(banner, tabsBar("", t), view);
  else root.replaceChildren(banner, filterBar(), (CFG.showTag ? kpiRow(t, rows) : kpiRowPlain(t)), tabsBar(TABVIEWS[tab] ? tab : CFG.tabs[0][0], t), view);
}

function filterBar() {
  const uniq = (k) => [...new Set(ALL.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sel = (id, label, key, opts, allText) => {
    const el = h("select", { id }, h("option", { value: "", text: allText }), opts.map((o) => (Array.isArray(o) ? h("option", { value: o[0], text: o[1] }) : h("option", { value: o, text: o }))));
    el.value = F[key];
    el.onchange = () => { F[key] = el.value; UI.salesPage = 0; paint(); };
    return h("div", { class: "f" }, h("label", { for: id, text: label }), el);
  };
  const date = (id, label, key) => {
    const el = h("input", { type: "date", id, value: F[key] });
    el.onchange = () => { F[key] = el.value; F.preset = "custom"; paint(); };
    return h("div", { class: "f" }, h("label", { for: id, text: label }), el);
  };
  const q = h("input", { type: "search", id: "f-q", placeholder: "Artist, venue, order #…", value: F.q });
  let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { F.q = q.value.trim(); UI.salesPage = 0; paint(); document.getElementById("f-q")?.focus(); }, 350); };
  const presets = [["month", "This month"], ["30d", "Last 30 days"], ["year", "This year"], ["all", "All time"]];
  const anyFilter = F.artist || F.venue || F.account || F.result || F.q || F.preset !== "all";
  const activeCount = [F.artist, F.venue, F.account, F.result, F.q].filter(Boolean).length + (F.preset === "custom" ? 1 : 0);
  return h("div", {},
    h("button", { type: "button", class: "filter-toggle", "aria-expanded": String(!!UI.filtersOpen), onclick: () => { UI.filtersOpen = !UI.filtersOpen; paint(); } }, `Filters${activeCount ? ` (${activeCount})` : ""}`),
    h("div", { class: `filters ${UI.filtersOpen ? "open" : ""}` },
      date("f-from", "Sold from", "from"), date("f-to", "Sold to", "to"),
      sel("f-artist", "Artist / event", "artist", uniq("artist"), "All artists"),
      sel("f-venue", "Venue", "venue", uniq("venue"), "All venues"),
      sel("f-acct", "Buyer account", "account", uniq("account"), "All accounts"),
      sel("f-res", "Result", "result", [["win", "All profitable"], ["ehh", "Ehh (small profit)"], ["even", "Break-even ($0)"], ["loss", "Losses"]], "Wins and losses"),
      h("div", { class: "f" }, h("label", { for: "f-q", text: "Search" }), q)),
    h("div", { class: "presets" },
      presets.map(([k, label]) => h("button", { type: "button", class: `preset ${F.preset === k ? "on" : ""}`, text: label, onclick: () => { F.preset = k; [F.from, F.to] = presetRange(k); paint(); } })),
      anyFilter ? h("button", { type: "button", class: "preset", text: "Clear", onclick: () => { Object.assign(F, { preset: "all", from: "", to: "", artist: "", venue: "", account: "", result: "", q: "" }); paint(); } }) : ""));
}

function kpiRow(t) {
  const eye = h("button", { type: "button", class: "eye", text: UI.tagVisible ? "Hide" : "Show", "aria-pressed": String(UI.tagVisible), onclick: () => { UI.tagVisible = !UI.tagVisible; paint(); } });
  const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  const comm = commissionOf(t.profit);
  const masked = (v, c) => h("div", { class: `v ${UI.tagVisible ? c : "masked"}`, text: UI.tagVisible ? v : "••••••" });
  return h("div", { class: "kpis six" },
    h("div", { class: "kpi tag" }, h("div", { class: "lbl", text: "TAG (net profit)" }), eye, masked(sm(t.profit), cls(t.profit)),
      h("div", { class: "f", text: t.losses ? `After ${sm(t.lossAmt)} in losses` : "No losses" })),
    h("div", { class: "kpi tag" }, h("div", { class: "lbl", text: `Commission (${UI.commission}%)` }), masked(money(comm), ""),
      h("div", { class: "f", text: UI.tagVisible ? `After commission ${sm(t.profit - comm)}` : "Tap Show on TAG" })),
    kpi("Gross sales", money(t.revenue), `Cost ${money(t.cost)}`),
    kpi("Weighted ROI", sp(t.roi), `Margin ${sp(t.margin)}`, cls(t.roi)),
    kpi("Tickets", fmtInt(t.tickets), `${sm(t.tickets ? t.profit / t.tickets : 0)} per ticket`),
    kpi("Sales", fmtInt(t.n), `${fmtInt(t.wins)} win · ${fmtInt(t.losses)} loss · ${fmtInt(t.even)} even`));
}
const commissionOf = (profit) => Math.max(0, profit) * (UI.commission / 100);

function kpiRowPlain(t) {
  const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
  return h("div", { class: "kpis six" },
    kpi("Total profit", sm(t.profit), t.losses ? `After ${sm(t.lossAmt)} in losses` : "No losses", cls(t.profit)),
    kpi("Gross sales", money(t.revenue), `Cost ${money(t.cost)}`),
    kpi("Weighted ROI", sp(t.roi), `Margin ${sp(t.margin)}`, cls(t.roi)),
    kpi("Tickets", fmtInt(t.tickets), `${sm(t.tickets ? t.profit / t.tickets : 0)} per ticket`),
    kpi("Sales", fmtInt(t.n), `${fmtInt(t.wins)} win · ${fmtInt(t.losses)} loss · ${fmtInt(t.even)} even`),
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
  tag: () => tagView(),
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
    const per = UI.bestPer === "month" ? months : groupBy(rows, (r) => r.year);
    const best = [...per].sort((a, b) => b.profit - a.profit).slice(0, 8);
    const bestCard = card("Best months", h("div", {},
      table([["key", UI.bestPer === "month" ? "Month" : "Year", "", (r, i) => h("span", {}, h("span", { class: "muted", text: `${i + 1}  ` }), UI.bestPer === "month" ? monthLabel(r.key) : r.key)],
        ["n", "Sales", "r"], ["profit", "Profit", "r", (r) => h("span", { class: cls(r.profit), text: sm(r.profit) })], ["roi", "Avg ROI", "r", (r) => h("span", { class: cls(r.roi), text: sp(r.roi) })]], best,
        { rowClass: (r, i) => (i === 0 ? "best" : "") })), seg([["month", "Per month"], ["year", "Per year"]], UI.bestPer, (v) => { UI.bestPer = v; paint(); }), "Ranked by profit. Your best one is on top.");
    const topTable = (kind, groups) => {
      const top = [...groups].sort((a, b) => b.profit - a.profit).slice(0, 8);
      const max = Math.max(1, ...top.map((g) => Math.abs(g.profit)));
      return table([["key", KIND[kind][0], "", (g, i) => h("span", {}, h("span", { class: "muted", text: `${i + 1}  ` }), entityLink(kind, g.key))],
        ["n", "Sales", "r"],
        ["profit", "Profit", "r", (g) => h("div", {}, h("span", { class: cls(g.profit), text: sm(g.profit) }), h("div", { class: "mini-bar" }, h("i", { class: g.profit < 0 ? "down" : "", style: { width: `${(Math.abs(g.profit) / max) * 100}%` } })))],
        ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], top);
    };
    const recent = [...rows].sort((a, b) => b.ts - a.ts).slice(0, 8);
    const markets = groupBy(rows, (r) => r.marketplace).sort((a, b) => b.profit - a.profit);
    return h("div", { class: "stack" },
      h("div", { class: "grid g-2" }, card("Revenue and profit by month", chart, legend([["Revenue", "var(--series-1)"], ["Profit", "var(--series-2)"], ["Running profit", "#9ec5f4"]])), bestCard),
      h("div", { class: "grid g-2e" }, card("Top artists by profit", topTable("artist", groupBy(rows, (r) => r.artist)), h("a", { class: "btn icon", href: `#${CFG.base}/artists` }, "All artists")),
        card("Top venues by profit", topTable("venue", groupBy(rows, (r) => r.venue)), h("a", { class: "btn icon", href: `#${CFG.base}/venues` }, "All venues"))),
      h("div", { class: "grid g-2e" },
        card("Latest sales", table([["artist", "Artist", "", (r) => h("div", {}, entityLink("artist", r.artist), badge(r), h("span", { class: "sub", text: whenText(r) }))],
          ["quantity", "Tix", "r"], ["profit", "Profit", "r", (r) => h("span", { class: `chip-money ${cls(r.profit)}`, text: sm(r.profit) })], ["roi", "ROI", "r", (r) => h("span", { class: cls(r.roi), text: sp(r.roi) })]], recent),
          h("a", { class: "btn icon", href: `#${CFG.base}/sales` }, "All sales")),
        card("Where you sold", markets.length ? table([["key", "Marketplace", ""], ["n", "Sales", "r"], ["revenue", "Revenue", "r", (g) => money(g.revenue)], ["profit", "Profit", "r", (g) => h("span", { class: cls(g.profit), text: sm(g.profit) })], ["roi", "Avg ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })]], markets) : empty("No marketplace info yet."))));
  },

  monthly(rows) {
    const months = [...new Set(ALL.map((r) => r.month))].sort().reverse();
    const curKey = todayISO().slice(0, 7);
    if (!UI.month || !months.includes(UI.month)) UI.month = months.includes(curKey) ? curKey : months[0];
    const key = UI.month, prevKey = prevMonthKey(key);
    // the month view ignores the date filter but respects the other filters
    const pool = ALL.filter((r) => (!F.artist || r.artist === F.artist) && (!F.venue || r.venue === F.venue) && (!F.account || r.account === F.account) && (!F.result || (F.result === "win" ? Math.round(r.profit * 100) > 0 : r.res === F.result)));
    const mRows = pool.filter((r) => r.month === key), pRows = pool.filter((r) => r.month === prevKey);
    const isCurrent = key === curKey, dim = daysInMonth(key), dayNow = isCurrent ? Number(todayISO().slice(8)) : dim;
    const pSame = pRows.filter((r) => Number(r.day.slice(8)) <= dayNow);
    const m = agg(mRows), p = agg(pSame);
    const select = h("select", { id: "m-sel", style: { width: "auto", minWidth: "200px" } }, months.map((k) => h("option", { value: k, text: `${monthLabel(k, true)}${k === curKey ? " (this month)" : ""}` })));
    select.value = key; select.onchange = () => { UI.month = select.value; paint(); };
    const artists = groupBy(mRows, (r) => r.artist).sort((a, b) => b.profit - a.profit);
    const venues = groupBy(mRows, (r) => r.venue).sort((a, b) => b.profit - a.profit);
    const pace = isCurrent && dayNow ? (m.profit / dayNow) * dim : null;
    const delta = (a, b) => (b ? `${a >= b ? "▲" : "▼"} ${sm(a - b)} vs same point last month` : "First month on record");
    const bullets = mRows.length ? [
      h("li", {}, h("b", { text: plural(m.n, "sale") }), ` (${plural(m.tickets, "ticket")}) brought in ${money(m.revenue)} and made `, h("b", { class: cls(m.profit), text: sm(m.profit) }), ` profit at ${sp(m.roi)} average ROI.`),
      pace != null ? h("li", {}, "At this pace you'll finish the month around ", h("b", { text: sm(pace) }), ".") : "",
      artists[0] ? h("li", {}, "Top artist: ", entityLink("artist", artists[0].key), ` (${sm(artists[0].profit)} across ${plural(artists[0].n, "sale")}). Top venue: `, entityLink("venue", venues[0] && venues[0].key), venues[0] ? ` (${sm(venues[0].profit)}).` : "") : "",
      h("li", {}, m.losses ? `${plural(m.losses, "losing sale")} this month, ${sm(m.lossAmt)} in total.` : "No losing sales this month."),
      pSame.length ? h("li", {}, `Compared with ${monthLabel(prevKey, true)} through day ${dayNow}: `, h("b", { class: cls(m.profit - p.profit), text: `${sm(m.profit - p.profit)} profit` }), `, ${m.n - p.n >= 0 ? "+" : ""}${m.n - p.n} sales.`) : "",
    ] : [h("li", {}, "No sales in this month yet.")];
    // running profit by day: this month vs last month
    const days = Array.from({ length: dim }, (_, i) => i + 1);
    const cum = (rs, upto) => { const byDay = new Map(); rs.forEach((r) => byDay.set(Number(r.day.slice(8)), (byDay.get(Number(r.day.slice(8))) || 0) + r.profit)); let s = 0; return days.map((d) => (d > upto ? null : (s += byDay.get(d) || 0))); };
    const line = lineChart({ label: "Running profit through the month", labels: days.map(String), titles: days.map((d) => `${monthLabel(key, true).split(" ")[0]} ${d}`),
      series: [{ name: monthLabel(key, true), values: cum(mRows, dayNow), color: "var(--accent)" }, { name: monthLabel(prevKey, true), values: cum(pRows, daysInMonth(prevKey)).slice(0, dim), color: "#5b6878", dashed: true }] });
    const byDay = groupBy(mRows, (r) => r.day).sort((a, b) => a.key.localeCompare(b.key));
    const bestDay = [...byDay].sort((a, b) => b.profit - a.profit)[0], busiest = [...byDay].sort((a, b) => b.n - a.n)[0];
    const bestSale = [...mRows].sort((a, b) => b.profit - a.profit)[0], worstSale = [...mRows].sort((a, b) => a.profit - b.profit)[0];
    const kv = (pairs) => h("div", { class: "kv" }, pairs.flatMap(([k, v, c]) => [h("div", { class: "k", text: k }), h("div", { class: `v ${c || ""}`, text: v })]));
    const wd = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const kpi = (label, value, foot, c = "") => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${c}`, text: value }), h("div", { class: "f", text: foot }));
    const daily = barChart({ label: "Profit by day", labels: days.map(String), titles: days.map((d) => `${monthLabel(key, true).split(" ")[0]} ${d}`),
      series: [{ name: "Profit", values: days.map((d) => { const g = byDay.find((x) => Number(x.key.slice(8)) === d); return g ? g.profit : (d <= dayNow ? 0 : null); }), color: "var(--series-2)", negColor: "var(--down)" }],
      tip: (i) => { const g = byDay.find((x) => Number(x.key.slice(8)) === i + 1); return g ? [["Profit", sm(g.profit), cls(g.profit)], ["Sales", fmtInt(g.n)], ["Tickets", fmtInt(g.tickets)]] : [["Sales", "0"]]; }, height: 160 });
    return h("div", { class: "stack" },
      h("div", { class: "row" }, h("span", { class: "lbl", text: "Month" }), select, h("span", { class: "muted small", text: isCurrent ? `Day ${dayNow} of ${dim}. Compared with ${monthLabel(prevKey, true)} through day ${dayNow}.` : `${dim} days.` })),
      card(`${monthLabel(key, true)}${isCurrent ? " so far" : ""}`, h("ul", { class: "summary" }, bullets)),
      h("div", { class: "kpis" },
        kpi("Profit", sm(m.profit), delta(m.profit, p.profit), cls(m.profit)), kpi("Revenue", money(m.revenue), `Cost ${money(m.cost)}`),
        kpi("Avg ROI", sp(m.roi), p.roi != null ? `${sp(p.roi)} last month at this point` : "", cls(m.roi)), kpi("Sales", fmtInt(m.n), plural(m.tickets, "ticket")),
        kpi("Win rate", fmtPct(m.winRate, 0), `${fmtInt(m.wins)} wins · ${fmtInt(m.losses)} losses`)),
      h("div", { class: "grid g-2" },
        card("Running profit through the month", line, legend([[monthLabel(key, true), "var(--accent)"], [monthLabel(prevKey, true), "#5b6878", true]])),
        card("Highlights", mRows.length ? kv([
          ["Best day", bestDay ? `${wd(bestDay.key)} · ${sm(bestDay.profit)}` : "—"],
          ["Busiest day", busiest ? `${wd(busiest.key)} · ${plural(busiest.n, "sale")}` : "—"],
          ["Best sale", bestSale ? `${bestSale.artist} · ${sm(bestSale.profit)}` : "—"],
          ["Worst sale", worstSale ? `${worstSale.artist} · ${sm(worstSale.profit)}` : "—", worstSale && worstSale.profit < 0 ? "down" : ""],
          ["Profit per sale", sm(m.n ? m.profit / m.n : 0)], ["Profit per ticket", sm(m.tickets ? m.profit / m.tickets : 0)],
          ["Avg time to sell", dur(m.tts)], ["Artists / venues", `${artists.length} / ${venues.length}`]]) : empty("No sales yet."))),
      card("Profit by day", daily));
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
        kpi("Barely made money", fmtInt(ehh.length), "Ehh or break-even sales", ehh.length ? "meh" : ""),
        kpi("Profit without losses", sm(rows.reduce((a, r) => a + r.profit, 0) - lost), "What you'd have made")),
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

/* ---------- artists / venues list ---------- */
function trendOf(rs) {
  const now = Date.now(), a = rs.filter((r) => r.ts > now - 30 * DAY), b = rs.filter((r) => r.ts <= now - 30 * DAY && r.ts > now - 60 * DAY);
  const pa = a.reduce((x, r) => x + r.profit, 0), pb = b.reduce((x, r) => x + r.profit, 0);
  if (!a.length && !b.length) return { dir: 0, text: "Quiet" };
  return pa >= pb ? { dir: 1, text: "Up" } : { dir: -1, text: "Down" };
}
function entityList(kind, rows) {
  const groups = groupBy(rows, (r) => r[kind]).map((g) => ({ ...g, trend: trendOf(g.rows), avgCost: g.tickets ? g.cost / g.tickets : null }));
  const q = h("input", { type: "search", placeholder: `Find ${KIND[kind][2]}`, value: UI.entQ, style: { maxWidth: "260px" } });
  let qt; q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { UI.entQ = q.value.trim(); paint(); }, 300); };
  const list = sortRows(groups.filter((g) => !UI.entQ || g.key.toLowerCase().includes(UI.entQ.toLowerCase())), UI.entSort);
  const max = Math.max(1, ...list.map((g) => Math.abs(g.profit)));
  return card(`${KIND[kind][1]} · ${fmtInt(list.length)}`, table([
    ["key", KIND[kind][0], "", (g) => entityLink(kind, g.key)],
    ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ["revenue", "Revenue", "r", (g) => money(g.revenue)],
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

/* ---------- TAG & commission ---------- */
function tagView() {
  // The TAG tab works per calendar month (New York time) and ignores the date filter, so it always matches your books.
  const pool = ALL.filter((r) => (!F.artist || r.artist === F.artist) && (!F.venue || r.venue === F.venue) && (!F.account || r.account === F.account));
  const months = [...new Set(pool.map((r) => r.month))].sort().reverse();
  const curKey = todayISO().slice(0, 7);
  if (!UI.tagMonth || (UI.tagMonth !== "all" && !months.includes(UI.tagMonth))) UI.tagMonth = months.includes(curKey) ? curKey : months[0] || "all";
  const key = UI.tagMonth;
  const rows = key === "all" ? pool : pool.filter((r) => r.month === key);
  const t = agg(rows), comm = commissionOf(t.profit);
  const latest = [...rows].sort((a, b) => b.ts - a.ts)[0];
  const asOf = latest ? new Date(latest.ts).toLocaleString("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  const select = h("select", { id: "tag-month", style: { width: "auto", minWidth: "220px" } },
    months.map((k) => h("option", { value: k, text: `${monthLabel(k, true)}${k === curKey ? " (this month)" : ""}` })), h("option", { value: "all", text: "All time" }));
  select.value = key; select.onchange = () => { UI.tagMonth = select.value; paint(); };
  const rate = h("input", { type: "number", id: "comm-rate", min: "0", max: "100", step: "0.5", value: String(UI.commission), style: { width: "90px" } });
  rate.onchange = async () => {
    const v = Math.min(100, Math.max(0, Number(rate.value) || 0));
    UI.commission = v; const p = await loadPrefs(); p.commission = v; savePrefs(); paint();
  };

  const show = UI.tagVisible;
  const big = (label, value, c, foot) => h("div", { class: "kpi tag big" }, h("div", { class: "lbl", text: label }), h("div", { class: `v ${show ? c : "masked"}`, text: show ? value : "••••••" }), h("div", { class: "f", text: foot }));
  const head = h("div", { class: "kpis three" },
    big(`TAG · ${key === "all" ? "All time" : monthLabel(key, true)}`, sm(t.profit), cls(t.profit), "Net profit after losses"),
    big(`Commission accrued (${UI.commission}%)`, money(comm), "", `${UI.commission}% of the TAG`),
    big("Profit after commission", sm(t.profit - comm), cls(t.profit - comm), "What you keep"));

  const line = (k, v, c = "") => [h("div", { class: "k", text: k }), h("div", { class: `v ${c}`, text: v })];
  const totals = h("div", { class: "kv" }, [
    line("Transactions", fmtInt(t.n)), line("Tickets", fmtInt(t.tickets)),
    line("Gross sales", money(t.revenue)), line("Total cost", money(t.cost)),
    line("Net profit (TAG)", show ? sm(t.profit) : "••••••", show ? cls(t.profit) : ""),
    line("Total losses", money(Math.abs(t.lossAmt)), t.lossAmt ? "down" : ""),
    line("Weighted ROI", sp(t.roi), cls(t.roi)), line("Profit margin", sp(t.margin)),
    line("Profitable / losing / break-even", `${t.wins} / ${t.losses} / ${t.even}`),
    line("Win rate", fmtPct(t.winRate, 2)), line("Profit per ticket", sm(t.tickets ? t.profit / t.tickets : 0)),
    line(`Commission at ${UI.commission}%`, show ? money(comm) : "••••••"), line("Profit after commission", show ? sm(t.profit - comm) : "••••••"),
    line("Latest entry", latest ? `${latest.artist}${latest.section ? `, Sec ${latest.section}` : ""}${latest.row_name ? ` Row ${latest.row_name}` : ""}, ${latest.quantity} tix, ${asOf} ET` : "—"),
  ].flat());

  // month-by-month book
  const byMonth = groupBy(pool, (r) => r.month).sort((a, b) => b.key.localeCompare(a.key));
  const all = agg(pool);
  const mask = (v) => (show ? v : "••••");
  const book = table([
    ["key", "Month", "", (g) => h("a", { class: "link-like", href: `#${CFG.base}/tag`, text: g.key === "all" ? "All time" : monthLabel(g.key, true), onclick: (e) => { e.preventDefault(); UI.tagMonth = g.key; paint(); scrollTo(0, 0); } })],
    ["n", "Sales", "r"], ["tickets", "Tickets", "r"], ["revenue", "Gross", "r", (g) => money(g.revenue)], ["cost", "Cost", "r", (g) => money(g.cost)],
    ["lossAmt", "Losses", "r", (g) => h("span", { class: g.lossAmt ? "down" : "", text: money(Math.abs(g.lossAmt)) })],
    ["profit", "TAG", "r", (g) => h("span", { class: show ? cls(g.profit) : "", text: mask(sm(g.profit)) })],
    ["roi", "ROI", "r", (g) => h("span", { class: cls(g.roi), text: sp(g.roi) })],
    ["comm", `Commission ${UI.commission}%`, "r", (g) => mask(money(commissionOf(g.profit)))],
    ["after", "After commission", "r", (g) => h("span", { class: show ? cls(g.profit - commissionOf(g.profit)) : "", text: mask(sm(g.profit - commissionOf(g.profit))) })],
  ], [...byMonth, { key: "all", ...all }], { rowClass: (g) => (g.key === key ? "best" : g.key === "all" ? "total" : "") });

  return h("div", { class: "stack" },
    h("div", { class: "row" }, h("span", { class: "lbl", text: "Period" }), select, h("span", { class: "spacer" }),
      h("label", { for: "comm-rate", class: "inline-lbl", text: "Commission %" }), rate,
      h("button", { type: "button", onclick: () => { UI.tagVisible = !UI.tagVisible; paint(); } }, show ? "Hide numbers" : "Show numbers")),
    head,
    h("div", { class: "grid g-tag" },
      card(`${key === "all" ? "All-time" : monthLabel(key, true)} totals${latest ? ` · through ${asOf} ET` : ""}`, totals, null,
        "Calculated from every sale in the hub, using New York time. Win, loss and break-even go by the actual profit. Commission is charged on a positive TAG only."),
      card("Month by month", book)));
}

/* ---------- how you did: today, last 3 days, last 7 days ---------- */
function recentView() {
  // Uses every filter except the date range, and only this book's own sales.
  const pool = ALL.filter((r) => (!F.artist || r.artist === F.artist) && (!F.venue || r.venue === F.venue) && (!F.account || r.account === F.account));
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
    h("div", { class: "row" }, h("span", { class: "muted small", text: `${CFG.title ? "PLT company sales only" : "Your sales only"}. New York time. Each period is compared with the same length of time just before it.` }), h("span", { class: "spacer" }),
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
