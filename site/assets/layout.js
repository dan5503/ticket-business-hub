// Panels you can collapse, drag to reorder, or move with arrows.
// Order and collapsed state are saved to your account (user_prefs), with a local fallback.
import { sb, h } from "./common.js";

let prefsCache = null, saveTimer = null;

export async function loadPrefs() {
  if (prefsCache) return prefsCache;
  try {
    const { data } = await sb.from("user_prefs").select("prefs").maybeSingle();
    prefsCache = (data && data.prefs) || {};
  } catch { prefsCache = {}; }
  if (!Object.keys(prefsCache).length) {
    try { prefsCache = JSON.parse(localStorage.getItem("hub-prefs") || "{}"); } catch { prefsCache = {}; }
  }
  return prefsCache;
}

export function savePrefs() {
  try { localStorage.setItem("hub-prefs", JSON.stringify(prefsCache)); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const { data, error } = await sb.from("user_prefs").update({ prefs: prefsCache, updated_at: new Date().toISOString() }).select("owner_id");
      if (!error && (!data || !data.length)) await sb.from("user_prefs").insert({ prefs: prefsCache });
    } catch {}
  }, 600);
}

const chevron = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "chev"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M6 9l6 6 6-6"); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2.2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  s.append(p); return s;
};

/**
 * sections: { id: { title, hint?, actions?: () => Node, render: () => Node, collapsed?: bool, bare?: bool } }
 * Returns { el, reset(), rerender(id?) }
 */
