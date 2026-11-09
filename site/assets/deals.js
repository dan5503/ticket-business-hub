// Deals & Presales: presale codes, on-sales and ticket deals pulled out of danielbehman@primelioninc.com,
// plus the newsletter signup tracker.
import { sb, h, fetchAll, fmtInt, fmtDate, toast, niceError, todayISO } from "./common.js";
import { arrange } from "./layout.js";

const MAILBOX = "danielbehman@primelioninc.com";
const UI = { tab: "presale", show: 60 };
const KINDS = { presale: "Presale", onsale: "On sale", deal: "Deal", news: "Newsletter" };
const lc = (v) => (v || "").trim().toLowerCase();
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
function until(iso) {
  const ms = Date.parse(iso) - Date.now(), m = Math.round(ms / 60000);
  if (ms < 0) return { text: "Live now", c: "up" };
  if (m < 60) return { text: `in ${m} min`, c: "down" };
  if (m < 1440) return { text: `in ${Math.round(m / 60)}h`, c: "meh" };
  return { text: `in ${Math.round(m / 1440)} days`, c: "" };
}

export async function renderDeals(root) {
  const reload = () => renderDeals(root);
  const [emails, sources, sales, inv] = await Promise.all([
    fetchAll("deal_emails", "id,gmail_id,received_at,sender_name,sender_email,subject,kind,artists,codes,starts_at,ends_at,link,summary,pinned,done", "received_at").catch(() => []),
    fetchAll("deal_sources", "id,name,url,category,status,email_used,note,signed_up_at", "name").catch(() => []),
    fetchAll("sales", "artist", "artist").catch(() => []),
    fetchAll("inventory_outlook", "artist,discord_artist,event_date,remaining_qty", "event_date").catch(() => []),
  ]);
  const today = todayISO(), sold = new Map(), held = new Map();
  sales.forEach((r) => { const k = lc(r.artist); if (k) sold.set(k, (sold.get(k) || 0) + 1); });
  inv.forEach((p) => { if (p.remaining_qty > 0 && p.event_date >= today) [p.discord_artist, p.artist].forEach((n) => { const k = lc(n); if (k) held.set(k, (held.get(k) || 0) + p.remaining_qty); }); });
  const matchName = (map, a) => { const k = lc(a); for (const [n, v] of map) if (n === k || n.startsWith(k + ":") || n.startsWith(k + " -")) return v; return 0; };

  async function setFlag(e, field, value) {
    const { error } = await sb.from("deal_emails").update({ [field]: value }).eq("id", e.id);
    if (error) return toast(niceError(error), "error");
    e[field] = value; paint();
  }
  const copy = (code) => h("button", { type: "button", class: "code", title: "Copy code", onclick: async () => { try { await navigator.clipboard.writeText(code); toast(`Copied ${code}`, "ok"); } catch { toast("Couldn't copy. Select the code instead.", "error"); } } }, code);

  function item(e) {
    const u = e.starts_at && e.kind !== "news" ? until(e.starts_at) : null;
    const flags = (e.artists || []).map((a) => {
      const hq = matchName(held, a), sq = matchName(sold, a);
      return h("span", { class: `pill ${hq ? "warn" : sq ? "good" : ""}`, title: hq ? `You hold ${hq} tickets` : sq ? `You've sold ${a} ${sq} times` : "" }, a, hq ? ` · ${hq} held` : sq ? ` · sold ${sq}×` : "");
    });
    return h("article", { class: `deal ${e.pinned ? "pinned" : ""} ${e.done ? "is-done" : ""}` },
      h("div", { class: "deal-when" },
        h("span", { class: `pill k-${e.kind}`, text: KINDS[e.kind] }),
        e.starts_at ? h("b", { class: "num", text: when.format(new Date(e.starts_at)) }) : h("span", { class: "muted small", text: `Received ${ago(e.received_at)}` }),
        u ? h("span", { class: `small ${u.c}`, text: u.text }) : ""),
      h("div", { class: "deal-body" },
        h("div", { class: "deal-subject", text: e.subject || "(no subject)" }),
        h("div", { class: "muted small", text: [e.sender_name || e.sender_email, e.summary].filter(Boolean).join(" · ") }),
        flags.length || (e.codes || []).length ? h("div", { class: "deal-tags" }, flags, (e.codes || []).map(copy)) : ""),
      h("div", { class: "deal-actions" },
        e.link ? h("a", { class: "btn small", href: e.link, target: "_blank", rel: "noopener noreferrer", text: "Open" }) : "",
        h("a", { class: "btn small ghost", href: `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAILBOX)}#all/${encodeURIComponent(e.gmail_id)}`, target: "_blank", rel: "noopener noreferrer", text: "Email" }),
        h("button", { type: "button", class: "star", "aria-pressed": String(e.pinned), "aria-label": e.pinned ? "Unpin" : "Pin", text: e.pinned ? "★" : "☆", onclick: () => setFlag(e, "pinned", !e.pinned) }),
        h("button", { type: "button", class: "small ghost", text: e.done ? "Undo" : "Done", onclick: () => setFlag(e, "done", !e.done) })));
  }

  const listBox = h("div");
  function paint() {
    const now = Date.now(), recent = now - 14 * 86400000;
    const tabs = {
      presale: ["Presales", (e) => !e.done && e.kind === "presale" && (!e.starts_at || Date.parse(e.ends_at || e.starts_at) > now - 6 * 3600000)],
      onsale: ["On sales", (e) => !e.done && e.kind === "onsale" && (!e.starts_at || Date.parse(e.starts_at) > now - 6 * 3600000)],
      deal: ["Deals", (e) => !e.done && e.kind === "deal" && (!e.ends_at || Date.parse(e.ends_at) > now)],
      mine: ["Your artists", (e) => !e.done && (e.artists || []).some((a) => matchName(held, a) || matchName(sold, a))],
      all: ["Everything", (e) => Date.parse(e.received_at) > recent || e.pinned],
      done: ["Done", (e) => e.done],
    };
    const [, pick] = tabs[UI.tab];
    const list = emails.filter(pick).sort((a, b) =>
      (b.pinned - a.pinned) || (["presale", "onsale"].includes(UI.tab) ? (Date.parse(a.starts_at || "2999-01-01") - Date.parse(b.starts_at || "2999-01-01")) : (Date.parse(b.received_at) - Date.parse(a.received_at))));
    listBox.replaceChildren(
      h("div", { class: "seg", role: "group", "aria-label": "Show" }, Object.entries(tabs).map(([k, [t, f]]) =>
        h("button", { type: "button", class: UI.tab === k ? "on" : "", onclick: () => { UI.tab = k; UI.show = 60; paint(); } }, `${t} ${fmtInt(emails.filter(f).length)}`))),
      list.length ? h("div", { class: "deal-list mt" }, list.slice(0, UI.show).map(item)) :
        h("p", { class: "muted mt", text: emails.length ? "Nothing here right now." : `Nothing sorted yet. New presale and deal emails from ${MAILBOX} show up here every couple of hours.` }),
      list.length > UI.show ? h("button", { type: "button", class: "mt", text: `Show more (${list.length - UI.show} left)`, onclick: () => { UI.show += 60; paint(); } }) : "");
  }

  // ---------- signup checklist ----------
  const SIGNUP_EMAIL = "danielbehman+tix@primelioninc.com";
  const CATS = { venue: "Venues you sell most", card: "Credit card & phone presales", alerts: "Presale alerts", marketplace: "Marketplace deals", promoter: "Promoters", artist: "Artists", other: "Other" };
  async function setStatus(x, status) {
    const { error } = await sb.from("deal_sources").update({ status, signed_up_at: status === "subscribed" ? new Date().toISOString() : null }).eq("id", x.id);
    if (error) return toast(niceError(error), "error");
    x.status = status; x.signed_up_at = status === "subscribed" ? new Date().toISOString() : null; trackerBox.replaceChildren(tracker());
  }
  const trackerBox = h("div");
  function tracker() {
    if (!sources.length) return h("p", { class: "muted", text: "No signups on the list yet." });
    const open = sources.filter((x) => ["todo", "needs_you", "failed"].includes(x.status)), done = sources.filter((x) => x.status === "subscribed");
    const copyEmail = h("button", { type: "button", class: "code", title: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(SIGNUP_EMAIL); toast("Email copied", "ok"); } catch { toast("Couldn't copy", "error"); } } }, SIGNUP_EMAIL);
    const row = (x) => h("div", { class: `signup ${x.status}` },
      h("div", { class: "signup-main" },
        x.url ? h("a", { class: "btn small primary", href: x.url, target: "_blank", rel: "noopener noreferrer", text: "Open ↗" }) : "",
        h("div", {}, h("b", { text: x.name }), x.note ? h("div", { class: "muted small", text: x.note }) : "")),
      x.status === "subscribed"
        ? h("div", { class: "deal-actions" }, h("span", { class: "pill good", text: `Done${x.signed_up_at ? " " + fmtDate(x.signed_up_at.slice(0, 10)) : ""}` }), h("button", { type: "button", class: "small ghost", text: "Undo", onclick: () => setStatus(x, "todo") }))
        : h("div", { class: "deal-actions" }, h("button", { type: "button", class: "small", text: "Signed up", onclick: () => setStatus(x, "subscribed") }), h("button", { type: "button", class: "small ghost", text: "Skip", onclick: () => setStatus(x, "skipped") })));
    const groups = Object.keys(CATS).map((c) => [c, open.filter((x) => x.category === c)]).filter(([, l]) => l.length);
    return h("div", {},
      h("p", { class: "small" }, `${fmtInt(done.length)} of ${fmtInt(sources.filter((x) => x.status !== "skipped").length)} done. Sign up with `, copyEmail, " (tap to copy). It lands in your normal inbox and gets sorted automatically."),
      groups.map(([c, l]) => h("div", { class: "mt" }, h("h3", { class: "group-title", text: `${CATS[c]} · ${l.length}` }), h("div", { class: "deal-list" }, l.map(row)))),
      done.length ? h("details", { class: "mt" }, h("summary", { text: `Done (${done.length})` }), h("div", { class: "deal-list mt" }, done.map(row))) : "");
  }

  const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");
  const upcoming = emails.filter((e) => !e.done && e.kind === "presale" && e.starts_at && Date.parse(e.starts_at) > Date.now() && Date.parse(e.starts_at) < Date.now() + 48 * 3600000).length;
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {},
      h("h1", { text: "Deals & Presales" }),
      h("p", { class: "sub", text: `Presale codes, on-sales and ticket deals pulled out of ${MAILBOX}.${upcoming ? ` ${upcoming === 1 ? "1 presale starts" : `${upcoming} presales start`} in the next 48 hours.` : ""}` }))),
    h("div", { class: "stack" },
      card("Inbox, sorted", listBox, "Sorted every couple of hours. Artists you hold tickets for are marked in yellow, ones you've sold in green. Tap a code to copy it."),
      card("Sign up for more presales", trackerBox, "Only places that aren't emailing you yet are listed. Live Nation, Ticketmaster, AEG, Goldenvoice, Bowery, AXS, SeatGeek, Bandsintown, MSG, Barclays, MetLife and others already are.")));
  trackerBox.replaceChildren(tracker());
  paint();
  arrange(root, "deals");
}
