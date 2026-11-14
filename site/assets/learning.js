// Learning Center: what sold well and what didn't, from past sales, so buying gets sharper.
// Data comes from the learning_center() database function, which groups every sale by section type,
// price paid, how far ahead it was bought, row, tickets per order, event weekday, city, venue and artist.
import { sb, h, fmtMoney, fmtInt, fmtPct, niceError } from "./common.js";
import { arrange } from "./layout.js";

const UI = { book: "both", period: "all", artist: "", city: "", tier: "", price: "" };
const BOOKS = [["both", "All sales"], ["mine", "Only mine"], ["plt", "Only PLT"]];
const PERIODS = [["all", "All time"], ["365", "Last 12 months"], ["90", "Last 90 days"]];
const PRICES = ["Under $50", "$50–99", "$100–149", "$150–249", "$250–399", "$400–699", "$700+"];

const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${fmtPct(v * 100, 1)}`);
const rate = (v) => (v == null ? "—" : fmtPct(v * 100, 0));
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "-"}${fmtMoney(Math.abs(v))}`);

export async function renderLearning(root) {
  const filters = h("div");
  const out = h("div", { class: "stack" }, h("p", { class: "muted", text: "Crunching your sales…" }));
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {},
      h("h1", { text: "Learning Center" }),
      h("p", { class: "sub", text: "What sold well, what didn't, and why. Every past sale grouped by section, price paid, timing, row, city and more, so you can see what to go for and what to avoid." }))),
    filters, out);

  let seq = 0, data = null;
  async function load() {
    const my = ++seq;
    out.replaceChildren(h("p", { class: "muted", text: "Crunching your sales…" }));
    const from = UI.period === "all" ? null : new Date(Date.now() - Number(UI.period) * 86400000).toISOString().slice(0, 10);
    const { data: r, error } = await sb.rpc("learning_center", {
      p_book: UI.book, p_from: from, p_to: null, p_artist: UI.artist || null, p_city: UI.city || null, p_tier: UI.tier || null, p_price: UI.price || null,
    });
    if (my !== seq) return;
    if (error) { out.replaceChildren(h("p", { class: "neg", text: niceError(error) })); return; }
    data = r; paintFilters(); paintBody();
  }

  // ---------- filters: also the "check a buy" tool ----------
  let qt;
  const artistIn = h("input", { type: "search", placeholder: "Any artist", value: UI.artist, "aria-label": "Artist" });
  artistIn.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { UI.artist = artistIn.value.trim(); load(); }, 450); };
  function seg(list, key) {
    return h("div", { class: "seg", role: "group" }, list.map(([k, t]) =>
      h("button", { type: "button", class: UI[key] === k ? "on" : "", "aria-pressed": String(UI[key] === k), onclick: () => { UI[key] = k; load(); } }, t)));
  }
  function pick(label, key, options) {
    const s = h("select", { "aria-label": label }, h("option", { value: "", text: `Any ${label.toLowerCase()}` }),
      options.map((o) => h("option", { value: o, text: o, selected: UI[key] === o })));
    s.onchange = () => { UI[key] = s.value; load(); };
    return h("div", { class: "lc-field" }, h("span", { class: "lbl", text: label }), s);
  }
  function paintFilters() {
    const cities = (data?.cities || []).slice().sort();
    const tiers = (data?.tiers || []).slice().sort();
    const active = UI.artist || UI.city || UI.tier || UI.price;
    filters.replaceChildren(h("section", { class: "card lc-check", "data-move-key": "check a buy" },
      h("div", { class: "card-head" }, h("h2", { class: "card-title", text: "Check a buy" }), h("span", { class: "spacer" }), seg(BOOKS, "book"), seg(PERIODS, "period")),
      h("p", { class: "muted small", text: "Thinking about a buy? Set what you're looking at and everything below shows how buys like it have done." }),
      h("p", { class: "muted small", text: UI.book === "plt" ? "PLT sales only cover the artists the bosses track, so some strong artists and buyers won't show here." : UI.book === "both" ? "All sales = your sales plus the office's PLT sales, with your sales that also appear in PLT counted once. PLT only covers the artists the bosses track." : "Your sales: everything you've sold, nothing held back." }),
      h("div", { class: "lc-filters" },
        h("div", { class: "lc-field" }, h("span", { class: "lbl", text: "Artist" }), artistIn),
        pick("City", "city", cities), pick("Section", "tier", tiers), pick("Price paid", "price", PRICES),
        active ? h("button", { type: "button", class: "ghost", onclick: () => { Object.assign(UI, { artist: "", city: "", tier: "", price: "" }); artistIn.value = ""; load(); } }, "Clear") : "")));
  }

  // ---------- body ----------
  function paintBody() {
    const o = data.overall || {};
    if (!o.n) { out.replaceChildren(h("p", { class: "muted", text: "No sales match. Try widening the filters." })); return; }
    const MIN = Math.max(8, Math.round(o.n * 0.004));
    const avg = o.roi ?? 0;
    const tone = (roi, n) => (n < MIN ? "few" : roi == null ? "" : roi < 0 ? "bad" : roi < avg - 0.05 ? "meh" : roi > avg + 0.05 ? "good" : "");
    const book = BOOKS.find(([k]) => k === UI.book)[1];

    const tile = (label, value, foot, cls = "") => h("div", { class: "stat" }, h("span", { class: "label", text: label }), h("span", { class: `value ${cls}`, text: value }), h("span", { class: "foot", text: foot }));
    const tiles = h("div", { class: "headline inv" },
      tile("Sales", fmtInt(o.n), `${fmtInt(o.t)} tickets · ${UI.book === "both" ? "yours + PLT" : book}`),
      tile("Return (ROI)", pct(o.roi), `${money(o.profit)} on ${fmtMoney(o.cost)}`, o.roi >= 0 ? "up" : "down"),
      tile("Win rate", rate(o.win), `${rate(o.loss)} lost money`, o.win >= 0.75 ? "up" : o.win < 0.6 ? "down" : "meh"),
      tile("Profit per ticket", money(o.ppt), "average across all tickets", o.ppt >= 0 ? "up" : "down"),
      tile("Days to sell", o.dts == null ? "—" : `${Math.round(o.dts)}`, "median, bought → sold"));

    // ---------- lessons ----------
    const DIMS = [["tier", "Section"], ["price", "Price paid"], ["lead", "Bought ahead"], ["row", "Row"], ["qty", "Order size"], ["weekday", "Event day"], ["city", "City"]];
    const lessons = [];
    for (const [k, name] of DIMS) {
      const rows = (data[k] || []).filter((r) => r.n >= MIN && r.k !== "Unknown" && r.k !== "Other");
      if (rows.length < 2) continue;
      const best = rows.reduce((a, b) => (b.roi > a.roi ? b : a)), worst = rows.reduce((a, b) => (b.roi < a.roi ? b : a));
      lessons.push({ name, best, worst, spread: best.roi - worst.roi });
    }
    lessons.sort((a, b) => b.spread - a.spread);
    const lessonEl = lessons.length ? h("ul", { class: "lc-lessons" }, lessons.slice(0, 7).map((l) =>
      h("li", {},
        h("span", { class: "lbl", text: l.name }),
        h("span", {}, h("b", { class: "pos", text: l.best.k }), ` returns ${pct(l.best.roi)} (${rate(l.best.win)} win, ${fmtInt(l.best.n)} sales)`),
        h("span", { class: "muted" }, " vs "),
        h("span", {}, h("b", { class: l.worst.roi < 0 ? "neg" : "meh", text: l.worst.k }), ` at ${pct(l.worst.roi)} (${rate(l.worst.win)} win, ${fmtInt(l.worst.n)} sales)`)))) :
      h("p", { class: "muted", text: "Not enough sales in this slice to draw lessons yet." });

    // ---------- go for / be careful ----------
    const combos = (data.combos || []).filter((c) => c.n >= Math.max(12, MIN));
    const comboRow = (c) => h("li", {}, h("b", { text: `${c.tier} · ${c.price} · bought ${c.lead.toLowerCase()} ahead` }),
      h("span", { class: `pill ${c.roi < 0 ? "bad" : c.roi > avg ? "good" : "meh"}`, text: pct(c.roi) }),
      h("span", { class: "muted small", text: ` ${rate(c.win)} win · ${money(c.ppt)}/ticket · ${fmtInt(c.n)} sales` }));
    const goFor = combos.filter((c) => c.roi > avg).sort((a, b) => b.roi - a.roi).slice(0, 6);
    const avoid = combos.filter((c) => c.roi < avg).sort((a, b) => a.roi - b.roi).slice(0, 6);
    const combosEl = combos.length ? h("div", { class: "lc-two" },
      h("div", {}, h("h3", { class: "pos", text: "Go for" }), goFor.length ? h("ul", { class: "lc-combos" }, goFor.map(comboRow)) : h("p", { class: "muted", text: "Nothing beats the average here yet." })),
      h("div", {}, h("h3", { class: "neg", text: "Be careful with" }), avoid.length ? h("ul", { class: "lc-combos" }, avoid.map(comboRow)) : h("p", { class: "muted", text: "Nothing falls below the average here." }))) :
      h("p", { class: "muted", text: "Not enough repeat buys in this slice to compare combinations." });

    // ---------- heat map: section × price ----------
    const mx = data.matrix || [];
    const tiersByN = Object.entries(mx.reduce((m, c) => ((m[c.tier] = (m[c.tier] || 0) + c.n), m), {})).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const prices = PRICES.filter((p) => mx.some((c) => c.price === p));
    const cell = (t, p) => {
      const c = mx.find((x) => x.tier === t && x.price === p);
      if (!c) return h("td", { class: "lc-cell empty" }, "");
      const a = Math.min(Math.abs(c.roi ?? 0) / 0.6, 1) * 0.55 + 0.08, col = (c.roi ?? 0) >= 0 ? `rgba(34,227,154,${a})` : `rgba(255,77,109,${a})`;
      const td = h("td", { class: `lc-cell ${c.n < 5 ? "thin" : ""}`, title: `${t}, ${p}: ${pct(c.roi)} ROI, ${rate(c.win)} win, ${fmtInt(c.n)} sales. Click to focus.` },
        h("b", { text: pct(c.roi) }), h("span", { text: `${fmtInt(c.n)}` }));
      td.style.background = col;
      td.onclick = () => { UI.tier = t; UI.price = p; load(); };
      return td;
    };
    const heat = prices.length ? h("div", { class: "table-wrap" }, h("table", { class: "lc-heat" },
      h("thead", {}, h("tr", {}, h("th", { text: "Section ↓ / Price paid →" }), prices.map((p) => h("th", { class: "r", text: p })))),
      h("tbody", {}, tiersByN.map((t) => h("tr", {}, h("th", { class: "lc-rowhead", text: t }), prices.map((p) => cell(t, p))))))) :
      h("p", { class: "muted", text: "No price data in this slice." });

    // ---------- breakdown tables ----------
    const maxAbs = (rows) => Math.max(0.01, ...rows.map((r) => Math.abs(r.roi || 0)));
    function breakdown(rows, opts = {}) {
      if (!rows?.length) return h("p", { class: "muted", text: "Nothing here for this slice." });
      const list = opts.sortByRoi ? rows.slice().sort((a, b) => (b.n >= MIN) - (a.n >= MIN) || b.roi - a.roi) : rows;
      const m = maxAbs(list.filter((r) => r.n >= MIN));
      return h("div", { class: "table-wrap" }, h("table", { class: "lc-table" },
        h("thead", {}, h("tr", {}, h("th", { text: opts.label || "Group" }), h("th", { class: "r", text: "Sales" }), h("th", { text: "Return" }),
          h("th", { class: "r", text: "Win rate" }), h("th", { class: "r", text: "Profit / ticket" }), h("th", { class: "r", text: "Days to sell" }), h("th", { class: "r", text: "Total profit" }))),
        h("tbody", {}, list.map((r) => {
          const t = tone(r.roi, r.n), w = Math.min(Math.abs(r.roi || 0) / m, 1) * 100;
          const tr = h("tr", { class: `${t === "few" ? "lc-few" : ""} ${opts.filter ? "lc-click" : ""}` },
            h("td", {}, h("b", { text: r.k }), t === "few" ? h("span", { class: "sub", text: "few sales, take with a grain of salt" }) : ""),
            h("td", { class: "r num", text: fmtInt(r.n) }),
            h("td", { class: "lc-bar-cell" }, h("div", { class: "lc-bar" }, h("i", { class: (r.roi || 0) < 0 ? "neg-bar" : t === "good" ? "pos-bar" : t === "meh" ? "meh-bar" : "mid-bar", style: { width: `${w}%` } })),
              h("span", { class: `pill ${t === "few" ? "" : t}`, text: pct(r.roi) })),
            h("td", { class: `r num ${r.win >= 0.8 ? "pos" : r.win < 0.6 ? "neg" : ""}`, text: rate(r.win) }),
            h("td", { class: `r num ${r.ppt >= 0 ? "pos" : "neg"}`, text: money(r.ppt) }),
            h("td", { class: "r num", text: r.dts == null ? "—" : String(Math.round(r.dts)) }),
            h("td", { class: `r num ${r.profit >= 0 ? "pos" : "neg"}`, text: money(r.profit) }));
          if (opts.filter) tr.onclick = () => { UI[opts.filter] = r.k; if (opts.filter === "artist") artistIn.value = r.k; load(); window.scrollTo({ top: 0, behavior: "smooth" }); };
          return tr;
        }))));
    }
    const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");
    const avgNote = `Green means better than the average return of ${pct(avg)}, amber means worse, red means it lost money. Faded rows have too few sales to trust.`;

    out.replaceChildren(
      tiles,
      card("Lessons", lessonEl, "The biggest gaps between the best and worst choice in each area, only counting groups with enough sales to trust."),
      card("Combinations to go for and to be careful with", combosEl, "Section type + price paid + how far ahead, with at least 12 sales each. Use these as a starting point, not a rule."),
      card("Section vs price paid", heat, "Each square is the return for that section type at that price. The number under it is how many sales. Click a square to focus everything on it."),
      h("div", { class: "grid g-2e" },
        card("By section", breakdown(data.tier, { label: "Section", sortByRoi: true, filter: "tier" }), avgNote),
        card("By price paid per ticket", breakdown(data.price, { label: "Price paid", filter: "price" }), avgNote)),
      h("div", { class: "grid g-2e" },
        card("By how far ahead you bought", breakdown(data.lead, { label: "Bought before the show" }), "How long between buying and the show date."),
        card("By row", breakdown(data.row, { label: "Row", sortByRoi: true }), "Letters count as row numbers (A = 1).")),
      h("div", { class: "grid g-2e" },
        card("By tickets per order", breakdown(data.qty, { label: "Order size" })),
        card("By day of the show", breakdown(data.weekday, { label: "Show day" }))),
      card("By city", breakdown(data.city, { label: "City", sortByRoi: true, filter: "city" }), "Your 60 busiest cities, best return first. Click one to focus on it."),
      h("div", { class: "grid g-2e" },
        card("By venue", breakdown(data.venue, { label: "Venue", sortByRoi: true })),
        card("By artist", breakdown(data.artist, { label: "Artist", sortByRoi: true, filter: "artist" }))));
    arrange(out, `learning-${UI.book}`);
  }

  paintFilters();
  await load();
}
