import { sb, $, $$, h, requireSession, startIdleTimer, toast, fmtMoney, fmtPct } from "./common.js";
import { makePortfolio, MY_TABS, PLT_TABS } from "./portfolio.js";
import { renderInventory } from "./inventory.js";
import { renderDiscord } from "./discord.js";
import { renderLinks } from "./links.js";
import { renderSpotify } from "./spotify.js";

await requireSession();
startIdleTimer(30);

$("#signout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };

/* ---------- clock (New York time) ---------- */
const clock = $("#clock");
const tick = () => {
  const now = new Date();
  const d = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const t = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  clock.replaceChildren(`${d} · `, h("b", { text: t }), " NY");
};
tick(); setInterval(tick, 1000);

/* ---------- ticker tape of recent sales ---------- */
const tapeTrack = $("#tape-track");
let tapeRows = [];
function paintTape() {
  if (!tapeRows.length) { tapeTrack.replaceChildren(h("span", { class: "tape-item muted", text: "Waiting for your first sale…" })); return; }
  const items = tapeRows.map((r) => {
    const p = Number(r.profit || 0), up = p >= 0;
    const d = (r.sold_at ? new Date(r.sold_at) : r.sold_date ? new Date(r.sold_date + "T12:00:00") : new Date()).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return h("span", { class: "tape-item" }, h("b", { text: r.artist || "Sale" }),
      h("span", { class: up ? "up" : "down", text: `${up ? "▲" : "▼"} ${up ? "+" : "-"}${fmtMoney(Math.abs(p), true)} (${up ? "+" : ""}${fmtPct(r.roi == null ? null : Number(r.roi), 2)})` }),
      h("span", { class: "d", text: d }));
  });
  tapeTrack.replaceChildren(...items, ...items.map((n) => n.cloneNode(true)));
  tapeTrack.style.animationDuration = `${Math.max(30, tapeRows.length * 5)}s`;
}
async function loadTape() {
  const { data } = await sb.from("sales").select("artist,profit,roi,sold_at,sold_date,created_at").order("sold_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(25);
  tapeRows = data || []; paintTape();
}
loadTape();

/* ---------- notifications ---------- */
const NKEY = "hub-notes", PKEY = "hub-note-prefs";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let notes = load(NKEY, []);
const prefs = load(PKEY, { sound: true, desktop: false });
const bell = $("#bell"), count = $("#bell-count"), panel = $("#notes");
const baseTitle = document.title;

function paintBell() {
  const unread = notes.filter((n) => !n.read).length;
  count.textContent = unread > 9 ? "9+" : String(unread);
  count.classList.toggle("hidden", !unread);
  document.title = unread ? `(${unread}) New sale · ${baseTitle}` : baseTitle;
}
function paintPanel() {
  const soundBtn = h("button", { type: "button", class: "icon", onclick: () => { prefs.sound = !prefs.sound; save(PKEY, prefs); paintPanel(); if (prefs.sound) chime(); } }, `Sound: ${prefs.sound ? "on" : "off"}`);
  const deskBtn = h("button", { type: "button", class: "icon", onclick: async () => {
    if (!("Notification" in window)) return toast("This browser doesn't support desktop alerts.", "error");
    if (!prefs.desktop) {
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("Desktop alerts are blocked. Allow notifications for this site in your browser settings.", "error");
    }
    prefs.desktop = !prefs.desktop; save(PKEY, prefs); paintPanel();
  } }, `Desktop alerts: ${prefs.desktop ? "on" : "off"}`);
  panel.replaceChildren(
    h("div", { class: "notes-head" }, h("b", { text: "New sales" }), h("span", { class: "spacer" }), soundBtn, deskBtn),
    ...(notes.length ? notes.slice(0, 40).map((n) => {
      const up = n.profit >= 0;
      return h("div", { class: `note ${n.read ? "" : "unread"}` },
        h("div", { class: "a", text: n.artist || "Sale" }),
        h("div", { class: `p ${up ? "up" : "down"}`, text: `${up ? "+" : "-"}${fmtMoney(Math.abs(n.profit), true)}` }),
        h("div", { class: "m", text: `${n.qty ? `${n.qty} tickets, ` : ""}${n.venue ? `${n.venue}, ` : ""}${new Date(n.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }));
    }) : [h("div", { class: "note" }, h("div", { class: "m", text: "New sales will show up here the moment they arrive, while the hub is open." }))]),
    notes.length ? h("div", { class: "notes-head" }, h("button", { type: "button", class: "icon ghost", onclick: () => { notes = []; save(NKEY, notes); paintBell(); paintPanel(); } }, "Clear all")) : "");
}
bell.onclick = (e) => {
  e.stopPropagation();
  const open = panel.classList.toggle("hidden") === false;
  bell.setAttribute("aria-expanded", String(open));
  if (open) { paintPanel(); notes.forEach((n) => (n.read = true)); save(NKEY, notes); paintBell(); }
};
document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== bell) panel.classList.add("hidden"); });
paintBell();

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t); o.stop(t + 0.4);
    });
  } catch {}
}

function announce(r) {
  const profit = Number(r.profit || 0), up = profit >= 0;
  const n = { artist: r.artist, venue: r.venue, qty: r.quantity, profit, roi: r.roi, at: r.sold_at || new Date().toISOString(), read: false };
  notes.unshift(n); notes = notes.slice(0, 100); save(NKEY, notes); paintBell();
  if (!panel.classList.contains("hidden")) paintPanel();
  toast(`${up ? "▲" : "▼"} New sale: ${r.artist || "Unknown"}  ${up ? "+" : "-"}${fmtMoney(Math.abs(profit), true)}${r.roi != null ? ` (${fmtPct(Number(r.roi))})` : ""}`, "sale");
  if (prefs.sound) chime();
  if (prefs.desktop && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(`New sale: ${r.artist || "Unknown"}`, { body: `${up ? "+" : "-"}${fmtMoney(Math.abs(profit), true)} profit${r.quantity ? `, ${r.quantity} tickets` : ""}${r.venue ? ` at ${r.venue}` : ""}`, icon: "assets/icon-192.png", tag: `sale-${r.id}` }); } catch {}
  }
  tapeRows.unshift(r); tapeRows = tapeRows.slice(0, 25); paintTape();
}

/* ---------- live feed ---------- */
const live = $("#live");
sb.channel("sales-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales" }, (p) => {
    const r = p.new || {};
    announce(r);
    mine.onNewSale(r);
  })
  .subscribe((status) => live.classList.toggle("on", status === "SUBSCRIBED"));

/* ---------- two separate books: your sales and PLT company sales ---------- */
const mine = makePortfolio({ base: "p", table: "sales", tabs: MY_TABS, showTag: true, inventory: true,
  emptyText: "Open #danielbehnam-sales on discord.com in Chrome, click the ALLPWST Discord Data extension and choose “Sync All History”. Your sales will stream in here." });
const plt = makePortfolio({ base: "plt", table: "plt_sales_clean", tabs: PLT_TABS, showTag: false, inventory: false,
  title: "PLT Sales", subtitle: "Company-wide sales from #plt-sales. Kept completely separate from your own numbers, TAG and inventory.",
  emptyText: "Open #plt-sales on discord.com in Chrome, click the ALLPWST Discord Data extension and choose “Sync All History”. Company sales will appear here, separate from yours." });

/* ---------- routing ---------- */
const views = { inventory: renderInventory, spotify: renderSpotify, discord: renderDiscord, links: renderLinks };
let cleanup = null, lastKey = "";
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const [top, ...rest] = hash.split("/");
  const key = views[top] ? top : top === "plt" ? "plt" : "p";
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
  $("#tape").classList.toggle("hidden", key === "plt"); // your personal ticker stays off the company page
  if (typeof cleanup === "function") cleanup();
  const root = $("#view");
  if (key !== lastKey) { root.replaceChildren(h("div", { class: "empty" }, "Loading…")); window.scrollTo(0, 0); }
  lastKey = key;
  try {
    cleanup = key === "p" ? await mine.renderPortfolio(root, rest) : key === "plt" ? await plt.renderPortfolio(root, rest) : await views[key](root);
  } catch (err) {
    console.error(err);
    root.replaceChildren(h("div", { class: "card empty" }, h("h2", { text: "Couldn't load this page" }), h("p", { text: err.message || String(err) })));
  }
}
addEventListener("hashchange", route);
route();
