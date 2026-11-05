import { sb, h, fetchAll, fmtMoney, fmtInt, fmtDate, toast, modal, niceError, todayISO } from "./common.js";
import { parseCsv, detect, toRecords, FIELDS } from "./csv.js";
import { exportCsv } from "./dashboard.js";
import { makeBoard } from "./layout.js";

const COLS = "id,order_number,artist,venue,event_date,purchase_date,section,row_name,quantity,total_cost,cost_per,account,status,sold_qty,remaining_qty,remaining_cost,sold_revenue,sold_profit,last_sold_at";

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
  const [items, srcRes] = await Promise.all([
    fetchAll("inventory_live", COLS, "event_date"),
    sb.from("inventory_sources").select("sheet_url,mapping,last_rows,last_synced_at,last_checked_at,last_status,last_error").maybeSingle(),
  ]);
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
    const syncBtn = h("button", { class: "primary", type: "button" }, "Sync now");
    syncBtn.onclick = async () => {
      syncBtn.disabled = true; syncBtn.textContent = "Syncing…";
      try { const r = await callSheet({ action: "sync" }); toast(`Inventory updated: ${fmtInt(r.rows)} orders`, "ok"); reload(); }
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
        h("span", { class: "muted", text: `Updates every 30 minutes. Last checked ${ago(source.last_checked_at)}${source.last_synced_at ? `, last change ${ago(source.last_synced_at)}` : ""}.` })),
      !ok && source.last_error ? h("p", { class: "msg error", text: source.last_error }) : "",
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
      stat("Sold from inventory", fmtInt(sum(items, "sold_qty")), `Tickets matched to Discord sales by order #`),
      stat("Past shows, not matched", fmtInt(sum(past, "remaining_qty")), past.length ? `${fmtMoney(sum(past, "remaining_cost"))} at cost, no sale found` : "Nothing left behind"));
  }

  // ---------- table ----------
  let show = "upcoming", q = "";
  function table() {
    const cols = [["artist", "Artist or event"], ["event_date", "Show date"], ["venue", "Venue"], ["section", "Section"], ["row_name", "Row"],
      ["quantity", "Bought"], ["sold_qty", "Sold"], ["remaining_qty", "Left"], ["cost_per", "Cost per"], ["remaining_cost", "Left at cost"], ["purchase_date", "Bought on"], ["account", "Account"], ["order_number", "Order #"]];
    const tbody = h("tbody"), count = h("span", { class: "muted small" });
    const chips = h("div", { class: "chips" });
    const search = h("input", { type: "search", placeholder: "Search inventory", "aria-label": "Search inventory", value: q });
    search.oninput = () => { q = search.value.toLowerCase(); paint(); };
    const sets = { upcoming, undated, past, sold: soldItems, all: items };
    const list = () => {
      const base = sets[show] || items;
      return (q ? base.filter((p) => [p.artist, p.venue, p.account, p.order_number, p.section].some((v) => (v || "").toLowerCase().includes(q))) : base)
        .slice().sort((a, b) => (show === "sold" ? String(b.last_sold_at || "").localeCompare(String(a.last_sold_at || "")) : (a.event_date || "9999").localeCompare(b.event_date || "9999")));
    };
    function paint() {
      const l = list();
      [...chips.children].forEach((b) => b.classList.toggle("on", b.dataset.v === show));
      count.textContent = `${fmtInt(l.length)} orders · ${fmtInt(sum(l, show === "sold" ? "sold_qty" : "remaining_qty"))} tickets`;
      tbody.replaceChildren(...l.slice(0, 500).map((p) => h("tr", {},
        h("td", { class: "strong", title: p.artist || "" }, p.artist || "—",
          p.remaining_qty === 0 && p.quantity > 0 ? h("span", { class: "pill good", text: "Sold out" }) : p.sold_qty > 0 ? h("span", { class: "pill meh", text: "Partly sold" }) : ""),
        h("td", { class: "num", text: fmtDate(p.event_date) }), h("td", { text: p.venue || "—" }),
        h("td", { text: p.section || "—" }), h("td", { text: p.row_name || "—" }),
        h("td", { class: "r num", text: p.quantity ?? "—" }), h("td", { class: "r num", text: p.sold_qty || "—" }),
        h("td", { class: "r num strong", text: p.remaining_qty }),
        h("td", { class: "r num", text: fmtMoney(p.cost_per == null ? null : Number(p.cost_per), true) }),
        h("td", { class: "r num", text: fmtMoney(Number(p.remaining_cost || 0), true) }),
        h("td", { class: "num", text: fmtDate(p.purchase_date) }), h("td", { text: p.account || "—" }), h("td", { text: p.order_number || "—" }))));
    }
    [["upcoming", "On hand"], ["sold", "Sold"], ["past", "Past shows, not sold"], ["undated", "No show date"], ["all", "Everything"]].forEach(([v, t]) =>
      chips.append(h("button", { type: "button", "data-v": v, text: t, onclick: () => { show = v; paint(); } })));
    paint();
    if (!items.length) return h("div", { class: "empty" }, h("h2", { text: "No inventory yet" }), h("p", { text: "Connect your Google Sheet above, or upload a CSV file." }));
    return h("div", {},
      h("div", { class: "row" }, chips, count, h("span", { class: "spacer" }), h("div", { style: { minWidth: "220px", flex: "1 1 220px", maxWidth: "360px" } }, search),
        h("button", { type: "button", onclick: () => exportCsv(cols, list(), "inventory") }, "Download CSV")),
      h("div", { class: "table-wrap mt" }, h("table", {},
        h("thead", {}, h("tr", {}, cols.map(([k, t]) => h("th", { class: ["quantity", "sold_qty", "remaining_qty", "cost_per", "remaining_cost"].includes(k) ? "r" : "", text: t })))), tbody)),
      list().length > 500 ? h("p", { class: "muted small mt", text: "Showing the first 500. Search to narrow it down." }) : "");
  }

  const board = await makeBoard("inventory", ["sheet", "overview", "table", "csv"], {
    sheet: { title: "Google Sheet", collapsed: false, render: sheetPanel },
    overview: { title: "Overview", bare: true, render: overview },
    table: { title: "Your tickets", hint: "Sales come off automatically: each order shows how many tickets you bought, how many sold on Discord (matched by order #), and how many are left.", render: table },
    csv: { title: "Upload a file instead", collapsed: true, render: csvPanel },
  });
  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Inventory" }), h("p", { class: "sub", text: "Tickets you own, copied automatically from your Google Sheet." }))),
    board.el);
}
