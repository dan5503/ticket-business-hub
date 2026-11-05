import { sb, h, fetchAll, fmtMoney, fmtInt, fmtDate, toast, modal, niceError, todayISO } from "./common.js";
import { parseCsv, detect, toRecords, FIELDS } from "./csv.js";
import { exportCsv } from "./dashboard.js";

const COLS = "id,order_number,artist,venue,event_date,purchase_date,section,row_name,quantity,total_cost,cost_per,account,status,created_at";

export async function renderInventory(root) {
  const [items, soldRows, runs] = await Promise.all([
    fetchAll("purchases", COLS, "event_date"),
    fetchAll("sales", "id,order_number", "created_at"),
    sb.from("sync_runs").select("created_at,added").eq("kind", "inventory").order("created_at", { ascending: false }).limit(1),
  ]);
  const soldOrders = new Set(soldRows.map((r) => (r.order_number || "").trim().toLowerCase()).filter(Boolean));
  const isSold = (p) => p.order_number && soldOrders.has(p.order_number.trim().toLowerCase());
  const today = todayISO();
  const lastUpload = runs.data && runs.data[0];

  const fileIn = h("input", { type: "file", accept: ".csv,.tsv,text/csv", class: "hidden", id: "csv-file" });
  const uploadBtn = h("button", { class: "primary", type: "button", onclick: () => fileIn.click() }, "⬆ Upload orders CSV");
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = "";
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast("That file is over 15 MB.", "error");
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return toast("That file looks empty.", "error");
    previewImport(f.name, detect(rows), () => renderInventory(root));
  };

  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", { text: "Inventory" }),
      h("div", { class: "sub", text: lastUpload ? `Last updated ${new Date(lastUpload.created_at).toLocaleString()} · ${fmtInt(lastUpload.added)} rows` : "Upload your orders sheet as a CSV to get started." })),
    h("span", { class: "spacer" }), uploadBtn, fileIn);

  if (!items.length) {
    root.replaceChildren(head, h("div", { class: "card empty" },
      h("h2", { text: "No inventory yet" }),
      h("p", { text: "In Google Sheets: File → Download → Comma-separated values (.csv). Then click “Upload orders CSV”. Each upload replaces the previous one, so just re-upload whenever your sheet changes." })));
    return;
  }

  const unsold = items.filter((p) => !isSold(p));
  const upcoming = unsold.filter((p) => !p.event_date || p.event_date >= today);
  const past = unsold.filter((p) => p.event_date && p.event_date < today);
  const sum = (arr, k) => arr.reduce((a, r) => a + Number(r[k] || 0), 0);
  const matched = items.length - unsold.length;

  const tile = (label, value, foot) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value num", text: value }), foot ? h("div", { class: "foot", text: foot }) : null);
  const kpis = h("div", { class: "grid kpis" },
    tile("Orders on sheet", fmtInt(items.length), `${fmtInt(sum(items, "quantity"))} tickets`),
    tile("Money in inventory", fmtMoney(sum(upcoming, "total_cost")), `${fmtInt(sum(upcoming, "quantity"))} tickets for upcoming events`),
    tile("Matched to a sale", fmtInt(matched), matched ? "by order number" : "no order numbers matched yet"),
    tile("Past events, not marked sold", fmtInt(past.length), past.length ? fmtMoney(sum(past, "total_cost")) + " at cost" : "nothing stuck"));

  // ---- table ----
  const cols = [["artist", "Artist / event"], ["event_date", "Event date"], ["venue", "Venue"], ["section", "Section"], ["row_name", "Row"],
    ["quantity", "Tickets"], ["cost_per", "Cost per"], ["total_cost", "Total cost"], ["purchase_date", "Purchased"], ["account", "Account"], ["order_number", "Order #"]];
  let show = "upcoming", q = "";
  const tbody = h("tbody"), count = h("span", { class: "muted small" });
  const seg = h("div", { class: "seg" });
  const search = h("input", { type: "search", placeholder: "Search inventory…", class: "grow", "aria-label": "Search inventory" });
  search.oninput = () => { q = search.value.toLowerCase(); paint(); };
  const list = () => {
    const base = show === "upcoming" ? upcoming : show === "past" ? past : items;
    return (q ? base.filter((p) => [p.artist, p.venue, p.account, p.order_number, p.section].some((v) => (v || "").toLowerCase().includes(q))) : base)
      .slice().sort((a, b) => (a.event_date || "9999").localeCompare(b.event_date || "9999"));
  };
  function paint() {
    const l = list();
    [...seg.children].forEach((b) => b.classList.toggle("on", b.dataset.v === show));
    count.textContent = `${fmtInt(l.length)} orders`;
    tbody.replaceChildren(...l.slice(0, 500).map((p) => h("tr", {},
      h("td", { title: p.artist || "" }, p.artist || "—", isSold(p) ? h("span", { class: "pill good", text: " sold" }) : null),
      h("td", { class: "num", text: fmtDate(p.event_date) }), h("td", { text: p.venue || "—" }),
      h("td", { text: p.section || "—" }), h("td", { text: p.row_name || "—" }), h("td", { class: "r num", text: p.quantity ?? "—" }),
      h("td", { class: "r num", text: fmtMoney(p.cost_per == null ? null : Number(p.cost_per), true) }),
      h("td", { class: "r num", text: fmtMoney(p.total_cost == null ? null : Number(p.total_cost), true) }),
      h("td", { class: "num", text: fmtDate(p.purchase_date) }), h("td", { text: p.account || "—" }), h("td", { text: p.order_number || "—" }))));
  }
  [["upcoming", "Upcoming / unsold"], ["past", "Past, unsold"], ["all", "Everything"]].forEach(([v, t]) =>
    seg.append(h("button", { type: "button", "data-v": v, text: t, onclick: () => { show = v; paint(); } })));
  paint();

  root.replaceChildren(head, kpis,
    h("div", { class: "card mt" },
      h("div", { class: "card-head" }, seg, count, h("span", { class: "spacer" }), search,
        h("button", { type: "button", onclick: () => exportCsv(cols, list(), "inventory") }, "⬇ Export")),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, cols.map(([k, t]) => h("th", { class: ["quantity", "cost_per", "total_cost"].includes(k) ? "r" : "", text: t })))), tbody)),
      list().length > 500 ? h("p", { class: "muted small mt", text: "Showing the first 500. Use search to narrow down." }) : null));
}

