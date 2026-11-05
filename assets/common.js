// Shared helpers used by every page.
// Refuse to run inside someone else's frame (clickjacking protection).
if (window.top !== window.self) { document.documentElement.replaceChildren(); throw new Error("framed"); }
const cfg = window.HUB_CONFIG;

export const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
export const CONFIG = cfg;

/* ---------- tiny safe DOM builder (never uses innerHTML with data) ---------- */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- SVG builder ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

/* ---------- formatting ---------- */
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US");
export const fmtMoney = (v, cents = false) => (v == null || isNaN(v) ? "—" : (cents ? money2 : money0).format(v));
export const fmtMoneyShort = (v) => {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
};
export const fmtInt = (v) => (v == null || isNaN(v) ? "—" : int.format(Math.round(v)));
export const fmtPct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(d)}%`);
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function monthLabel(key, long = false) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });
}
export const signClass = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------- toasts ---------- */
export function toast(msg, kind = "") {
  let box = $("#toasts");
  if (!box) { box = h("div", { id: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: `toast ${kind}`, text: msg });
  box.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function niceError(err) {
  const m = (err && (err.message || err.error_description || String(err))) || "Something went wrong";
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Please confirm your email first (check your inbox).";
  if (/Sign-ups are closed|Database error saving new user/i.test(m)) return "This hub is private. Sign-ups are closed.";
  if (/rate limit/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
  return m;
}

/* ---------- auth ---------- */
export async function requireSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.replace("index.html"); throw new Error("redirect"); }
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") location.replace("index.html"); });
  return data.session;
}

// Sign out automatically after 30 minutes without activity.
export function startIdleTimer(minutes = 30) {
  let t;
  const reset = () => { clearTimeout(t); t = setTimeout(async () => { await sb.auth.signOut(); location.replace("index.html?idle=1"); }, minutes * 60000); };
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((e) => addEventListener(e, reset, { passive: true }));
  reset();
}

/* ---------- data ---------- */
// Supabase returns max 1000 rows per request, so page through everything.
export async function fetchAll(table, columns, order = "created_at") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order(order, { ascending: true }).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function copyText(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(`${label} ✓`, "ok"); }
  catch { toast("Couldn't copy. Your browser blocked it.", "error"); }
}

export function modal(title, body, actions) {
  const bg = h("div", { class: "modal-bg" });
  const close = () => bg.remove();
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", { text: title }), body, h("div", { class: "foot" }, actions(close)));
  bg.append(box);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); removeEventListener("keydown", esc); } });
  document.body.append(bg);
  const first = box.querySelector("input,select,textarea");
  if (first) first.focus();
  return close;
}
