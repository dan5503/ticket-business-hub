// Click any column heading in any table to sort by it (click again to flip).
// Works on every page automatically. Tables that already have their own sorting
// (your sales list, inventory) keep theirs. Your choice is remembered while the hub is open,
// so it sticks when a page redraws.
const state = new Map(); // table key -> { col, dir }

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(,? \d{4})?/i;
function cellText(td) { return (td?.textContent || "").replace(/\s+/g, " ").trim(); }
function asDate(s) {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Date.parse(s.slice(0, 10));
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) { const [m, d, y] = s.split(/[/\s]/); return Date.parse(`${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`); }
  const w = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,? /i, "");
  if (MONTH.test(w)) { const m = w.match(MONTH)[0]; const v = Date.parse(/\d{4}/.test(m) ? m : `${m}, ${new Date().getFullYear()}`); return isNaN(v) ? null : v; }
  return null;
}
function asNum(s) {
  const t = s.replace(/[−–]/g, "-").replace(/[,\s]/g, "");
  const m = t.match(/^([+-]?)\$?([+-]?)(\d+(?:\.\d+)?)(%|x|k|m)?/i);
  if (!m) return null;
  let v = +m[3] * (m[1] === "-" || m[2] === "-" ? -1 : 1);
  if (/k/i.test(m[4] || "")) v *= 1e3; if (/^m$/i.test(m[4] || "")) v *= 1e6;
  return v;
}
const NUMLIKE = /^[+\-−–]?\$?[+\-−–]?[\d,]+(\.\d+)?\s*(%|x|k|m)?\b/i;

function tableKey(table) {
  const card = table.closest(".card");
  const title = card?.querySelector(".card-title")?.textContent || "";
  const heads = [...table.tHead.rows[0].cells].map(cellText).join("|");
  return `${location.hash.split("/")[0]}|${title}|${heads}`;
}
const ownSorting = (table) => [...table.tHead.querySelectorAll("th")].some((th) => th.onclick || th.dataset.k || th.getAttribute("aria-sort"));

function sortTable(table, col, dir) {
  const body = table.tBodies[0]; if (!body) return;
  const rows = [...body.rows];
  const real = rows.filter((r) => r.cells.length > col && r.cells[0].colSpan === 1); // skip "nothing here" and group-heading rows
  const rest = rows.filter((r) => !real.includes(r));
  const texts = real.map((r) => cellText(r.cells[col]));
  const filled = texts.filter((t) => t && t !== "—" && t !== "-");
  const dates = filled.filter((t) => asDate(t) != null).length, nums = filled.filter((t) => NUMLIKE.test(t)).length;
  const kind = filled.length && dates >= filled.length * 0.7 ? "date" : filled.length && nums >= filled.length * 0.7 ? "num" : "text";
  const val = (t) => (!t || t === "—" || t === "-" ? null : kind === "date" ? asDate(t) : kind === "num" ? asNum(t) : t.toLowerCase());
  const keyed = real.map((r, i) => ({ r, v: val(texts[i]), i }));
  keyed.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1; if (b.v == null) return -1; // blanks always last
    const c = kind === "text" ? a.v.localeCompare(b.v, undefined, { numeric: true }) : a.v - b.v;
    return (c || a.i - b.i) * dir;
  });
  body.append(...keyed.map((k) => k.r), ...rest);
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    th.classList.toggle("sorted", i === col);
    th.dataset.sortDir = i === col ? (dir > 0 ? "asc" : "desc") : "";
  });
  return kind;
}

function prep(table) {
  if (table.dataset.sortReady || !table.tHead?.rows?.length || !table.tBodies[0] || ownSorting(table)) return;
  table.dataset.sortReady = "1";
  table.classList.add("auto-sort");
  [...table.tHead.rows[0].cells].forEach((th) => { th.tabIndex = 0; th.title = th.title || "Click to sort"; });
  const saved = state.get(tableKey(table));
  if (saved) sortTable(table, saved.col, saved.dir);
}

function onActivate(e) {
  if (e.type === "keydown" && e.key !== "Enter") return;
  const th = e.target.closest?.("table.auto-sort > thead th");
  if (!th || e.target.closest("button, a, input, select")) return;
  const table = th.closest("table"), col = th.cellIndex, key = tableKey(table);
  const cur = state.get(key);
  let dir;
  if (cur && cur.col === col) dir = -cur.dir;
  else {
    // numbers and dates start biggest/newest first; words start A→Z
    const probe = cellText(table.tBodies[0]?.rows[0]?.cells[col]);
    dir = asDate(probe) != null || NUMLIKE.test(probe) ? -1 : 1;
  }
  state.set(key, { col, dir });
  sortTable(table, col, dir);
}

export function startSortableTables() {
  document.addEventListener("click", onActivate);
  document.addEventListener("keydown", onActivate);
  const scan = () => document.querySelectorAll("table:not([data-sort-ready])").forEach(prep);
  new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 30); }).observe(document.body, { childList: true, subtree: true });
  scan();
}