export async function makeBoard(pageKey, defaultOrder, sections) {
  const prefs = await loadPrefs();
  const page = (prefs[pageKey] ||= {});
  const known = new Set(defaultOrder);
  let order = (page.order || []).filter((id) => known.has(id));
  defaultOrder.forEach((id) => { if (!order.includes(id)) order.splice(defaultOrder.indexOf(id), 0, id); });
  page.collapsed ||= Object.fromEntries(defaultOrder.filter((id) => sections[id].collapsed).map((id) => [id, true]));

  const board = h("div", { class: "board" });
  const panels = {};
  let dragId = null;

  function persist() { page.order = order; savePrefs(); }

  function build(id) {
    const def = sections[id];
    const isCollapsed = () => !!page.collapsed[id];
    const body = h("div", { class: "panel-body", id: `panel-${id}-body` });
    const toggle = h("button", { type: "button", class: "panel-title", "aria-expanded": String(!isCollapsed()), "aria-controls": `panel-${id}-body` }, chevron(), h("span", { text: def.title }));
    const handle = h("button", { type: "button", class: "handle", title: "Drag to move", "aria-label": `Move ${def.title}` }, "⋮⋮");
    const up = h("button", { type: "button", class: "mv", title: "Move up", "aria-label": `Move ${def.title} up` }, "↑");
    const down = h("button", { type: "button", class: "mv", title: "Move down", "aria-label": `Move ${def.title} down` }, "↓");
    const actions = h("div", { class: "panel-actions" });
    const head = h("div", { class: "panel-head" }, handle, toggle, actions, h("span", { class: "spacer" }), h("div", { class: "mover" }, up, down));
    const hint = def.hint ? h("p", { class: "panel-hint", text: def.hint }) : null;
    const el = h("section", { class: `panel ${def.bare ? "bare" : ""}`, "data-id": id }, head, hint, body);

    const paint = () => {
      const c = isCollapsed();
      el.classList.toggle("collapsed", c);
      toggle.setAttribute("aria-expanded", String(!c));
      actions.replaceChildren(!c && def.actions ? def.actions() : "");
      if (c) body.replaceChildren(); else body.replaceChildren(def.render());
    };
    toggle.onclick = () => { page.collapsed[id] = !isCollapsed(); savePrefs(); paint(); };
    up.onclick = () => move(id, -1);
    down.onclick = () => move(id, +1);

    // drag only from the handle
    handle.addEventListener("mousedown", () => (el.draggable = true));
    handle.addEventListener("touchstart", () => (el.draggable = true), { passive: true });
    el.addEventListener("dragstart", (e) => { dragId = id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch {} });
    el.addEventListener("dragend", () => { el.draggable = false; el.classList.remove("dragging"); dragId = null; board.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after")); });
    el.addEventListener("dragover", (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      el.classList.toggle("drop-after", after); el.classList.toggle("drop-before", !after);
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragId || dragId === id) return;
      const after = el.classList.contains("drop-after");
      order = order.filter((x) => x !== dragId);
      order.splice(order.indexOf(id) + (after ? 1 : 0), 0, dragId);
      persist(); layout();
    });

    panels[id] = { el, paint };
    paint();
  }

  function move(id, dir) {
    const i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persist(); layout();
    panels[id].el.querySelector(dir < 0 ? ".mv:first-child" : ".mv:last-child")?.focus();
  }

  function layout() {
    board.replaceChildren(...order.map((id) => panels[id].el));
    order.forEach((id, i) => {
      const [u, d] = panels[id].el.querySelectorAll(".mv");
      u.disabled = i === 0; d.disabled = i === order.length - 1;
    });
  }

  defaultOrder.forEach(build);
  layout();

  return {
    el: board,
    reset() { order = [...defaultOrder]; page.collapsed = Object.fromEntries(defaultOrder.filter((id) => sections[id].collapsed).map((id) => [id, true])); persist(); Object.values(panels).forEach((p) => p.paint()); layout(); },
    rerender(id) { (id ? [panels[id]] : Object.values(panels)).forEach((p) => p.paint()); },
    open(id) { if (page.collapsed[id]) { page.collapsed[id] = false; savePrefs(); panels[id].paint(); } panels[id].el.scrollIntoView({ behavior: "smooth", block: "start" }); },
  };
}

/* ---------- arrange: make the cards on any page movable ----------
 * Works on pages built from plain .card boxes. Every direct child of the page (or of a .stack inside it)
 * that is a card, or a .grid row of cards, becomes movable with ↑ ↓ and drag; cards that sit side by side
 * in a row also get ← → to swap places. Order is saved per page to your account.
 */
const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g;
const cardKey = (c) => (c.dataset.moveKey || c.querySelector(":scope > .card-head .card-title")?.textContent || "")
  .toLowerCase().replace(MONTHS, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const isCard = (el) => el.matches?.("section.card, div.card") && !el.classList.contains("empty") && !!cardKey(el);
const gridCards = (g) => [...g.children].filter(isCard);
const blocksOf = (c) => [...c.children].filter((el) => isCard(el) || (el.classList.contains("grid") && gridCards(el).length > 0));
const blockKey = (b) => (b.classList.contains("grid") ? "row:" + gridCards(b).map(cardKey).sort().join("|") : cardKey(b));
let dragBlock = null;

export async function arrange(scope, pageKey) {
  if (!scope) return;
  const prefs = await loadPrefs();
  const store = (prefs.arrange ||= {});
  const containers = [scope, ...scope.querySelectorAll(".stack")].filter((c, i, a) => a.indexOf(c) === i && blocksOf(c).length >= 2);
  containers.forEach((c, ci) => setupContainer(c, `${pageKey}#${ci}`, store));
}

function setupContainer(c, key, store) {
  const saved = (store[key] ||= { order: [], inner: {} });
  const persist = () => savePrefs();

  function apply() {
    let blocks = blocksOf(c);
    // rows: put their cards in the saved order
    blocks.filter((b) => b.classList.contains("grid")).forEach((g) => {
      const want = saved.inner[blockKey(g)];
      if (!want) return;
      const cards = gridCards(g), pos = (x) => { const i = want.indexOf(cardKey(x)); return i < 0 ? 999 : i; };
      const marks = cards.map((x) => { const m = document.createComment(""); x.before(m); return m; });
      [...cards].sort((a, b) => pos(a) - pos(b)).forEach((x, i) => marks[i].after(x));
      marks.forEach((m) => m.remove());
    });
    // blocks: saved order first, new ones keep their default place
    const keys = blocks.map(blockKey), known = saved.order.filter((k) => keys.includes(k));
    const order = [...known]; keys.forEach((k, i) => { if (!order.includes(k)) order.splice(Math.min(i, order.length), 0, k); });
    const byKey = new Map(blocks.map((b) => [blockKey(b), b]));
    const marks = blocks.map((b) => { const m = document.createComment(""); b.before(m); return m; });
    order.forEach((k, i) => marks[i].after(byKey.get(k)));
    marks.forEach((m) => m.remove());
    blocks = blocksOf(c);
    saved.order = blocks.map(blockKey);
    blocks.forEach((b, i) => {
      const inRow = b.classList.contains("grid");
      (inRow ? gridCards(b) : [b]).forEach((card, j, row) => controls(card, b, i, blocks.length, inRow ? j : -1, row.length));
    });
  }

  function moveBlock(b, dir) {
    const blocks = blocksOf(c), i = blocks.indexOf(b), j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const keys = blocks.map(blockKey); [keys[i], keys[j]] = [keys[j], keys[i]];
    saved.order = keys; persist(); apply();
  }
  function moveInRow(g, card, dir) {
    const keys = gridCards(g).map(cardKey), i = keys.indexOf(cardKey(card)), j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    const oldKey = blockKey(g); saved.inner[oldKey] = keys; persist(); apply();
  }

  function controls(card, block, i, n, j, rowLen) {
    const head = card.querySelector(":scope > .card-head");
    if (!head) return;
    head.querySelector(":scope > .mover.arr")?.remove();
    const t = cardKey(card);
    const btn = (txt, label, dis, fn) => { const b = h("button", { type: "button", class: "mv", title: label, "aria-label": `${label}: ${t}`, disabled: dis }, txt); b.onclick = fn; return b; };
    const handle = h("button", { type: "button", class: "handle", title: "Drag to move", "aria-label": `Drag ${t}` }, "⋮⋮");
    const box = h("div", { class: "mover arr" },
      j >= 0 ? btn("←", "Move left", j === 0, () => moveInRow(block, card, -1)) : "",
      j >= 0 ? btn("→", "Move right", j === rowLen - 1, () => moveInRow(block, card, +1)) : "",
      btn("↑", "Move up", i === 0, () => moveBlock(block, -1)),
      btn("↓", "Move down", i === n - 1, () => moveBlock(block, +1)), handle);
    head.append(box);
    handle.onmousedown = () => (block.draggable = true);
    handle.ontouchstart = () => (block.draggable = true);
  }

  if (!c.dataset.arranged) {
    c.dataset.arranged = "1";
    c.addEventListener("dragstart", (e) => { const b = blocksOf(c).find((x) => x === e.target); if (!b) return; dragBlock = b; b.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "x"); } catch {} });
    c.addEventListener("dragend", () => { if (dragBlock) { dragBlock.draggable = false; dragBlock.classList.remove("dragging"); } dragBlock = null; c.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after")); });
    const target = (e) => blocksOf(c).find((b) => b.contains(e.target));
    c.addEventListener("dragover", (e) => {
      const b = target(e); if (!dragBlock || !b || b === dragBlock) return;
      e.preventDefault();
      const r = b.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      blocksOf(c).forEach((x) => x.classList.remove("drop-before", "drop-after"));
      b.classList.add(after ? "drop-after" : "drop-before");
    });
    c.addEventListener("drop", (e) => {
      const b = target(e); if (!dragBlock || !b || b === dragBlock) return;
      e.preventDefault();
      const after = b.classList.contains("drop-after"), keys = blocksOf(c).map(blockKey).filter((k) => k !== blockKey(dragBlock));
      keys.splice(keys.indexOf(blockKey(b)) + (after ? 1 : 0), 0, blockKey(dragBlock));
      saved.order = keys; persist(); apply();
    });
  }
  apply();
}
