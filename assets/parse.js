// Turns copied Discord sale posts ("Label: value" lines) into sale records.
const SYN = {
  artist: ["event", "artist", "event name", "performer", "show", "title"],
  venue: ["venue", "location"],
  event_date: ["event date", "show date", "date of event", "date"],
  section_row: ["section/row", "section / row", "sec/row", "section row", "seats", "seat"],
  section: ["section", "sec"],
  row: ["row"],
  quantity: ["qty", "quantity", "tickets", "# tickets", "ticket qty", "tix"],
  total_sale: ["total sale", "sale total", "total sold", "sold for", "total payout", "payout", "sale price", "total"],
  total_cost: ["total cost", "cost", "purchase total", "total purchase", "total paid", "paid"],
  profit: ["profit", "net profit", "net", "p/l", "pnl"],
  roi: ["roi"],
  cost_per: ["cost per ticket", "cost per", "cost/ticket", "cost each", "buy price"],
  sold_per: ["sold per ticket", "sold per", "sold/ticket", "price per ticket", "sell price", "sold each"],
  purchase_date: ["purchase date", "purchased", "date purchased", "bought", "buy date", "purchased on"],
  sold_date: ["sold date", "sale date", "date sold", "sold on date", "sold"],
  order_number: ["order", "order #", "order number", "order id", "order no"],
  account: ["account", "buyer account", "acct", "email"],
  marketplace: ["marketplace", "platform", "sold on", "exchange", "site"],
  notes: ["notes", "note", "comments"],
};
const clean = (s) => s.replace(/[*_`~>|]/g, "").replace(/^[^\p{L}\p{N}#]+/u, "").trim();
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, " ").replace(/[:\-–]+$/, "").trim();

function fieldFor(label) {
  const l = norm(label);
  for (const [f, list] of Object.entries(SYN)) if (list.includes(l)) return f;
  let best = null, len = 0;
  for (const [f, list] of Object.entries(SYN)) for (const sy of list) if (sy.length > 3 && l.includes(sy) && sy.length > len) { best = f; len = sy.length; }
  return best;
}

export function parseSalePosts(text) {
  const out = []; let cur = {};
  const push = () => { if (cur.artist || cur.order_number) out.push(cur); cur = {}; };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = clean(line).match(/^(.{2,40}?)\s*[:：\-–]\s+(.+)$/) || clean(line).match(/^(.{2,40}?):\s*(.+)$/);
    if (!m) continue;
    const f = fieldFor(m[1]);
    if (!f) continue;
    const val = clean(m[2]);
    if (f === "section_row") {
      const sr = val.match(/^(?:sec(?:tion)?\s*)?([^\/,]+?)\s*(?:\/|,|\s+row\s+)\s*(?:row\s*)?(.+)$/i);
      if (sr) { if (cur.section) push(); cur.section = sr[1].trim(); cur.row = sr[2].trim(); } else cur.section = val;
      continue;
    }
    if (cur[f] != null) push();  // the same label again = a new post started
    cur[f] = val;
  }
  push();
  return out;
}
