import { h, s, fetchAll, fmtMoney, fmtMoneyShort, fmtInt, fmtPct, fmtDate, monthLabel, signClass, todayISO } from "./common.js";

const COLS = "id,order_number,artist,venue,event_date,section,row_name,quantity,total_sale,total_cost,profit,roi,cost_per,sold_per,purchase_date,sold_date,account,marketplace,created_at";
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

/* ---------- presets ---------- */
function presetRange(p) {
  const t = new Date(), iso = (d) => d.toISOString().slice(0, 10);
  const back = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d); };
  switch (p) {
    case "30d": return [back(30), todayISO()];
    case "90d": return [back(90), todayISO()];
    case "ytd": return [`${t.getFullYear()}-01-01`, todayISO()];
    case "lastyear": return [`${t.getFullYear() - 1}-01-01`, `${t.getFullYear() - 1}-12-31`];
    case "12m": return [back(365), todayISO()];
    default: return ["", ""];
  }
}

export async function renderDashboard(root) {
  const all = await fetchAll("sales", COLS, "sold_date");
  const state = { preset: "all", from: "", to: "", artist: "", venue: "", account: "", tagVisible: false, rankMetric: "profit" };

  if (!all.length) {
    root.replaceChildren(h("div", { class: "card empty" },
      h("h2", { text: "No sales yet" }),
      h("p", { text: "Your sales will show up here once the Discord extension sends them, or once you paste them on the Discord Sales page." }),
      h("a", { class: "btn primary", href: "#discord" }, "Go to Discord Sales")));
    return;
  }

  const uniq = (k) => [...new Set(all.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const dl = (id, vals) => h("datalist", { id }, vals.map((v) => h("option", { value: v })));

  // ----- filter controls -----
  const presetSel = h("select", { id: "f-preset" },
    [["all", "All time"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["ytd", "This year"], ["12m", "Last 12 months"], ["lastyear", "Last year"], ["custom", "Custom range"]]
      .map(([v, t]) => h("option", { value: v, text: t })));
  const fromIn = h("input", { type: "date", id: "f-from" }), toIn = h("input", { type: "date", id: "f-to" });
  const artistIn = h("input", { list: "dl-artist", id: "f-artist", placeholder: "All artists / events", autocomplete: "off" });
  const venueIn = h("input", { list: "dl-venue", id: "f-venue", placeholder: "All venues", autocomplete: "off" });
  const acctSel = h("select", { id: "f-account" }, h("option", { value: "", text: "All accounts" }), uniq("account").map((a) => h("option", { value: a, text: a })));
  const clearBtn = h("button", { class: "ghost", type: "button" }, "Clear filters");

  const filters = h("div", { class: "filters" },
    h("div", { class: "f narrow" }, h("label", { for: "f-preset", text: "Sold date" }), presetSel),
    h("div", { class: "f narrow" }, h("label", { for: "f-from", text: "From" }), fromIn),
    h("div", { class: "f narrow" }, h("label", { for: "f-to", text: "To" }), toIn),
    h("div", { class: "f" }, h("label", { for: "f-artist", text: "Artist / event" }), artistIn, dl("dl-artist", uniq("artist"))),
    h("div", { class: "f" }, h("label", { for: "f-venue", text: "Venue" }), venueIn, dl("dl-venue", uniq("venue"))),
    h("div", { class: "f narrow" }, h("label", { for: "f-account", text: "Buyer account" }), acctSel),
    clearBtn);

  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Sales Dashboard" }), h("div", { class: "sub", text: `${fmtInt(all.length)} sales on record` }))),
    filters, body);

  const filtered = () => all.filter((r) => {
    const d = dayOf(r);
    if (state.from && d < state.from) return false;
    if (state.to && d > state.to) return false;
    if (state.artist && !(r.artist || "").toLowerCase().includes(state.artist.toLowerCase())) return false;
    if (state.venue && !(r.venue || "").toLowerCase().includes(state.venue.toLowerCase())) return false;
    if (state.account && r.account !== state.account) return false;
    return true;
  });

  let ro;
  function draw() {
    const rows = filtered();
    if (ro) ro.disconnect();
    if (!rows.length) { body.replaceChildren(h("div", { class: "card empty" }, h("h2", { text: "No sales match these filters" }))); return; }
    const t = agg(rows);
    const months = groupBy(rows, (r) => dayOf(r).slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));
    const years = groupBy(rows, (r) => dayOf(r).slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key));
    const artists = groupBy(rows, (r) => r.artist);
    const venues = groupBy(rows, (r) => r.venue);
    const accounts = groupBy(rows, (r) => r.account);

    body.replaceChildren(
      kpis(t, rows, months),
      chartCard(months, (o) => (ro = o)),
      h("div", { class: "grid two" },
        rankCard("Artists / events", artists),
        rankCard("Venues", venues)),
      insightsCard(rows, t, months, years, artists, venues, accounts),
      h("div", { class: "grid two" }, roiMonthCard(months), roiYearCard(years, accounts)),
      salesTable(rows));
  }

  // ----- KPI tiles; the "tag" (total profit) is hidden until tapped -----
  function kpis(t, rows, months) {
    const tagVal = h("div", { class: "value num" });
    const eye = h("button", { class: "ghost icon eye", type: "button", "aria-pressed": "false" });
    const paint = () => {
      tagVal.textContent = state.tagVisible ? fmtMoney(t.profit) : "• • • • • •";
      tagVal.className = `value num ${state.tagVisible ? signClass(t.profit) : ""}`;
      eye.textContent = state.tagVisible ? "🙈 Hide" : "👁 Show";
      eye.setAttribute("aria-pressed", String(state.tagVisible));
      eye.setAttribute("aria-label", state.tagVisible ? "Hide total profit" : "Show total profit");
    };
    eye.onclick = () => { state.tagVisible = !state.tagVisible; paint(); };
    paint();
    const avgMonth = months.length ? t.profit / months.length : 0;
    const tile = (label, value, foot, cls = "") => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: `value num ${cls}`, text: value }), foot ? h("div", { class: "foot", text: foot }) : null);
    return h("div", { class: "grid kpis" },
      h("div", { class: "kpi tag" }, h("div", { class: "label" }, "🏷 Total profit (your tag)", eye), tagVal,
        h("div", { class: "foot", text: state.preset === "all" && !state.artist && !state.venue && !state.account ? "Since inception" : "For the current filters" })),
      tile("Revenue", fmtMoney(t.revenue), `${fmtInt(t.n)} sales`),
      tile("Cost", fmtMoney(t.cost), `${fmtInt(t.tickets)} tickets sold`),
      tile("ROI", fmtPct(t.roi), "profit ÷ cost", signClass(t.roi)),
      tile("Avg profit / sale", fmtMoney(t.n ? t.profit / t.n : 0), `${fmtMoney(t.tickets ? t.profit / t.tickets : 0)} per ticket`),
      tile("Win rate", fmtPct(t.n ? (t.wins / t.n) * 100 : null, 0), `${fmtInt(t.losses)} sales at a loss`),
      tile("Avg profit / month", fmtMoney(avgMonth), `${months.length} active months`));
  }

  // ----- monthly grouped bar chart (revenue vs profit) -----
  function chartCard(months, setRO) {
    const wrap = h("div", { class: "chart" });
    const tip = h("div", { class: "tooltip hidden" });
    wrap.append(tip);
    const renderChart = () => {
      [...wrap.querySelectorAll("svg")].forEach((n) => n.remove());
      const W = Math.max(320, wrap.clientWidth), H = 280, m = { t: 12, r: 8, b: 30, l: 56 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const maxV = Math.max(1, ...months.map((d) => Math.max(d.revenue, d.profit)));
      const minV = Math.min(0, ...months.map((d) => d.profit));
      const y = (v) => m.t + ih - ((v - minV) / (maxV - minV)) * ih;
      const band = iw / months.length, bw = Math.max(2, Math.min(22, (band - 6) / 2 - 1));
      const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Monthly revenue and profit" });
      const ticks = 4, step = niceStep((maxV - minV) / ticks);
      const g = s("g", { class: "axis" });
      for (let v = Math.ceil(minV / step) * step; v <= maxV + 0.001; v += step) {
        g.append(s("line", { class: v === 0 ? "zero" : "grid-line", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
        g.append(s("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, fmtMoneyShort(v)));
      }
      if (minV < 0) g.append(s("line", { class: "zero", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
      const every = Math.ceil(months.length / Math.floor(iw / 52));
      months.forEach((d, i) => { if (i % every === 0) g.append(s("text", { x: m.l + band * i + band / 2, y: H - 10, "text-anchor": "middle" }, monthLabel(d.key))); });
      svg.append(g);
      const bar = (x, v, color) => {
        const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
        const r = Math.min(4, bw / 2, hgt);
        // rounded at the data end, square at the baseline
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
        hit.addEventListener("mouseenter", () => grp.setAttribute("opacity", "0.8"));
        hit.addEventListener("mousemove", (e) => showTip(e, d));
        hit.addEventListener("mouseleave", () => { grp.removeAttribute("opacity"); tip.classList.add("hidden"); });
        svg.append(grp, hit);
      });
      wrap.prepend(svg);
    };
    const showTip = (e, d) => {
      const row = (k, v, cls = "") => h("div", { class: "tt-row" }, h("span", { text: k }), h("b", { class: cls, text: v }));
      tip.replaceChildren(h("div", { class: "tt-title", text: monthLabel(d.key, true) }),
        row("Revenue", fmtMoney(d.revenue)), row("Profit", fmtMoney(d.profit), signClass(d.profit)),
        row("ROI", fmtPct(d.roi)), row("Sales", fmtInt(d.n)));
      tip.classList.remove("hidden");
      const b = wrap.getBoundingClientRect();
      let x = e.clientX - b.left + 14; if (x + 180 > b.width) x -= 200;
      tip.style.left = `${x}px`; tip.style.top = `${Math.max(0, e.clientY - b.top - 40)}px`;
    };
    const o = new ResizeObserver(() => renderChart()); o.observe(wrap); setRO(o);
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "Revenue & profit by month" }), h("span", { class: "spacer" }),
        h("div", { class: "legend" }, h("span", {}, h("span", { class: "sw", style: { background: "var(--series-1)" } }), "Revenue"),
          h("span", {}, h("span", { class: "sw", style: { background: "var(--series-2)" } }), "Profit"))),
      wrap);
  }

  // ----- top / bottom ranking -----
  function rankCard(title, groups) {
    const metricKey = { profit: "profit", roi: "roi", sales: "n" };
    const content = h("div", {});
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Rank by" });
    const paint = () => {
      const k = metricKey[state.rankMetric];
      const pool = state.rankMetric === "roi" ? groups.filter((g) => g.n >= 2 && g.roi != null) : groups;
      const sorted = [...pool].sort((a, b) => b[k] - a[k]);
      const top = sorted.slice(0, 5), bottom = sorted.slice(-5).reverse().filter((g) => !top.includes(g));
      const fmt = (g) => (k === "roi" ? fmtPct(g.roi) : k === "n" ? `${fmtInt(g.n)} sales` : fmtMoney(g.profit));
      const maxAbs = Math.max(1, ...pool.map((g) => Math.abs(g[k] || 0)));
      const list = (items) => h("ol", { class: "rank" }, items.map((g, i) => h("li", {},
        h("span", { class: "n", text: i + 1 }),
        h("div", { class: "name" }, h("div", { class: "name", title: g.key, text: g.key }),
          h("div", { class: "meta", text: `${fmtInt(g.n)} sales · ${fmtMoney(g.profit)} profit · ${fmtPct(g.roi)} ROI` }),
          h("div", { class: `bar ${g[k] < 0 ? "neg" : ""}`, style: { width: `${Math.max(2, (Math.abs(g[k] || 0) / maxAbs) * 100)}%` } })),
        h("span", { class: `val ${k === "n" ? "" : signClass(g[k])}`, text: fmt(g) }))));
      content.replaceChildren(...[
        h("h3", { text: "Top 5" }), top.length ? list(top) : h("p", { class: "muted small", text: "Not enough data." }),
        bottom.length ? h("h3", { class: "mt", text: "Bottom 5" }) : null, bottom.length ? list(bottom) : null,
        state.rankMetric === "roi" ? h("p", { class: "muted small mt", text: "ROI ranking only counts items with 2+ sales." }) : null].filter(Boolean));
      [...seg.children].forEach((b) => b.classList.toggle("on", b.dataset.m === state.rankMetric));
    };
    [["profit", "Profit"], ["roi", "ROI"], ["sales", "# Sales"]].forEach(([m, t]) =>
      seg.append(h("button", { type: "button", "data-m": m, text: t, onclick: () => { state.rankMetric = m; draw(); } })));
    paint();
    return h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: title }), h("span", { class: "spacer" }), seg), content);
  }

  // ----- auto insights: where you did right / wrong -----
  function insightsCard(rows, t, months, years, artists, venues, accounts) {
    const out = [];
    const add = (kind, title, text) => out.push({ kind, title, text });
    const byP = (arr) => [...arr].sort((a, b) => b.profit - a.profit);
    if (months.length > 1) {
      const bm = byP(months)[0], wm = byP(months).at(-1);
      add("good", "Best month", `${monthLabel(bm.key, true)}: ${fmtMoney(bm.profit)} profit on ${fmtInt(bm.n)} sales (${fmtPct(bm.roi)} ROI).`);
      add(wm.profit < 0 ? "bad" : "", "Weakest month", `${monthLabel(wm.key, true)}: ${fmtMoney(wm.profit)} profit on ${fmtInt(wm.n)} sales.`);
    }
    if (artists.length) {
      const ba = byP(artists)[0];
      add("good", "Biggest earner", `${ba.key} made you ${fmtMoney(ba.profit)} across ${fmtInt(ba.n)} sales (${fmtPct(ba.roi)} ROI).`);
      const losers = artists.filter((a) => a.profit < 0).sort((a, b) => a.profit - b.profit);
      if (losers.length) add("bad", "Biggest money-loser", `${losers[0].key} lost ${fmtMoney(-losers[0].profit)} over ${fmtInt(losers[0].n)} sales. ${losers.length > 1 ? `${losers.length} artists/events are net negative overall.` : ""}`);
    }
    if (t.losses) add("bad", "Losing sales", `${fmtPct((t.losses / t.n) * 100, 0)} of sales lost money: ${fmtMoney(-t.lossAmt)} total. Without them, profit would be ${fmtMoney(t.profit - t.lossAmt)}.`);
    // timing: how far before the event you sold
    const timed = rows.filter((r) => r.event_date && r.sold_date && r.total_cost > 0);
    if (timed.length >= 5) {
      const buckets = [["30+ days before the event", (d) => d >= 30], ["8–29 days before", (d) => d >= 8 && d < 30], ["Last week (0–7 days)", (d) => d >= 0 && d < 8]];
      const res = buckets.map(([name, f]) => ({ name, ...agg(timed.filter((r) => f(daysBetween(r.sold_date, r.event_date)))) })).filter((b) => b.n >= 2);
      if (res.length >= 2) {
        const best = [...res].sort((a, b) => b.roi - a.roi)[0], worst = [...res].sort((a, b) => a.roi - b.roi)[0];
        add("", "Timing", `Sales ${best.name.toLowerCase()} averaged ${fmtPct(best.roi)} ROI vs ${fmtPct(worst.roi)} when sold ${worst.name.toLowerCase().replace(/^last/, "in the last")}.`);
      }
    }
    const held = rows.filter((r) => r.purchase_date && r.sold_date).map((r) => daysBetween(r.purchase_date, r.sold_date)).filter((d) => d >= 0);
    if (held.length >= 3) add("", "Holding time", `On average you hold tickets ${Math.round(held.reduce((a, b) => a + b, 0) / held.length)} days between buying and selling.`);
    // price sweet spot
    const priced = rows.filter((r) => num(r.cost_per) > 0);
    if (priced.length >= 6) {
      const tiers = [["under $100", 0, 100], ["$100–$249", 100, 250], ["$250–$499", 250, 500], ["$500+", 500, 1e12]];
      const res = tiers.map(([n, lo, hi]) => ({ n2: n, ...agg(priced.filter((r) => num(r.cost_per) >= lo && num(r.cost_per) < hi)) })).filter((x) => x.n >= 2);
      if (res.length >= 2) {
        const b = [...res].sort((a, c) => c.roi - a.roi)[0];
        add("good", "Price sweet spot", `Tickets bought at ${b.n2} each gave your best ROI: ${fmtPct(b.roi)} on ${fmtInt(b.n)} sales.`);
      }
    }
    const goodVenues = venues.filter((v) => v.n >= 3).sort((a, b) => b.roi - a.roi);
    if (goodVenues.length >= 2) {
      add("good", "Best venue (3+ sales)", `${goodVenues[0].key}: ${fmtPct(goodVenues[0].roi)} ROI across ${fmtInt(goodVenues[0].n)} sales.`);
      const wv = goodVenues.at(-1); if (wv.roi < 10) add("bad", "Weakest venue (3+ sales)", `${wv.key}: ${fmtPct(wv.roi)} ROI across ${fmtInt(wv.n)} sales.`);
    }
    if (accounts.length > 1) { const a = byP(accounts)[0]; add("", "Top buyer account", `${a.key} produced ${fmtMoney(a.profit)} profit (${fmtPct(a.roi)} ROI).`); }
    if (years.length > 1) {
      const [cur, prev] = years; const ch = prev.profit ? ((cur.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;
      add(ch >= 0 ? "good" : "bad", `${cur.key} vs ${prev.key}`, `${fmtMoney(cur.profit)} vs ${fmtMoney(prev.profit)} profit${ch != null ? ` (${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%)` : ""}.${new Date().getFullYear() == cur.key ? " This year isn't finished yet." : ""}`);
    }
    return h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "What's working, what isn't" })),
      out.length ? h("div", { class: "insights" }, out.map((i) => h("div", { class: `insight ${i.kind}` }, h("div", { class: "t", text: i.title }), h("div", { class: "b", text: i.text }))))
        : h("p", { class: "muted", text: "Insights appear once there are a few more sales." }));
  }

  function roiMonthCard(months) {
    return h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "ROI by month" })),
      miniTable(["Month", "Sales", "Revenue", "Profit", "ROI"], [...months].reverse().map((m) => [monthLabel(m.key, true), fmtInt(m.n), fmtMoney(m.revenue), [fmtMoney(m.profit), signClass(m.profit)], [fmtPct(m.roi), signClass(m.roi)]])));
  }
  function roiYearCard(years, accounts) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "ROI by year" })),
      miniTable(["Year", "Sales", "Revenue", "Profit", "ROI"], years.map((y) => [y.key, fmtInt(y.n), fmtMoney(y.revenue), [fmtMoney(y.profit), signClass(y.profit)], [fmtPct(y.roi), signClass(y.roi)]])),
      accounts.length ? h("div", { class: "card-head mt" }, h("h2", { text: "By buyer account" })) : null,
      accounts.length ? miniTable(["Account", "Sales", "Profit", "ROI"], [...accounts].sort((a, b) => b.profit - a.profit).map((a) => [a.key, fmtInt(a.n), [fmtMoney(a.profit), signClass(a.profit)], [fmtPct(a.roi), signClass(a.roi)]])) : null);
  }
  function miniTable(heads, rows) {
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, heads.map((t, i) => h("th", { class: i ? "r" : "", text: t })))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => { const [v, cls] = Array.isArray(c) ? c : [c, ""]; return h("td", { class: `${i ? "r num" : ""} ${cls}`, text: v }); }))))));
  }

  // ----- the sales table (same columns as your ticket sales sheet) -----
  function salesTable(rows) {
    const cols = [
      ["artist", "Artist", "t"], ["event_date", "Date", "d"], ["venue", "Venue", "t"], ["quantity", "Tickets", "n"],
      ["total_sale", "Total", "m"], ["profit", "Profit", "m"], ["roi", "ROI", "p"], ["cost_per", "Cost Per", "m"],
      ["sold_per", "Sold Per", "m"], ["sold_date", "Sold", "d"], ["account", "Account", "t"]];
    let sortKey = "sold_date", dir = -1, page = 0, q = "";
    const per = 50;
    const tbody = h("tbody"), thead = h("thead"), pager = h("div", { class: "pager" });
    const search = h("input", { type: "search", placeholder: "Search sales…", class: "grow", "aria-label": "Search sales" });
    search.oninput = () => { q = search.value.toLowerCase(); page = 0; paint(); };
    const exportBtn = h("button", { type: "button" }, "⬇ Export CSV");
    exportBtn.onclick = () => exportCsv(cols, current());
    const current = () => {
      const list = q ? rows.filter((r) => [r.artist, r.venue, r.account, r.order_number, r.section].some((v) => (v || "").toLowerCase().includes(q))) : rows;
      return [...list].sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        const numeric = ["m", "p", "n"].includes(cols.find((c) => c[0] === sortKey)[2]);
        return (numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * dir;
      });
    };
    const cell = (r, [k, , t]) => {
      const v = r[k];
      if (t === "m") return h("td", { class: `r num ${k === "profit" ? signClass(Number(v)) : ""}`, text: fmtMoney(v == null ? null : Number(v), true) });
      if (t === "p") return h("td", { class: `r num ${signClass(Number(v))}`, text: fmtPct(v == null ? null : Number(v)) });
      if (t === "n") return h("td", { class: "r num", text: v ?? "—" });
      if (t === "d") return h("td", { class: "num", text: fmtDate(v) });
      return h("td", { text: v || "—", title: v || "" });
    };
    function paint() {
      thead.replaceChildren(h("tr", {}, cols.map(([k, label, t]) => {
        const th = h("th", { class: ["m", "p", "n"].includes(t) ? "r" : "", scope: "col", tabindex: "0" }, label, sortKey === k ? h("span", { class: "arrow", text: dir > 0 ? " ▲" : " ▼" }) : null);
        const go = () => { if (sortKey === k) dir = -dir; else { sortKey = k; dir = t === "t" ? 1 : -1; } paint(); };
        th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter") go(); };
        return th;
      })));
      const list = current(), pages = Math.max(1, Math.ceil(list.length / per));
      page = Math.min(page, pages - 1);
      tbody.replaceChildren(...list.slice(page * per, page * per + per).map((r) => h("tr", {}, cols.map((c) => cell(r, c)))));
      pager.replaceChildren(h("span", { text: `${fmtInt(list.length)} sales · page ${page + 1} of ${pages}` }),
        h("button", { class: "icon", disabled: page === 0, onclick: () => { page--; paint(); } }, "‹ Prev"),
        h("button", { class: "icon", disabled: page >= pages - 1, onclick: () => { page++; paint(); } }, "Next ›"));
    }
    paint();
    return h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "All sales" }), h("span", { class: "spacer" }), search, exportBtn),
      h("div", { class: "table-wrap" }, h("table", {}, thead, tbody)), pager);
  }

  // ----- wire filters -----
  const sync = () => {
    if (state.preset !== "custom") { [state.from, state.to] = presetRange(state.preset); fromIn.value = state.from; toIn.value = state.to; }
    draw();
  };
  presetSel.onchange = () => { state.preset = presetSel.value; sync(); };
  fromIn.onchange = () => { state.preset = "custom"; presetSel.value = "custom"; state.from = fromIn.value; draw(); };
  toIn.onchange = () => { state.preset = "custom"; presetSel.value = "custom"; state.to = toIn.value; draw(); };
  artistIn.onchange = () => { state.artist = artistIn.value.trim(); draw(); };
  venueIn.onchange = () => { state.venue = venueIn.value.trim(); draw(); };
  acctSel.onchange = () => { state.account = acctSel.value; draw(); };
  clearBtn.onclick = () => { Object.assign(state, { preset: "all", from: "", to: "", artist: "", venue: "", account: "" }); presetSel.value = "all"; fromIn.value = toIn.value = artistIn.value = venueIn.value = acctSel.value = ""; draw(); };
  draw();
  return () => ro && ro.disconnect();
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function exportCsv(cols, rows, name = "sales") {
  const esc = (v) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  // guard against spreadsheet formula injection
  const safe = (v) => (typeof v === "string" && isNaN(Number(v)) && /^[=+\-@]/.test(v) ? `'${v}` : v);
  const csv = [cols.map((c) => c[1]).join(","), ...rows.map((r) => cols.map(([k]) => esc(safe(r[k]))).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