function previewImport(fileName, det, done) {
  const selects = {};
  const opts = [h("option", { value: "", text: "— not in my sheet —" }), ...det.headers.map((hd, i) => h("option", { value: String(i), text: hd || `Column ${i + 1}` }))];
  const grid = h("div", { class: "mapgrid" }, FIELDS.map(([key, label]) => {
    const sel = h("select", { id: `map-${key}` }, opts.map((o) => o.cloneNode(true)));
    sel.value = det.map[key] != null ? String(det.map[key]) : "";
    selects[key] = sel;
    return h("div", {}, h("label", { for: `map-${key}`, text: label }), sel);
  }));
  const info = h("p", { class: "muted small" });
  const update = () => {
    for (const [k, sel] of Object.entries(selects)) det.map[k] = sel.value === "" ? null : Number(sel.value);
    const recs = toRecords(det);
    info.textContent = `${fmtInt(recs.length)} orders will be imported from “${fileName}”. This replaces your current inventory.`;
    return recs;
  };
  Object.values(selects).forEach((s) => (s.onchange = update));
  update();
  modal("Check your columns", h("div", {},
    h("p", { class: "small", text: "I matched your sheet's columns automatically. Fix any that look wrong, then import." }), grid, info),
    (close) => [
      h("button", { type: "button", onclick: close }, "Cancel"), h("span", { class: "spacer" }),
      h("button", { class: "primary", type: "button", onclick: async (e) => {
        const recs = update();
        if (!recs.length) return toast("No rows with an artist/event or order number. Check the column matches.", "error");
        if (det.map.artist == null) return toast("Pick which column is the Artist / event.", "error");
        e.target.disabled = true; e.target.textContent = "Importing…";
        const { data, error } = await sb.rpc("replace_purchases", { p_rows: recs });
        if (error) { e.target.disabled = false; e.target.textContent = "Import"; return toast(niceError(error), "error"); }
        close(); toast(`Inventory updated: ${fmtInt(data.rows)} orders`, "ok"); done();
      } }, "Import")]);
}
