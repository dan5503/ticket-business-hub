// CSV reading + automatic column matching for the orders/inventory upload.

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  const delim = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Order matters: more specific fields claim their column first.
export const FIELDS = [
  ["purchase_date", "Purchase date", ["purchase date", "purchased", "date purchased", "order date", "buy date", "bought", "purchase"]],
  ["event_date", "Event date", ["event date", "show date", "date of event", "date"]],
  ["cost_per", "Cost per ticket", ["cost per", "cost per ticket", "price per", "per ticket", "unit price", "unit cost", "ticket price", "cost each", "price each"]],
  ["total_cost", "Total cost", ["total cost", "total paid", "total", "cost", "amount", "price paid", "paid", "price"]],
  ["order_number", "Order #", ["order number", "order #", "order no", "order id", "order", "confirmation", "conf", "conf #"]],
  ["quantity", "Quantity", ["quantity", "qty", "tickets", "# tickets", "ticket count", "tix", "# of tickets"]],
  ["section", "Section", ["section", "sec"]],
  ["row", "Row", ["row"]],
  ["venue", "Venue", ["venue", "location", "arena", "stadium"]],
  ["artist", "Artist / event", ["artist", "event", "event name", "performer", "show", "name", "team"]],
  ["account", "Buyer account", ["account", "buyer account", "buyer", "email", "purchaser", "acct"]],
  ["status", "Status", ["status", "state"]],
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

function score(headers) {
  return headers.filter((hd) => FIELDS.some(([, , syn]) => syn.includes(norm(hd)))).length;
}

// Finds the header row (handles title rows above the real header) and maps columns.
export function detect(rows) {
  let hi = 0, best = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) { const sc = score(rows[i]); if (sc > best) { best = sc; hi = i; } }
  const headers = rows[hi].map((x) => x.trim());
  const used = new Set(), map = {};
  for (const [key, , syn] of FIELDS) {
    let idx = headers.findIndex((hd, i) => !used.has(i) && syn.includes(norm(hd)));
    if (idx < 0) idx = headers.findIndex((hd, i) => !used.has(i) && syn.some((sy) => sy.length > 3 && norm(hd).includes(sy)));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return { headerIndex: hi, headers, map, data: rows.slice(hi + 1) };
}

export function toRecords({ headers, map, data }) {
  return data.map((r) => {
    const rec = {};
    for (const [key] of FIELDS) if (map[key] != null && map[key] !== "") rec[key] = (r[map[key]] ?? "").trim();
    rec.raw = Object.fromEntries(headers.map((hd, i) => [hd || `Column ${i + 1}`, r[i] ?? ""]));
    return rec;
  }).filter((rec) => rec.artist || rec.order_number);
}
