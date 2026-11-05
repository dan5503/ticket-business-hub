import { h, s, fetchAll, fmtMoney, fmtMoneyShort, fmtInt, fmtPct, fmtDate, fmtDateTime, monthLabel, signClass, todayISO } from "./common.js";
import { makeBoard } from "./layout.js";

const COLS = "id,order_number,artist,venue,event_date,section,row_name,quantity,total_sale,total_cost,profit,roi,cost_per,sold_per,purchase_date,sold_date,sold_at,account,marketplace,created_at";
const num = (v) => (v == null || v === "" ? 0 : Number(v));
const dayOf = (r) => r.sold_date || (r.created_at || "").slice(0, 10);
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

/* ---------- aggregation ---------- */
function agg(rows) {
  const a = { n: rows.length, revenue: 0, cost: 0, profit: 0, tickets: 0, wins: 0, losses: 0, lossAmt: 0 };
  for (const r of rows) {
    a.revenue += num(r.total_sale); a.cost += num(r.total_cost); a.profit += num(r.profit); a.tickets += num(r.quantity);
    if (num(r.profit) > 0) a.wins++;
    if (num(r.profit) < 0) { a.losses++; a.lossAmt += num(r.profit); }
  }
  a.roi = a.cost > 0 ? (a.profit / a.cost) * 100 : null;
  return a;
}
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null || k === "") continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m].map(([key, rs]) => ({ key, ...agg(rs) }));
}

const PERIODS = [["all", "All time"], ["ytd", "This year"], ["12m", "Last 12 months"], ["90d", "Last 90 days"], ["30d", "Last 30 days"]];
function presetRange(p) {
  const t = new Date(), iso = (d) => d.toISOString().slice(0, 10);
  const back = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d); };
  switch (p) {
    case "30d": return [back(30), todayISO()];
    case "90d": return [back(90), todayISO()];
    case "ytd": return [`${t.getFullYear()}-01-01`, todayISO()];
    case "12m": return [back(365), todayISO()];
    default: return ["", ""];
  }
}

