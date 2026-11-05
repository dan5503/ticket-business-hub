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

function savePrefs() {
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
