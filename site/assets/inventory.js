import { sb, h, fetchAll, fmtMoney, fmtInt, fmtDate, toast, modal, niceError, todayISO } from "./common.js";
import { parseCsv, detect, toRecords, FIELDS } from "./csv.js";
import { exportCsv } from "./dashboard.js";
import { makeBoard } from "./layout.js";
import { barChart } from "./charts.js";

const COLS = "id,order_number,artist,venue,event_date,purchase_date,section,row_name,quantity,total_cost,cost_per,account,status,sold_qty,remaining_qty,remaining_cost,sold_revenue,sold_profit,last_sold_at,expected_profit,expected_roi,basis,discord_artist";

async function callSheet(body) {
  const { data, error } = await sb.functions.invoke("sheet-sync", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return data;
}

const ago = (iso) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago` : new Date(iso).toLocaleDateString();
};

export async function renderInventory(root) {
  const [items, srcRes, team] = await Promise.all([
    fetchAll("inventory_outlook", COLS, "event_date"),
    sb.from("inventory_sources").select("sheet_url,mapping,last_rows,last_synced_at,last_checked_at,last_status,last_error,via_extension").maybeSingle(),
    fetchAll("plt_artist_7d", "artist,sales,tickets,avg_sold_per,profit,roi,last_sold_at", "artist").catch(() => []),
  ]);
  const teamBy = new Map(team.map((t) => [(t.artist || "").trim().toLowerCase(), t]));
  const sm = (v) => (v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "-"}${fmtMoney(Math.abs(v))}`);
  const sp = (v) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
  const cl = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const source = srcRes.data;
  // Sales offset inventory: each order's tickets minus the tickets sold on that order number.
  const isSold = (p) => p.remaining_qty === 0 && p.quantity > 0;
  const today = todayISO();
  const reload = () => renderInventory(root);

  const unsold = items.filter((p) => p.remaining_qty > 0);
  const upcoming = unsold.filter((p) => p.event_date && p.event_date >= today);
  const undated = unsold.filter((p) => !p.event_date);
  const past = unsold.filter((p) => p.event_date && p.event_date < today);
  const soldItems = items.filter((p) => p.sold_qty > 0);
  const sum = (arr, k) => arr.reduce((a, r) => a + Number(r[k] || 0), 0);

  // ---------- Google Sheet panel ----------
  function sheetPanel() {
    if (!source) {
      const urlIn = h("input", { type: "url", id: "sheet-url", placeholder: "https://docs.google.com/spreadsheets/d/…" });
      const go = h("button", { class: "primary", type: "button" }, "Connect sheet");
      go.onclick = async () => {
        if (!urlIn.value.trim()) return urlIn.focus();
        go.disabled = true; go.textContent = "Reading your sheet…";
        try { const p = await callSheet({ action: "preview", url: urlIn.value.trim() }); columnsDialog(urlIn.value.trim(), p); }
        catch (e) { toast(e.message, "error"); }
        go.disabled = false; go.textContent = "Connect sheet";
      };
      return h("div", {},
        h("p", { class: "small", text: "Paste the link to your orders sheet. The hub will copy it into your inventory every 30 minutes." }),
        h("div", { class: "row mt" }, h("div", { class: "grow" }, urlIn), go),
        h("p", { class: "muted small mt", text: "The sheet must be shared as “Anyone with the link can view” (in Google Sheets: Share, then General access)." }));
    }
    const ok = source.last_status === "ok";
    const hasExt = !!document.documentElement.dataset.hubExtension, viaExt = source.via_extension;
    const askExtension = () => new Promise((resolve, reject) => {
      const t = setTimeout(() => { removeEventListener("message", on); reject(new Error("The Chrome extension didn't answer. Reload this page and try again.")); }, 90000);
      function on(e) { if (e.source !== window || e.data?.type !== "hub-sheet-sync-result") return; clearTimeout(t); removeEventListener("message", on); e.data.res.ok ? resolve(e.data.res.result || {}) : reject(new Error(e.data.res.error)); }
      addEventListener("message", on); postMessage({ type: "hub-sheet-sync" }, location.origin);
    });
    const syncBtn = h("button", { class: "primary", type: "button" }, "Sync now");
    syncBtn.onclick = async () => {
      syncBtn.disabled = true; syncBtn.textContent = "Syncing…";
      try {
        const r = hasExt ? await askExtension() : await callSheet({ action: "sync" });
        toast(r.skipped || (r.rows != null ? `Inventory updated: ${fmtInt(r.rows)} orders` : "Inventory is up to date"), "ok"); reload();
      }
      catch (e) { toast(e.message, "error"); reload(); }
    };
    const colsBtn = h("button", { type: "button" }, "Change columns");
    colsBtn.onclick = async () => {
      colsBtn.disabled = true;
      try { const p = await callSheet({ action: "preview", url: source.sheet_url }); if (source.mapping) p.mapping = { ...p.mapping, ...source.mapping }; columnsDialog(source.sheet_url, p); }
      catch (e) { toast(e.message, "error"); }
      colsBtn.disabled = false;
    };
    const discBtn = h("button", { type: "button", class: "ghost danger" }, "Disconnect");
    discBtn.onclick = async () => {
      if (!confirm("Stop syncing from this sheet? Your current inventory stays in the hub.")) return;
      try { await callSheet({ action: "disconnect" }); toast("Sheet disconnected", "ok"); reload(); } catch (e) { toast(e.message, "error"); }
    };
    return h("div", {},
      h("div", { class: "status-line" },
        h("span", { class: `dot ${ok ? "good" : source.last_status ? "bad" : ""}` }),
        h("b", { text: ok ? "Connected and syncing" : source.last_status ? "Sync problem" : "Connected, waiting for the first sync" }),
        h("span", { class: "muted", text: `${viaExt ? "Your Chrome extension pulls it every 30 minutes while Chrome is open." : "Updates every 30 minutes."} Last checked ${ago(source.last_checked_at)}${source.last_synced_at ? `, last change ${ago(source.last_synced_at)}` : ""}.` })),
      !ok && source.last_error ? h("p", { class: "msg error", text: source.last_error }) : "",
      !ok && !viaExt && /share/i.test(source.last_error || "") ? h("p", { class: "small mt", text: hasExt ? "Not the sheet's admin? No problem: tap Sync now and your Chrome extension will download it using your Google sign-in." : "Not the sheet's admin? Install the latest Business Hub Chrome extension (Discord page) and it will download the sheet using your Google sign-in." }) : "",
      h("a", { class: "sheet-link mt", href: source.sheet_url, target: "_blank", rel: "noopener noreferrer", text: "Open the sheet in Google Sheets" }),
      h("div", { class: "row mt" }, syncBtn, colsBtn, h("span", { class: "spacer" }), discBtn));
  }

  function columnsDialog(url, p) {
    const selects = {};
    const opts = [h("option", { value: "", text: "Not in my sheet" }), ...p.headers.map((hd, i) => h("option", { value: hd, text: hd || `Column ${i + 1}` }))];
    const grid = h("div", { class: "mapgrid" }, FIELDS.map(([key, label]) => {
      const sel = h("select", { id: `map-${key}` }, opts.map((o) => o.cloneNode(true)));
      sel.value = p.mapping[key] || "";
      selects[key] = sel;
      return h("div", {}, h("label", { for: `map-${key}`, text: label }), sel);
    }));
    modal("Match your columns", h("div", {},
      h("p", { class: "small", text: `I found ${fmtInt(p.rowCount)} rows. Check that each item points to the right column in your sheet, then save.` }), grid),
      (close) => [h("button", { type: "button", onclick: close }, "Cancel"), h("span", { class: "spacer" }),
        h("button", { class: "primary", type: "button", onclick: async (e) => {
          const mapping = Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value || null]));
          if (!mapping.artist) return toast("Choose which column holds the artist or event.", "error");
          e.target.disabled = true; e.target.textContent = "Saving and syncing…";
          try { const r = await callSheet({ action: "connect", url, mapping }); close(); toast(`Connected. ${fmtInt(r.rows)} orders imported.`, "ok"); reload(); }
          catch (err) { e.target.disabled = false; e.target.textContent = "Save and sync"; toast(err.message, "error"); }
        } }, "Save and sync")]);
  }

  // ---------- manual CSV upload (backup) ----------
  function csvPanel() {
    const fileIn = h("input", { type: "file", accept: ".csv,.tsv,text/csv", class: "hidden" });
    fileIn.onchange = async () => {
      const f = fileIn.files[0]; fileIn.value = "";
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast("That file is over 15 MB.", "error");
      const rows = parseCsv(await f.text());
      if (rows.length < 2) return toast("That file looks empty.", "error");
      csvDialog(f.name, detect(rows));
    };
    return h("div", {},
      h("p", { class: "small", text: source ? "Your Google Sheet already keeps inventory up to date. Uploading a file replaces it until the next sheet sync." : "Prefer a file? Download your sheet as CSV (File, Download, Comma-separated values) and upload it here." }),
      h("div", { class: "row mt" }, h("button", { type: "button", onclick: () => fileIn.click() }, "Upload CSV file"), fileIn));
  }
  function csvDialog(fileName, det) {
    const selects = {};
    const opts = [h("option", { value: "", text: "Not in my file" }), ...det.headers.map((hd, i) => h("option", { value: String(i), text: hd || `Column ${i + 1}` }))];
    const grid = h("div", { class: "mapgrid" }, FIELDS.map(([key, label]) => {
      const sel = h("select", { id: `cmap-${key}` }, opts.map((o) => o.cloneNode(true)));
      sel.value = det.map[key] != null ? String(det.map[key]) : "";
      selects[key] = sel;
      return h("div", {}, h("label", { for: `cmap-${key}`, text: label }), sel);
    }));
    const info = h("p", { class: "muted small mt" });
    const update = () => {
      for (const [k, sel] of Object.entries(selects)) det.map[k] = sel.value === "" ? null : Number(sel.value);
      const recs = toRecords(det);
      info.textContent = `${fmtInt(recs.length)} orders will be imported from “${fileName}”, replacing your current inventory.`;
      return recs;
    };
    Object.values(selects).forEach((s) => (s.onchange = update));
    update();
    modal("Match your columns", h("div", {}, grid, info), (close) => [
      h("button", { type: "button", onclick: close }, "Cancel"), h("span", { class: "spacer" }),
      h("button", { class: "primary", type: "button", onclick: async (e) => {
        const recs = update();
        if (det.map.artist == null) return toast("Choose which column holds the artist or event.", "error");
        if (!recs.length) return toast("No rows with an artist or order number were found.", "error");
        e.target.disabled = true; e.target.textContent = "Importing…";
        const { data, error } = await sb.rpc("replace_purchases", { p_rows: recs });
        if (error) { e.target.disabled = false; e.target.textContent = "Import"; return toast(niceError(error), "error"); }
        close(); toast(`Inventory updated: ${fmtInt(data.rows)} orders`, "ok"); reload();
      } }, "Import")]);
  }

  // ---------- overview ----------
  function overview() {
    const stat = (label, value, foot) => h("div", { class: "stat" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }), h("div", { class: "foot", text: foot }));
    return h("div", { class: "headline inv" },
      stat("Tickets on hand", fmtInt(sum(upcoming, "remaining_qty")), `${fmtInt(upcoming.length)} orders for upcoming shows`),
      stat("Money tied up", fmtMoney(sum(upcoming, "remaining_cost")), "What your unsold upcoming tickets cost"),
      (() => { const withH = upcoming.filter((p) => p.expected_profit != null), e = sum(withH, "expected_profit"), c = sum(withH, "remaining_cost");
        return stat("Expected profit", sm(e), c ? `${sp((e / c) * 100)} on ${fmtMoney(c)} with sales history` : "Needs sales history"); })(),
      stat("Sold from inventory", fmtInt(sum(items, "sold_qty")), `Tickets matched to Discord sales by order #`),
      stat("Past shows, not matched", fmtInt(sum(past, "remaining_qty")), past.length ? `${fmtMoney(sum(past, "remaining_cost"))} at cost, no sale found` : "Nothing left behind"));
  }

  // ---------- where your money is tied up ----------
  function tiedUp() {
    const m = new Map();
    for (const p of upcoming) {
      const name = p.discord_artist || p.artist || "Unknown", k = name.toLowerCase();
      const g = m.get(k) || { name, left: 0, cost: 0, exp: 0, expCost: 0, next: p.event_date, shows: new Set() };
      g.left += p.remaining_qty; g.cost += Number(p.remaining_cost || 0); g.shows.add(p.event_date);
      if (p.expected_profit != null) { g.exp += Number(p.expected_profit); g.expCost += Number(p.remaining_cost || 0); }
      if (p.event_date < g.next) g.next = p.event_date;
      m.set(k, g);
    }
    const list = [...m.values()].sort((a, b) => b.cost - a.cost);
    if (!list.length) return h("p", { class: "muted", text: "No unsold tickets for upcoming shows." });
    const total = sum(upcoming, "remaining_cost") || 1;
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, [["Artist", ""], ["Shows", "r"], ["Left", "r"], ["At cost", "r"], ["Share", ""], ["Expected", "r"], ["Next show", ""], ["Team, last 7 days", ""]].map(([t, c]) => h("th", { class: c, scope: "col", text: t })))),
      h("tbody", {}, list.slice(0, 25).map((g) => {
        const t = teamBy.get(g.name.toLowerCase()), costPer = g.left ? g.cost / g.left : 0;
        const teamCell = t ? h("span", {}, h("span", { class: "pill good", text: `${t.sales} sold` }), h("span", { class: "sub", text: `avg ${fmtMoney(Number(t.avg_sold_per))}/tix · you paid ${fmtMoney(costPer)}` })) : h("span", { class: "muted", text: "Quiet" });
        return h("tr", {},
          h("td", { class: "strong", text: g.name }), h("td", { class: "r num", text: fmtInt(g.shows.size) }), h("td", { class: "r num strong", text: fmtInt(g.left) }),
          h("td", { class: "r num", text: fmtMoney(g.cost) }),
          h("td", {}, h("div", { class: "mini-bar" }, h("i", { style: { width: `${(g.cost / total) * 100}%` } }))),
          h("td", { class: `r num ${g.expCost ? cl(g.exp) : ""}`, title: g.expCost ? `${sp((g.exp / g.expCost) * 100)} expected ROI` : "No sales history yet", text: g.expCost ? sm(g.exp) : "—" }),
          h("td", { class: "num", text: fmtDate(g.next) }), h("td", {}, teamCell));
      }))),
      list.length > 25 ? h("p", { class: "muted small mt", text: `Top 25 of ${list.length} artists by money tied up.` }) : "");
  }

  // ---------- new inventory: what you bought, day by day ----------
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const ADD = { p: "7d", from: "", to: "" };
  function addedRange() {
    const m = today.slice(0, 7);
    if (ADD.p === "today") return [today, today];
    if (ADD.p === "7d") return [addDays(today, -6), today];
    if (ADD.p === "30d") return [addDays(today, -29), today];
    if (ADD.p === "month") return [m + "-01", today];
    if (ADD.p === "lastmonth") { const d = new Date(m + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); const lm = d.toISOString().slice(0, 7); return [lm + "-01", addDays(m + "-01", -1)]; }
    return [ADD.from || addDays(today, -6), ADD.to || today];
  }
  function added() {
    const box = h("div");
    const paint = () => {
      const [from, to] = addedRange();
      const rows = items.filter((p) => p.purchase_date && p.purchase_date >= from && p.purchase_date <= to);
      const days = new Map();
      rows.forEach((p) => { const g = days.get(p.purchase_date) || []; g.push(p); days.set(p.purchase_date, g); });
      const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      // chart: one bar per day (per week when the range is long)
      const weekly = span > 62, buckets = [];
      for (let d = from; d <= to; d = addDays(d, weekly ? 7 : 1)) {
        const end = weekly ? (addDays(d, 6) < to ? addDays(d, 6) : to) : d;
        const r = rows.filter((p) => p.purchase_date >= d && p.purchase_date <= end);
        buckets.push({ d, end, cost: sum(r, "total_cost"), tix: sum(r, "quantity"), n: r.length });
      }
      const seg = h("div", { class: "seg", role: "group", "aria-label": "Period" }, [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["custom", "Custom"]]
        .map(([k, t]) => h("button", { type: "button", class: ADD.p === k ? "on" : "", onclick: () => { ADD.p = k; if (k === "custom" && !ADD.from) [ADD.from, ADD.to] = [addDays(today, -13), today]; paint(); } }, t)));
      const dateIn = (key, label) => { const el = h("input", { type: "date", value: ADD[key], "aria-label": label, max: today }); el.onchange = () => { ADD[key] = el.value; paint(); }; return h("label", { class: "inline-lbl" }, label + " ", el); };
      const stat = (label, value, foot) => h("div", { class: "kpi" }, h("div", { class: "lbl", text: label }), h("div", { class: "v", text: value }), foot ? h("div", { class: "f", text: foot }) : "");
      const stillLeft = rows.filter((p) => p.remaining_qty > 0);
      const topArtists = [...rows.reduce((m, p) => m.set(p.artist || "Unknown", (m.get(p.artist || "Unknown") || 0) + Number(p.total_cost || 0)), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3);
      box.replaceChildren(
        h("div", { class: "row" }, seg, ADD.p === "custom" ? [dateIn("from", "From"), dateIn("to", "To")] : ""),
        h("div", { class: "kpis four mt" },
          stat("Orders added", fmtInt(rows.length), `${dayLabel.format(new Date(from + "T12:00:00Z"))} to ${dayLabel.format(new Date(to + "T12:00:00Z"))}`),
          stat("Tickets bought", fmtInt(sum(rows, "quantity")), `${fmtInt(sum(stillLeft, "remaining_qty"))} still unsold`),
          stat("Money spent", fmtMoney(sum(rows, "total_cost")), rows.length ? `${fmtMoney(sum(rows, "total_cost") / Math.max(1, sum(rows, "quantity")))} a ticket on average` : ""),
          stat("Most bought", topArtists[0] ? topArtists[0][0] : "—", topArtists.slice(0, 3).map(([a, c]) => `${a.length > 22 ? a.slice(0, 21) + "…" : a} ${fmtMoney(c)}`).join(" · "))),
        span > 1 && rows.length ? h("div", { class: "mt" }, barChart({
          label: "Money spent on new inventory", height: 180,
          labels: buckets.map((b) => dayLabel.format(new Date(b.d + "T12:00:00Z")).replace(/^\w+, /, "")),
          titles: buckets.map((b) => weekly ? `Week of ${dayLabel.format(new Date(b.d + "T12:00:00Z"))}` : dayLabel.format(new Date(b.d + "T12:00:00Z"))),
          series: [{ name: "Spent", values: buckets.map((b) => b.cost), color: "var(--accent)" }],
          tip: (i) => [["Spent", fmtMoney(buckets[i].cost)], ["Tickets", fmtInt(buckets[i].tix)], ["Orders", fmtInt(buckets[i].n)]],
        })) : "",
        rows.length ? h("div", { class: "mt" }, [...days.keys()].sort().reverse().map((d) => {
          const g = days.get(d);
          return h("div", { class: "day-group" },
            h("div", { class: "day-head" }, h("b", { text: dayLabel.format(new Date(d + "T12:00:00Z")) }),
              h("span", { class: "muted small", text: `${g.length} order${g.length === 1 ? "" : "s"} · ${fmtInt(sum(g, "quantity"))} tickets · ${fmtMoney(sum(g, "total_cost"))}` })),
            h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, g.sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0)).map((p) => h("tr", {},
              h("td", { class: "strong", text: p.artist || "—" }), h("td", { class: "num", text: fmtDate(p.event_date) }), h("td", { text: p.venue || "—" }),
              h("td", { text: [p.section, p.row_name].filter(Boolean).join(" · ") || "—" }),
              h("td", { class: "r num", text: `${fmtInt(p.quantity)} tix` }), h("td", { class: "r num", text: fmtMoney(Number(p.total_cost || 0), true) }),
              h("td", { class: "r" }, p.remaining_qty === 0 && p.quantity > 0 ? h("span", { class: "pill good", text: "Sold out" }) : p.sold_qty > 0 ? h("span", { class: "pill meh", text: `${p.remaining_qty} left` }) : h("span", { class: "muted small", text: "Unsold" })),
              h("td", { class: "muted small", text: p.account || "" })))))));
        })) : h("p", { class: "muted mt", text: "No new inventory in this period." }));
    };
    paint();
    return box;
  }

  // ---------- table ----------
  let show = "all", q = "";
  // default: every order, newest purchase first
  const TF = { boughtFrom: "", boughtTo: "", showFrom: "", showTo: "", group: "", sort: "purchase_date", dir: -1 };
  function table() {
    const cols = [["artist", "Artist or event"], ["event_date", "Show date"], ["venue", "Venue"], ["section", "Section"], ["row_name", "Row"],
      ["quantity", "Bought"], ["sold_qty", "Sold"], ["remaining_qty", "Left"], ["cost_per", "Cost per"], ["remaining_cost", "Left at cost"], ["expected_profit", "Expected"], ["purchase_date", "Bought on"], ["account", "Account"], ["order_number", "Order #"]];
    const tbody = h("tbody"), count = h("span", { class: "muted small" });
    const chips = h("div", { class: "chips" });
    const search = h("input", { type: "search", placeholder: "Search inventory", "aria-label": "Search inventory", value: q });
    search.oninput = () => { q = search.value.toLowerCase(); paint(); };
    const sets = { upcoming, undated, past, sold: soldItems, all: items };
    const list = () => {
      const base = sets[show] || items;
      const inRange = (v, f, t) => (!f || (v && v >= f)) && (!t || (v && v <= t));
      const l = (q ? base.filter((p) => [p.artist, p.venue, p.account, p.order_number, p.section].some((v) => (v || "").toLowerCase().includes(q))) : base)
        .filter((p) => inRange(p.purchase_date, TF.boughtFrom, TF.boughtTo) && inRange(p.event_date, TF.showFrom, TF.showTo));
      const NUM = ["quantity", "sold_qty", "remaining_qty", "cost_per", "remaining_cost", "expected_profit"];
      const cmp = (k) => (a, b) => {
        const x = a[k], y = b[k];
        if (x == null || x === "") return 1; if (y == null || y === "") return -1;
        return (NUM.includes(k) ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * TF.dir;
      };
      const def = (a, b) => (show === "sold" ? String(b.last_sold_at || "").localeCompare(String(a.last_sold_at || "")) : (a.event_date || "9999").localeCompare(b.event_date || "9999"));
      return l.slice().sort(TF.sort ? cmp(TF.sort) : def);
    };
    const rowOf = (p) => h("tr", {},
        h("td", { class: "strong", title: p.artist || "" }, p.artist || "—",
          p.remaining_qty === 0 && p.quantity > 0 ? h("span", { class: "pill good", text: "Sold out" }) : p.sold_qty > 0 ? h("span", { class: "pill meh", text: "Partly sold" }) : ""),
        h("td", { class: "num", text: fmtDate(p.event_date) }), h("td", { text: p.venue || "—" }),
        h("td", { text: p.section || "—" }), h("td", { text: p.row_name || "—" }),
        h("td", { class: "r num", text: p.quantity ?? "—" }), h("td", { class: "r num", text: p.sold_qty || "—" }),
        h("td", { class: "r num strong", text: p.remaining_qty }),
        h("td", { class: "r num", text: fmtMoney(p.cost_per == null ? null : Number(p.cost_per), true) }),
        h("td", { class: "r num", text: fmtMoney(Number(p.remaining_cost || 0), true) }),
        h("td", { class: `r num ${p.remaining_qty > 0 ? cl(Number(p.expected_profit)) : ""}`, title: p.basis ? `${sp(Number(p.expected_roi))} ROI, based on how this ${p.basis} sold for you` : "No sales history for this artist yet", text: p.remaining_qty > 0 && p.expected_profit != null ? sm(Number(p.expected_profit)) : "—" }),
        h("td", { class: "num", text: fmtDate(p.purchase_date) }), h("td", { text: p.account || "—" }), h("td", { text: p.order_number || "—" }));
    const GROUPS = { purchase_date: ["Bought on", (p) => p.purchase_date, (k) => (k ? dayLabel.format(new Date(k + "T12:00:00Z")) : "No purchase date")],
      bought_month: ["Month bought", (p) => (p.purchase_date || "").slice(0, 7), (k) => (k ? new Date(k + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "No purchase date")],
      event_date: ["Show date", (p) => p.event_date, (k) => (k ? dayLabel.format(new Date(k + "T12:00:00Z")) : "No show date")],
      artist: ["Artist", (p) => p.artist, (k) => k || "Unknown"], venue: ["Venue", (p) => p.venue, (k) => k || "Unknown"], account: ["Account", (p) => p.account, (k) => k || "No account"] };
    function paint() {
      const l = list();
      [...chips.children].forEach((b) => b.classList.toggle("on", b.dataset.v === show));
      count.textContent = `${fmtInt(l.length)} orders · ${fmtInt(sum(l, show === "sold" ? "sold_qty" : "remaining_qty"))} tickets`;
      [...thead.querySelectorAll("th")].forEach((th) => { const on = th.dataset.k === TF.sort; th.classList.toggle("sorted", on); th.setAttribute("aria-sort", on ? (TF.dir > 0 ? "ascending" : "descending") : "none"); th.querySelector(".arrow").textContent = on ? (TF.dir > 0 ? " ▲" : " ▼") : ""; });
      const shown = l.slice(0, 500);
      if (!TF.group) return tbody.replaceChildren(...shown.map(rowOf));
      const [, keyOf, labelOf] = GROUPS[TF.group], groups = new Map();
      shown.forEach((p) => { const k = keyOf(p) || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
      let keys = [...groups.keys()];
      if (["purchase_date", "bought_month"].includes(TF.group)) keys.sort((a, b) => (b || "").localeCompare(a || ""));
      else if (TF.group === "event_date") keys.sort((a, b) => (a || "9999").localeCompare(b || "9999"));
      else keys.sort((a, b) => sum(groups.get(b), "remaining_cost") - sum(groups.get(a), "remaining_cost"));
      tbody.replaceChildren(...keys.flatMap((k) => { const g = groups.get(k); return [
        h("tr", { class: "group-row" }, h("td", { colspan: String(cols.length) }, h("b", { text: labelOf(k) }),
          h("span", { class: "muted small", text: ` · ${g.length} order${g.length === 1 ? "" : "s"} · ${fmtInt(sum(g, "quantity"))} bought · ${fmtInt(sum(g, "remaining_qty"))} left · ${fmtMoney(sum(g, "total_cost"))} spent` }))),
        ...g.map(rowOf)]; }));
    }
    const thead = h("thead", {}, h("tr", {}, cols.map(([k, t]) => h("th", { class: `sortable ${["quantity", "sold_qty", "remaining_qty", "cost_per", "remaining_cost", "expected_profit"].includes(k) ? "r" : ""}`, "data-k": k, scope: "col", tabindex: "0", title: "Sort",
      onclick: () => { TF.dir = TF.sort === k ? -TF.dir : (["quantity", "sold_qty", "remaining_qty", "cost_per", "remaining_cost", "expected_profit", "purchase_date"].includes(k) ? -1 : 1); TF.sort = k; paint(); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } } }, t, h("span", { class: "arrow" })))));
    const dateF = (key, label) => { const el = h("input", { type: "date", value: TF[key], "aria-label": label }); el.onchange = () => { TF[key] = el.value; paint(); }; return h("label", { class: "inline-lbl" }, label + " ", el); };
    const groupSel = h("select", { "aria-label": "Group by", class: "auto-w" }, h("option", { value: "", text: "No grouping" }), Object.entries(GROUPS).map(([k, [t]]) => h("option", { value: k, text: `Group by ${t.toLowerCase()}` })));
    groupSel.value = TF.group; groupSel.onchange = () => { TF.group = groupSel.value; paint(); };
    const clearBtn = h("button", { type: "button", class: "ghost small", text: "Clear dates", onclick: () => { Object.assign(TF, { boughtFrom: "", boughtTo: "", showFrom: "", showTo: "" }); root.querySelectorAll(".inv-dates input").forEach((i) => (i.value = "")); paint(); } });
    [["all", "All inventory"], ["upcoming", "On hand"], ["sold", "Sold"], ["past", "Past shows, not sold"], ["undated", "No show date"]].forEach(([v, t]) =>
      chips.append(h("button", { type: "button", "data-v": v, text: t, onclick: () => { show = v; paint(); } })));
    paint();
    if (!items.length) return h("div", { class: "empty" }, h("h2", { text: "No inventory yet" }), h("p", { text: "Connect your Google Sheet above, or upload a CSV file." }));
    return h("div", {},
      h("div", { class: "row" }, chips, count, h("span", { class: "spacer" }), h("div", { style: { minWidth: "220px", flex: "1 1 220px", maxWidth: "360px" } }, search),
        h("button", { type: "button", onclick: () => exportCsv(cols, list(), "inventory") }, "Download CSV")),
      h("div", { class: "row mt inv-dates" }, dateF("boughtFrom", "Bought from"), dateF("boughtTo", "to"), dateF("showFrom", "Show from"), dateF("showTo", "to"), clearBtn, h("span", { class: "spacer" }), groupSel),
      h("div", { class: "table-wrap mt" }, h("table", {}, thead, tbody)),
      list().length > 500 ? h("p", { class: "muted small mt", text: "Showing the first 500. Search to narrow it down." }) : "");
  }

  const board = await makeBoard("inventory", ["sheet", "overview", "added", "tied", "table", "csv"], {
    sheet: { title: "Google Sheet", collapsed: false, render: sheetPanel },
    overview: { title: "Overview", bare: true, render: overview },
    added: { title: "New inventory", hint: "Orders by the date you bought them (the purchase date in your sheet).", render: added },
    tied: { title: "Where your money is tied up", hint: "Upcoming shows only. Expected profit uses the ROI you actually got on the same show, or on that artist when the show hasn't sold yet. Team shows what PLT sold of that artist in the last 7 days. It's a signal only and never added to your numbers.", render: tiedUp },
    table: { title: "Your tickets", hint: "Sales come off automatically: each order shows how many tickets you bought, how many sold on Discord (matched by order #), and how many are left.", render: table },
    csv: { title: "Upload a file instead", collapsed: true, render: csvPanel },
  });
  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Inventory" }), h("p", { class: "sub", text: "Tickets you own, copied automatically from your Google Sheet." }))),
    board.el);
}
