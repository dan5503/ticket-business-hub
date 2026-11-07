// Deals & Presales: presale codes, on-sales and ticket deals pulled out of danielbehman@primelioninc.com,
// plus the newsletter signup tracker.
import { sb, h, fetchAll, fmtInt, fmtDate, toast, niceError, todayISO } from "./common.js";

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

  // ---------- signup tracker ----------
  function tracker() {
    const by = (st) => sources.filter((x) => x.status === st);
    const STATUS = { subscribed: ["Signed up", "good"], needs_you: ["Needs you", "warn"], todo: ["Queued", ""], failed: ["Didn't work", "bad"], skipped: ["Skipped", ""] };
    if (!sources.length) return h("p", { class: "muted", text: "The signup list will show here as places get added." });
    const counts = h("div", { class: "row" }, Object.entries(STATUS).filter(([k]) => by(k).length).map(([k, [t, c]]) => h("span", { class: `pill ${c}`, text: `${t} ${by(k).length}` })));
    const rows = [...sources].sort((a, b) => ["needs_you", "failed", "todo", "subscribed", "skipped"].indexOf(a.status) - ["needs_you", "failed", "todo", "subscribed", "skipped"].indexOf(b.status) || a.name.localeCompare(b.name));
    return h("div", {}, counts, h("div", { class: "table-wrap mt" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Where", "Type", "Status", "Note"].map((t) => h("th", { scope: "col", text: t })))),
      h("tbody", {}, rows.map((x) => h("tr", {},
        h("td", {}, x.url ? h("a", { class: "link-like", href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.name }) : x.name),
        h("td", { class: "muted", text: x.category }),
        h("td", {}, h("span", { class: `pill ${STATUS[x.status][1]}`, text: STATUS[x.status][0] }), x.signed_up_at ? h("span", { class: "sub", text: fmtDate(x.signed_up_at.slice(0, 10)) }) : ""),
        h("td", { class: "small", text: x.note || "" })))))));
  }

  const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");
  const upcoming = emails.filter((e) => !e.done && e.kind === "presale" && e.starts_at && Date.parse(e.starts_at) > Date.now() && Date.parse(e.starts_at) < Date.now() + 48 * 3600000).length;
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {},
      h("h1", { text: "Deals & Presales" }),
      h("p", { class: "sub", text: `Presale codes, on-sales and ticket deals pulled out of ${MAILBOX}.${upcoming ? ` ${upcoming === 1 ? "1 presale starts" : `${upcoming} presales start`} in the next 48 hours.` : ""}` }))),
    h("div", { class: "stack" },
      card("Inbox, sorted", listBox, "Sorted every couple of hours. Artists you hold tickets for are marked in yellow, ones you've sold in green. Tap a code to copy it."),
      card("Newsletter signups", tracker(), "New signups use danielbehman+tix@primelioninc.com, which lands in the same inbox and is easy to sort.")));
  paint();
}
