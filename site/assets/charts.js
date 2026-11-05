// Tiny SVG chart kit: bar charts (grouped, with optional running-total line) and line charts.
import { h, s, fmtMoneyShort } from "./common.js";

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function frame(height) {
  const wrap = h("div", { class: "chart" });
  const tip = h("div", { class: "tooltip hidden" });
  wrap.append(tip);
  const showTip = (e, title, rows) => {
    tip.replaceChildren(h("div", { class: "tt-title", text: title }),
      ...rows.map(([k, v, cls]) => h("div", { class: "tt-row" }, h("span", { text: k }), h("b", { class: cls || "", text: v }))));
    tip.classList.remove("hidden");
    const b = wrap.getBoundingClientRect();
    let x = e.clientX - b.left + 14; if (x + 180 > b.width) x -= 200;
    tip.style.left = `${Math.max(0, x)}px`; tip.style.top = `${Math.max(0, e.clientY - b.top - 30)}px`;
  };
  const hideTip = () => tip.classList.add("hidden");
  return { wrap, showTip, hideTip, height };
}

function axis(svg, { W, H, m, minV, maxV, y, fmt, labels, band, every }) {
  const step = niceStep((maxV - minV) / 4 || 1);
  const g = s("g", {});
  for (let v = Math.ceil(minV / step) * step; v <= maxV + 1e-9; v += step) {
    g.append(s("line", { class: Math.abs(v) < 1e-9 ? "zero" : "grid-line", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    g.append(s("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end" }, fmt(v)));
  }
  labels.forEach((lab, i) => { if (i % every === 0) g.append(s("text", { x: m.l + band * i + band / 2, y: H - 8, "text-anchor": "middle" }, lab)); });
  svg.append(g);
}

/**
 * barChart({ labels, series: [{ name, values, color, negColor? }], line?: { name, values, color }, height, fmt, tip?(i) => [[k,v,cls]] })
 */
export function barChart(opt) {
  const { wrap, showTip, hideTip } = frame();
  const fmt = opt.fmt || fmtMoneyShort;
  const draw = () => {
    [...wrap.querySelectorAll("svg")].forEach((n) => n.remove());
    const n = opt.labels.length; if (!n) return;
    const W = Math.max(280, wrap.clientWidth), H = opt.height || 220, m = { t: 10, r: 8, b: 24, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = opt.series.flatMap((x) => x.values).concat(opt.line ? opt.line.values : []).filter((v) => v != null);
    const maxV = Math.max(1, ...all), minV = Math.min(0, ...all);
    const y = (v) => m.t + ih - ((v - minV) / (maxV - minV)) * ih;
    const band = iw / n, k = opt.series.length, gap = 2;
    const bw = Math.max(2, Math.min(26, (band * 0.72 - gap * (k - 1)) / k));
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 54))));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.label || "Chart" });
    axis(svg, { W, H, m, minV, maxV, y, fmt, labels: opt.labels, band, every });
    for (let i = 0; i < n; i++) {
      const x0 = m.l + band * i + band / 2 - (k * bw + (k - 1) * gap) / 2;
      const grp = s("g", {});
      opt.series.forEach((ser, j) => {
        const v = ser.values[i]; if (v == null) return;
        const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), hh = Math.max(1, Math.abs(y1 - y0));
        const r = Math.min(3, bw / 2, hh), x = x0 + j * (bw + gap);
        const d = v >= 0
          ? `M${x},${top + hh} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + hh} Z`
          : `M${x},${top} V${top + hh - r} Q${x},${top + hh} ${x + r},${top + hh} H${x + bw - r} Q${x + bw},${top + hh} ${x + bw},${top + hh - r} V${top} Z`;
        grp.append(s("path", { d, fill: v < 0 && ser.negColor ? ser.negColor : ser.color }));
      });
      const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" });
      hit.addEventListener("mouseenter", () => grp.setAttribute("opacity", ".75"));
      hit.addEventListener("mousemove", (e) => showTip(e, opt.titles ? opt.titles[i] : opt.labels[i], opt.tip ? opt.tip(i) : opt.series.map((ser) => [ser.name, fmt(ser.values[i])])));
      hit.addEventListener("mouseleave", () => { grp.removeAttribute("opacity"); hideTip(); });
      svg.append(grp);
      svg.append(hit);
    }
    if (opt.line) {
      const pts = opt.line.values.map((v, i) => (v == null ? null : [m.l + band * i + band / 2, y(v)])).filter(Boolean);
      if (pts.length > 1) {
        let d = `M${pts[0][0]},${pts[0][1]}`;
        for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
        const path = s("path", { d, fill: "none", stroke: opt.line.color, "stroke-width": 2, "pointer-events": "none" });
        svg.insertBefore(path, svg.querySelector("rect"));
      }
      pts.forEach(([x, yy]) => svg.insertBefore(s("circle", { cx: x, cy: yy, r: 3, fill: opt.line.color, "pointer-events": "none" }), svg.querySelector("rect")));
    }
    wrap.prepend(svg);
  };
  new ResizeObserver(draw).observe(wrap);
  return wrap;
}

/**
 * lineChart({ labels, series: [{ name, values, color, dashed? }], height, fmt, titles? })
 */
export function lineChart(opt) {
  const { wrap, showTip, hideTip } = frame();
  const fmt = opt.fmt || fmtMoneyShort;
  const draw = () => {
    [...wrap.querySelectorAll("svg")].forEach((n) => n.remove());
    const n = opt.labels.length; if (!n) return;
    const W = Math.max(280, wrap.clientWidth), H = opt.height || 220, m = { t: 10, r: 10, b: 24, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = opt.series.flatMap((x) => x.values).filter((v) => v != null);
    const maxV = Math.max(1, ...all), minV = Math.min(0, ...all);
    const y = (v) => m.t + ih - ((v - minV) / (maxV - minV)) * ih;
    const band = iw / n;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 40))));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.label || "Chart" });
    axis(svg, { W, H, m, minV, maxV, y, fmt, labels: opt.labels, band, every });
    opt.series.forEach((ser) => {
      const pts = ser.values.map((v, i) => (v == null ? null : [m.l + band * i + band / 2, y(v)]));
      let d = "", started = false;
      pts.forEach((p) => { if (!p) { started = false; return; } d += `${started ? "L" : "M"}${p[0]},${p[1]} `; started = true; });
      svg.append(s("path", { d, fill: "none", stroke: ser.color, "stroke-width": 2, "stroke-dasharray": ser.dashed ? "4 4" : null, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    });
    const guide = s("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: "#3a4656", "stroke-width": 1, visibility: "hidden" });
    svg.append(guide);
    for (let i = 0; i < n; i++) {
      const cx = m.l + band * i + band / 2;
      const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" });
      hit.addEventListener("mousemove", (e) => {
        guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("visibility", "visible");
        showTip(e, opt.titles ? opt.titles[i] : opt.labels[i], opt.series.filter((ser) => ser.values[i] != null).map((ser) => [ser.name, fmt(ser.values[i])]));
      });
      hit.addEventListener("mouseleave", () => { guide.setAttribute("visibility", "hidden"); hideTip(); });
      svg.append(hit);
    }
    wrap.prepend(svg);
  };
  new ResizeObserver(draw).observe(wrap);
  return wrap;
}

export function legend(items) {
  return h("div", { class: "legend" }, items.map(([name, color, dashed]) => h("span", {}, h("span", { class: "sw", style: { background: dashed ? "transparent" : color, border: dashed ? `1px dashed ${color}` : "none" } }), name)));
}