export async function renderDashboard(root) {
  const all = await fetchAll("sales", COLS, "sold_date");
  let tSort = "sold_at", tDir = -1, tPage = 0, tQ = "";
  const state = { preset: "all", from: "", to: "", artist: "", venue: "", account: "", tagVisible: false, rankBy: "artist", rankMetric: "profit" };

  if (!all.length) {
    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Sales" }))),
      h("div", { class: "card empty" },
        h("h2", { text: "No sales yet" }),
        h("p", { text: "Open #danielbehnam-sales in Chrome, click the ALLPWST Discord Data extension and choose “Sync All History”. Your sales will appear here." }),
        h("a", { class: "btn primary", href: "#discord" }, "Go to Discord")));
    return;
  }

  const uniq = (k) => [...new Set(all.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const dl = (id, vals) => h("datalist", { id }, vals.map((v) => h("option", { value: v })));

  // ---------- filters ----------
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Time period" });
  const paintChips = () => [...chips.children].forEach((b) => b.classList.toggle("on", b.dataset.p === state.preset));
  PERIODS.forEach(([v, t]) => chips.append(h("button", { type: "button", "data-p": v, text: t, onclick: () => { state.preset = v; [state.from, state.to] = presetRange(v); fromIn.value = state.from; toIn.value = state.to; paintChips(); refresh(); } })));
  const fromIn = h("input", { type: "date", id: "f-from" }), toIn = h("input", { type: "date", id: "f-to" });
  const artistIn = h("input", { list: "dl-artist", id: "f-artist", placeholder: "Any artist or event", autocomplete: "off" });
  const venueIn = h("input", { list: "dl-venue", id: "f-venue", placeholder: "Any venue", autocomplete: "off" });
  const acctSel = h("select", { id: "f-account" }, h("option", { value: "", text: "Any account" }), uniq("account").map((a) => h("option", { value: a, text: a })));
  const more = h("div", { class: "more-filters hidden" },
    h("div", {}, h("label", { for: "f-from", text: "Sold from" }), fromIn),
    h("div", {}, h("label", { for: "f-to", text: "Sold until" }), toIn),
    h("div", {}, h("label", { for: "f-artist", text: "Artist or event" }), artistIn, dl("dl-artist", uniq("artist"))),
    h("div", {}, h("label", { for: "f-venue", text: "Venue" }), venueIn, dl("dl-venue", uniq("venue"))),
    h("div", {}, h("label", { for: "f-account", text: "Buyer account" }), acctSel));
  const activeNote = h("span", { class: "active-filters" });
  const moreBtn = h("button", { type: "button", onclick: () => more.classList.toggle("hidden") }, "Filters");
  const clearBtn = h("button", { type: "button", class: "ghost hidden", onclick: () => {
    Object.assign(state, { preset: "all", from: "", to: "", artist: "", venue: "", account: "" });
    fromIn.value = toIn.value = artistIn.value = venueIn.value = acctSel.value = ""; paintChips(); refresh();
  } }, "Clear filters");
  paintChips();

  const filtered = () => all.filter((r) => {
    const d = dayOf(r);
    if (state.from && d < state.from) return false;
    if (state.to && d > state.to) return false;
    if (state.artist && !(r.artist || "").toLowerCase().includes(state.artist.toLowerCase())) return false;
    if (state.venue && !(r.venue || "").toLowerCase().includes(state.venue.toLowerCase())) return false;
    if (state.account && r.account !== state.account) return false;
    return true;
  });

  // ---------- data for the current filters ----------
  let D;
  function compute() {
    const rows = filtered();
    D = {
      rows, t: agg(rows),
      months: groupBy(rows, (r) => dayOf(r).slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
      years: groupBy(rows, (r) => dayOf(r).slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key)),
      artists: groupBy(rows, (r) => r.artist), venues: groupBy(rows, (r) => r.venue), accounts: groupBy(rows, (r) => r.account),
    };
    const extra = [state.artist, state.venue, state.account].filter(Boolean).length + (state.preset === "custom" ? 1 : 0);
    activeNote.textContent = extra ? `${extra} filter${extra > 1 ? "s" : ""} on, showing ${fmtInt(rows.length)} of ${fmtInt(all.length)} sales` : "";
    clearBtn.classList.toggle("hidden", !extra && state.preset === "all");
  }
  const noRows = () => h("p", { class: "muted", text: "No sales match these filters." });

  // ---------- sections ----------
  let ro;
  const sections = {
    overview: { title: "Overview", bare: true, render: () => overview() },
    monthly: { title: "Revenue and profit by month", hint: "Hover a month to see its numbers.", render: () => (D.rows.length ? chart() : noRows()),
      actions: () => h("div", { class: "legend" }, h("span", {}, h("span", { class: "sw", style: { background: "var(--series-1)" } }), "Revenue"), h("span", {}, h("span", { class: "sw", style: { background: "var(--series-2)" } }), "Profit")) },
    rank: { title: "Best and worst", hint: "Your top 5 and bottom 5. Switch between artists and venues, and choose what to rank by.", render: () => (D.rows.length ? ranking() : noRows()), actions: () => rankControls() },
    sales: { title: "All sales", render: () => (D.rows.length ? salesTable() : noRows()) },
    insights: { title: "What's working, what isn't", hint: "Patterns in your sales, worked out automatically.", render: () => insights() },
    roi_month: { title: "ROI by month", collapsed: true, render: () => roiMonth() },
    roi_year: { title: "ROI by year", collapsed: true, render: () => roiYear() },
    accounts: { title: "By buyer account", collapsed: true, render: () => byAccount() },
  };
  compute();
  const board = await makeBoard("dashboard", ["overview", "monthly", "rank", "sales", "insights", "roi_month", "roi_year", "accounts"], sections);
  function refresh() { if (ro) ro.disconnect(); compute(); board.rerender(); }

  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Sales" }), h("p", { class: "sub", text: `${fmtInt(all.length)} sales since you started. Click a section's title to open or close it. Drag the dots next to a title, or use the arrows, to rearrange.` })),
      h("span", { class: "spacer" }),
      h("button", { type: "button", onclick: () => board.open("sales") }, "Jump to sales"),
      h("button", { type: "button", class: "ghost", onclick: () => board.reset() }, "Reset layout")),
    h("div", { class: "toolbar" }, chips, moreBtn, clearBtn, activeNote),
    more, board.el);

  // ---------- Overview: the ticket stub + 4 numbers ----------
  function overview() {
    const t = D.t;
    const val = h("div", { class: "value" });
    const eye = h("button", { type: "button", class: "eye" });
    const paint = () => {
      val.textContent = state.tagVisible ? fmtMoney(t.profit) : "••••••";
      val.className = `value ${state.tagVisible ? (t.profit < 0 ? "neg" : "") : "masked"}`;
      eye.textContent = state.tagVisible ? "Hide" : "Show";
      eye.setAttribute("aria-pressed", String(state.tagVisible));
      eye.setAttribute("aria-label", state.tagVisible ? "Hide total profit" : "Show total profit");
    };
    eye.onclick = () => { state.tagVisible = !state.tagVisible; paint(); };
    paint();
    const scope = state.preset === "all" && !state.artist && !state.venue && !state.account ? "Since you started" : "For the current filters";
    const stat = (label, value, foot, cls = "") => h("div", { class: "stat" }, h("div", { class: "label", text: label }), h("div", { class: `value ${cls}`, text: value }), h("div", { class: "foot", text: foot }));
    return h("div", { class: "headline" },
      h("div", { class: "stub" },
        h("div", { class: "main" }, h("div", { class: "label" }, "Your tag (total profit)", eye), val, h("div", { class: "note", text: scope })),
        h("div", { class: "tear" }, h("div", { class: "t", text: "ROI" }), h("div", { class: "v", text: fmtPct(t.roi) }), h("div", { class: "t mt", text: "Sales" }), h("div", { class: "v", text: fmtInt(t.n) }))),
      stat("Revenue", fmtMoney(t.revenue), `${fmtMoney(t.cost)} spent on tickets`),
      stat("Return on investment", fmtPct(t.roi), "Profit for every $100 spent", signClass(t.roi)),
      stat("Tickets sold", fmtInt(t.tickets), `${fmtMoney(t.tickets ? t.profit / t.tickets : 0)} profit per ticket`),
      stat("Win rate", fmtPct(t.n ? (t.wins / t.n) * 100 : null, 0), t.losses ? `${fmtInt(t.losses)} sales lost money` : "No losing sales"));
  }

  // ---------- chart ----------
  function chart() {
    const months = D.months;
    const wrap = h("div", { class: "chart" });
    const tip = h("div", { class: "tooltip hidden" });
    wrap.append(tip);
    const draw = () => {
      [...wrap.querySelectorAll("svg")].forEach((n) => n.remove());
      const W = Math.max(320, wrap.clientWidth), H = 220, m = { t: 12, r: 8, b: 30, l: 56 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const maxV = Math.max(1, ...months.map((d) => Math.max(d.revenue, d.profit)));
      const minV = Math.min(0, ...months.map((d) => d.profit));
      const y = (v) => m.t + ih - ((v - minV) / (maxV - minV)) * ih;
      const band = iw / months.length, bw = Math.max(2, Math.min(22, (band - 6) / 2 - 1));
      const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Monthly revenue and profit" });
      const step = niceStep((maxV - minV) / 4);
      const g = s("g", { class: "axis" });
      for (let v = Math.ceil(minV / step) * step; v <= maxV + 0.001; v += step) {
        g.append(s("line", { class: Math.abs(v) < 1e-9 ? "zero" : "grid-line", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
        g.append(s("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, fmtMoneyShort(v)));
      }
      const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(iw / 56))));
      months.forEach((d, i) => { if (i % every === 0) g.append(s("text", { x: m.l + band * i + band / 2, y: H - 10, "text-anchor": "middle" }, monthLabel(d.key))); });
      svg.append(g);
      const bar = (x, v, color) => {
        const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
        const r = Math.min(4, bw / 2, hgt);
        const p = v >= 0
          ? `M${x},${top + hgt} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + hgt} Z`
          : `M${x},${top} V${top + hgt - r} Q${x},${top + hgt} ${x + r},${top + hgt} H${x + bw - r} Q${x + bw},${top + hgt} ${x + bw},${top + hgt - r} V${top} Z`;
        return s("path", { d: p, fill: color });
      };
      months.forEach((d, i) => {
        const cx = m.l + band * i + band / 2;
        const grp = s("g", {});
        grp.append(bar(cx - bw - 1, d.revenue, "var(--series-1)"), bar(cx + 1, d.profit, d.profit < 0 ? "var(--bad)" : "var(--series-2)"));
        const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" });
        hit.addEventListener("mouseenter", () => grp.setAttribute("opacity", "0.75"));
        hit.addEventListener("mousemove", (e) => showTip(e, d));
        hit.addEventListener("mouseleave", () => { grp.removeAttribute("opacity"); tip.classList.add("hidden"); });
        svg.append(grp, hit);
      });
      wrap.prepend(svg);
    };
    const showTip = (e, d) => {
      const row = (k, v, cls = "") => h("div", { class: "tt-row" }, h("span", { text: k }), h("b", { class: cls, text: v }));
      tip.replaceChildren(h("div", { class: "tt-title", text: monthLabel(d.key, true) }),
        row("Revenue", fmtMoney(d.revenue)), row("Profit", fmtMoney(d.profit), signClass(d.profit)), row("ROI", fmtPct(d.roi)), row("Sales", fmtInt(d.n)));
      tip.classList.remove("hidden");
      const b = wrap.getBoundingClientRect();
      let x = e.clientX - b.left + 14; if (x + 190 > b.width) x -= 210;
      tip.style.left = `${x}px`; tip.style.top = `${Math.max(0, e.clientY - b.top - 40)}px`;
    };
    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => draw()); ro.observe(wrap);
    return wrap;
  }

  // ---------- best & worst ----------
  function rankControls() {
    const seg = (opts, key) => {
      const g = h("div", { class: "chips", role: "group" });
      opts.forEach(([v, t]) => g.append(h("button", { type: "button", class: state[key] === v ? "on" : "", text: t, onclick: () => { state[key] = v; board.rerender("rank"); } })));
      return g;
    };
    return h("div", { class: "row" }, seg([["artist", "Artists"], ["venue", "Venues"]], "rankBy"), seg([["profit", "Profit"], ["roi", "ROI"], ["n", "Number of sales"]], "rankMetric"));
  }
  function ranking() {
    const groups = state.rankBy === "artist" ? D.artists : D.venues;
    const k = state.rankMetric;
    const pool = k === "roi" ? groups.filter((g) => g.n >= 2 && g.roi != null) : groups;
    const sorted = [...pool].sort((a, b) => (b[k] ?? -1e9) - (a[k] ?? -1e9));
    const top = sorted.slice(0, 5), bottom = sorted.slice(-5).reverse().filter((g) => !top.includes(g));
    const fmt = (g) => (k === "roi" ? fmtPct(g.roi) : k === "n" ? `${fmtInt(g.n)} sales` : fmtMoney(g.profit));
    const maxAbs = Math.max(1, ...pool.map((g) => Math.abs(g[k] || 0)));
    const list = (items) => h("ol", { class: "rank" }, items.map((g) => h("li", {},
      h("div", { class: "name", title: g.key, text: g.key }),
      h("span", { class: `val ${k === "n" ? "" : signClass(g[k])}`, text: fmt(g) }),
      h("div", { class: "meta", text: `${fmtInt(g.n)} sales, ${fmtMoney(g.profit)} profit, ${fmtPct(g.roi)} ROI` }),
      h("div", { class: "bar" }, h("i", { class: g[k] < 0 ? "neg" : "", style: { width: `${Math.max(2, (Math.abs(g[k] || 0) / maxAbs) * 100)}%` } })))));
    return h("div", {},
      h("div", { class: "split" },
        h("div", {}, h("h3", { text: "Top 5" }), top.length ? list(top) : h("p", { class: "muted small", text: "Not enough sales yet." })),
        h("div", {}, h("h3", { text: "Bottom 5" }), bottom.length ? list(bottom) : h("p", { class: "muted small", text: "Not enough different ones to compare yet." }))),
      k === "roi" ? h("p", { class: "muted small mt", text: "ROI ranking only includes those with 2 or more sales." }) : "");
  }

  // ---------- insights ----------
  function insights() {
    const { rows, t, months, years, artists, venues, accounts } = D;
    const out = [];
    const add = (kind, title, text) => out.push({ kind, title, text });
    const byP = (arr) => [...arr].sort((a, b) => b.profit - a.profit);
    if (months.length > 1) {
      const bm = byP(months)[0], wm = byP(months).at(-1);
      add("good", "Best month", `${monthLabel(bm.key, true)} made ${fmtMoney(bm.profit)} on ${fmtInt(bm.n)} sales (${fmtPct(bm.roi)} ROI).`);
      add(wm.profit < 0 ? "bad" : "", "Weakest month", `${monthLabel(wm.key, true)} made ${fmtMoney(wm.profit)} on ${fmtInt(wm.n)} sales.`);
    }
    if (artists.length) {
      const ba = byP(artists)[0];
      add("good", "Biggest earner", `${ba.key} made you ${fmtMoney(ba.profit)} across ${fmtInt(ba.n)} sales (${fmtPct(ba.roi)} ROI).`);
      const losers = artists.filter((a) => a.profit < 0).sort((a, b) => a.profit - b.profit);
      if (losers.length) add("bad", "Biggest money-loser", `${losers[0].key} lost ${fmtMoney(-losers[0].profit)} over ${fmtInt(losers[0].n)} sales.${losers.length > 1 ? ` ${losers.length} artists or events lost money overall.` : ""}`);
    }
    if (t.losses) add("bad", "Losing sales", `${fmtPct((t.losses / t.n) * 100, 0)} of sales lost money, ${fmtMoney(-t.lossAmt)} in total. Without them, profit would be ${fmtMoney(t.profit - t.lossAmt)}.`);
    const timed = rows.filter((r) => r.event_date && r.sold_date && num(r.total_cost) > 0);
    if (timed.length >= 5) {
      const buckets = [["30+ days before the show", (d) => d >= 30], ["8 to 29 days before", (d) => d >= 8 && d < 30], ["in the final week", (d) => d >= 0 && d < 8]];
      const res = buckets.map(([name, f]) => ({ name, ...agg(timed.filter((r) => f(daysBetween(r.sold_date, r.event_date)))) })).filter((b) => b.n >= 2);
      if (res.length >= 2) {
        const best = [...res].sort((a, b) => b.roi - a.roi)[0], worst = [...res].sort((a, b) => a.roi - b.roi)[0];
        add("", "When to sell", `Selling ${best.name} averaged ${fmtPct(best.roi)} ROI, compared with ${fmtPct(worst.roi)} when selling ${worst.name}.`);
      }
    }
    const held = rows.filter((r) => r.purchase_date && r.sold_date).map((r) => daysBetween(r.purchase_date, r.sold_date)).filter((d) => d >= 0);
    if (held.length >= 3) add("", "How long you hold", `On average you sell tickets ${Math.round(held.reduce((a, b) => a + b, 0) / held.length)} days after buying them.`);
    const priced = rows.filter((r) => num(r.cost_per) > 0);
    if (priced.length >= 6) {
      const tiers = [["under $100", 0, 100], ["$100 to $249", 100, 250], ["$250 to $499", 250, 500], ["$500 or more", 500, 1e12]];
      const res = tiers.map(([n, lo, hi]) => ({ label: n, ...agg(priced.filter((r) => num(r.cost_per) >= lo && num(r.cost_per) < hi)) })).filter((x) => x.n >= 2);
      if (res.length >= 2) { const b = [...res].sort((a, c) => c.roi - a.roi)[0]; add("good", "Price sweet spot", `Tickets that cost ${b.label} each gave your best ROI: ${fmtPct(b.roi)} on ${fmtInt(b.n)} sales.`); }
    }
    const vv = venues.filter((v) => v.n >= 3).sort((a, b) => b.roi - a.roi);
    if (vv.length >= 2) {
      add("good", "Best venue", `${vv[0].key}: ${fmtPct(vv[0].roi)} ROI over ${fmtInt(vv[0].n)} sales.`);
      const wv = vv.at(-1); if (wv.roi < 10) add("bad", "Weakest venue", `${wv.key}: ${fmtPct(wv.roi)} ROI over ${fmtInt(wv.n)} sales.`);
    }
    if (accounts.length > 1) { const a = byP(accounts)[0]; add("", "Top buyer account", `${a.key} produced ${fmtMoney(a.profit)} profit (${fmtPct(a.roi)} ROI).`); }
    if (years.length > 1) {
      const [cur, prev] = years; const ch = prev.profit ? ((cur.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;
      add(ch >= 0 ? "good" : "bad", `${cur.key} compared with ${prev.key}`, `${fmtMoney(cur.profit)} profit versus ${fmtMoney(prev.profit)}${ch != null ? ` (${ch >= 0 ? "up" : "down"} ${Math.abs(ch).toFixed(0)}%)` : ""}.${String(new Date().getFullYear()) === cur.key ? " This year isn't over yet." : ""}`);
    }
    if (!out.length) return h("p", { class: "muted", text: "These appear once you have a few more sales." });
    const icon = { good: "✓", bad: "!", "": "i" };
    return h("div", { class: "insights" }, out.map((i) => h("div", { class: `insight ${i.kind}` }, h("span", { class: "ic", "aria-hidden": "true", text: icon[i.kind] }), h("div", { class: "t", text: i.title }), h("div", { class: "b", text: i.text }))));
  }

  // ---------- ROI tables ----------
  const roiRows = (list) => list.map((m) => [m.label, fmtInt(m.n), fmtMoney(m.revenue), [fmtMoney(m.profit), signClass(m.profit)], [fmtPct(m.roi), signClass(m.roi)]]);
  function roiMonth() {
    if (!D.months.length) return noRows();
    return miniTable(["Month", "Sales", "Revenue", "Profit", "ROI"], roiRows([...D.months].reverse().map((m) => ({ ...m, label: monthLabel(m.key, true) }))));
  }
  function roiYear() {
    if (!D.years.length) return noRows();
    return miniTable(["Year", "Sales", "Revenue", "Profit", "ROI"], roiRows(D.years.map((y) => ({ ...y, label: y.key }))));
  }
  function byAccount() {
    if (!D.accounts.length) return h("p", { class: "muted", text: "No buyer accounts recorded yet." });
    return miniTable(["Account", "Sales", "Revenue", "Profit", "ROI"], roiRows([...D.accounts].sort((a, b) => b.profit - a.profit).map((a) => ({ ...a, label: a.key }))));
  }
  function miniTable(heads, rows) {
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, heads.map((t, i) => h("th", { class: i ? "r" : "", text: t })))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => { const [v, cls] = Array.isArray(c) ? c : [c, ""]; return h("td", { class: `${i ? "r num" : "strong"} ${cls}`, text: v }); }))))));
  }

  // ---------- the sales table ----------
  function salesTable() {
    const cols = [
      ["artist", "Artist", "t"], ["event_date", "Show date", "d"], ["venue", "Venue", "t"], ["quantity", "Tickets", "n"],
      ["total_sale", "Total", "m"], ["profit", "Profit", "m"], ["roi", "ROI", "p"], ["cost_per", "Cost per", "m"],
      ["sold_per", "Sold per", "m"], ["sold_at", "Sold at", "dt"], ["marketplace", "Sold on", "t"], ["account", "Account", "t"]];
    const per = 25;
    const rows = D.rows;
    const tbody = h("tbody"), thead = h("thead"), pager = h("div", { class: "pager" });
    const search = h("input", { type: "search", placeholder: "Search by artist, venue, account or order #", "aria-label": "Search sales", value: tQ });
    search.oninput = () => { tQ = search.value.toLowerCase(); tPage = 0; paint(); };
    const current = () => {
      const list = tQ ? rows.filter((r) => [r.artist, r.venue, r.account, r.order_number, r.section, r.marketplace].some((v) => (v || "").toLowerCase().includes(tQ))) : rows;
      const numeric = ["m", "p", "n"].includes(cols.find((c) => c[0] === tSort)[2]);
      const val = (r) => (tSort === "sold_at" ? r.sold_at || (r.sold_date ? r.sold_date + "T12:00:00" : null) || r.created_at : r[tSort]);
      return [...list].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * tDir;
      });
    };
    const cell = (r, [k, , t]) => {
      const v = r[k];
      if (t === "m") return h("td", { class: `r num ${k === "profit" ? signClass(Number(v)) : ""}`, text: fmtMoney(v == null ? null : Number(v), true) });
      if (t === "p") return h("td", { class: `r num ${signClass(Number(v))}`, text: fmtPct(v == null ? null : Number(v)) });
      if (t === "n") return h("td", { class: "r num", text: v ?? "—" });
      if (t === "d") return h("td", { class: "num", text: fmtDate(v) });
      if (t === "dt") return h("td", { class: "num", text: fmtDateTime(r.sold_at, r.sold_date) });
      return h("td", { class: k === "artist" ? "strong" : "", text: v || "—", title: v || "" });
    };
    function paint() {
      thead.replaceChildren(h("tr", {}, cols.map(([k, label, t]) => {
        const th = h("th", { class: ["m", "p", "n"].includes(t) ? "r" : "", scope: "col", tabindex: "0", "aria-sort": tSort === k ? (tDir > 0 ? "ascending" : "descending") : "none" },
          label, tSort === k ? h("span", { class: "arrow", text: tDir > 0 ? " ▲" : " ▼" }) : null);
        const go = () => { if (tSort === k) tDir = -tDir; else { tSort = k; tDir = t === "t" ? 1 : -1; } paint(); };
        th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter") go(); };
        return th;
      })));
      const list = current(), pages = Math.max(1, Math.ceil(list.length / per));
      tPage = Math.min(tPage, pages - 1);
      tbody.replaceChildren(...list.slice(tPage * per, tPage * per + per).map((r) => h("tr", {}, cols.map((c) => cell(r, c)))));
      pager.replaceChildren(h("span", { text: `${fmtInt(list.length)} sales, page ${tPage + 1} of ${pages}` }),
        h("button", { class: "icon", disabled: tPage === 0, onclick: () => { tPage--; paint(); } }, "Previous"),
        h("button", { class: "icon", disabled: tPage >= pages - 1, onclick: () => { tPage++; paint(); } }, "Next"));
    }
    paint();
    return h("div", {},
      h("div", { class: "row" }, h("div", { class: "grow" }, search), h("button", { type: "button", onclick: () => exportCsv(cols, current()) }, "Download CSV")),
      h("div", { class: "table-wrap mt" }, h("table", {}, thead, tbody)), pager);
  }

  // ---------- filter wiring ----------
  const setCustom = () => { state.preset = "custom"; paintChips(); };
  fromIn.onchange = () => { setCustom(); state.from = fromIn.value; refresh(); };
  toIn.onchange = () => { setCustom(); state.to = toIn.value; refresh(); };
  artistIn.onchange = () => { state.artist = artistIn.value.trim(); refresh(); };
  venueIn.onchange = () => { state.venue = venueIn.value.trim(); refresh(); };
  acctSel.onchange = () => { state.account = acctSel.value; refresh(); };

  return () => ro && ro.disconnect();
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function exportCsv(cols, rows, name = "sales") {
  const esc = (v) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const safe = (v) => (typeof v === "string" && isNaN(Number(v)) && /^[=+\-@]/.test(v) ? `'${v}` : v);
  const csv = [cols.map((c) => c[1]).join(","), ...rows.map((r) => cols.map(([k]) => esc(safe(r[k]))).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
