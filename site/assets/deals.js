// Three pages built from the same sorted inbox (danielbehman@primelioninc.com):
//   Presales: presale codes and on-sales you can buy at.
//   Signups: presales you have to register for first (artist presale sign-ups, Verified Fan, Seated),
//            plus the newsletter signup tracker.
//   Deals: discounts, promo codes, BOGO, free tickets, with the Ticketmaster/AXS/SeatGeek page to use them on.
import { sb, h, fetchAll, fmtInt, fmtDate, fmtMoney, toast, niceError, todayISO } from "./common.js";
import { arrange } from "./layout.js";

const MAILBOX = "danielbehman@primelioninc.com";
const UI = { tab: "presale", show: 60, dtab: "active", dshow: 40, stab: "open", sshow: 60, sort: { presales: "smart", deals: "smart", signups: "smart" } };
const KINDS = { presale: "Presale", onsale: "On sale", deal: "Deal", signup: "Sign-up", news: "Newsletter" };
const SIDE = new Set(["deal", "signup"]); // kinds that have their own page, kept off the Presales lists
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

export const renderPresales = (root) => renderInbox(root, "presales");
export const renderDeals = (root) => renderInbox(root, "deals");
export const renderSignups = (root) => renderInbox(root, "signups");

async function renderInbox(root, mode) {
  const [emails, sources, sales, inv, plt] = await Promise.all([
    fetchAll("deal_emails", "id,gmail_id,received_at,sender_name,sender_email,subject,kind,artists,codes,starts_at,ends_at,link,summary,pinned,done,discount,event_name,venue,city,event_dates,buy_link,buy_site,buy_note", "received_at").catch(() => []),
    fetchAll("deal_sources", "id,name,url,category,status,email_used,note,signed_up_at", "name").catch(() => []),
    fetchAll("sales", "artist,venue,city,event_date,section,row_name,quantity,total_sale,total_cost,profit,cost_per,sold_per,sold_date", "artist").catch(() => []),
    fetchAll("inventory_outlook", "artist,discord_artist,venue,event_date,section,row_name,remaining_qty,cost_per", "event_date").catch(() => []),
    fetchAll("plt_sales_clean", "artist,venue,city,event_date,section,row_name,quantity,total_sale,total_cost,profit,cost_per,sold_per,sold_date,is_repost", "artist").then((r) => r.filter((x) => !x.is_repost)).catch(() => []),
  ]);
  const today = todayISO(), sold = new Map(), held = new Map();
  sales.forEach((r) => { const k = lc(r.artist); if (k) sold.set(k, (sold.get(k) || 0) + 1); });
  inv.forEach((p) => { if (p.remaining_qty > 0 && p.event_date >= today) [p.discord_artist, p.artist].forEach((n) => { const k = lc(n); if (k) held.set(k, (held.get(k) || 0) + p.remaining_qty); }); });
  const matchName = (map, a) => { const k = lc(a); for (const [n, v] of map) if (n === k || n.startsWith(k + ":") || n.startsWith(k + " -")) return v; return 0; };

  // ---------- past results for an artist, kept in two separate books ----------
  // "Your sales" = your own Discord sales (#danielbehnam-sales, table sales) and your inventory.
  // "PLT sales"  = company-wide sales from #plt-sales (plt_sales_clean). Never mixed together.
  const sameName = (n, k) => n === k || n.startsWith(k + ":") || n.startsWith(k + " -");
  const rowsFor = (book, names) => { const ks = (names || []).map(lc).filter(Boolean); return ks.length ? book.filter((r) => { const n = lc(r.artist); return n && ks.some((k) => sameName(n, k)); }) : []; };
  const pastSales = (names) => rowsFor(sales, names);
  const num = (v) => (v == null || isNaN(+v) ? 0 : +v);
  function stats(rows) {
    if (!rows.length) return null;
    const cost = rows.reduce((t, r) => t + num(r.total_cost), 0), sale = rows.reduce((t, r) => t + num(r.total_sale), 0), profit = rows.reduce((t, r) => t + num(r.profit), 0);
    const tix = rows.reduce((t, r) => t + (num(r.quantity) || 1), 0), wins = rows.filter((r) => num(r.profit) > 0).length;
    const last = rows.map((r) => r.sold_date).filter(Boolean).sort().pop();
    return { n: rows.length, tix, cost, sale, profit, roi: cost > 0 ? profit / cost : null, wins, perTix: tix ? profit / tix : 0, buyEach: tix ? cost / tix : 0, sellEach: tix ? sale / tix : 0, last };
  }
  const pct = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);
  const signed = (v) => `${v < 0 ? "−" : "+"}${fmtMoney(Math.abs(v))}`;
  const verdict = (st) => (st.roi == null ? { t: "No cost on file", c: "" } : st.roi >= 0.2 ? { t: "Good returns", c: "good" } : st.roi >= 0 ? { t: "Thin returns", c: "warn" } : { t: "Lost money", c: "bad" });
  const statLine = (st) => `${fmtInt(st.n)} sale${st.n === 1 ? "" : "s"} · ${fmtInt(st.tix)} tix · ${signed(st.profit)} profit (${pct(st.roi)} ROI) · ${st.wins} of ${st.n} made money${st.last ? ` · last sold ${fmtDate(st.last)}` : ""}`;
  // ---------- sort menu shared by the three lists ----------
  const SORTS = [["smart", "Smart order"], ["starts", "Starts soonest"], ["ends", "Ends soonest"], ["newest", "Newest email"], ["oldest", "Oldest email"],
    ["discount", "Biggest discount"], ["profit", "Best past profit"], ["roi", "Best past ROI"], ["sales", "Most past sales"], ["artist", "Artist A–Z"]];
  const t = (v, far = 8e15) => (v ? Date.parse(v) || far : far);
  const pastCache = new Map();
  const past = (e) => { const k = (e.artists || []).join("|"); if (!pastCache.has(k)) pastCache.set(k, stats(pastSales(e.artists)) || { n: 0, profit: -1e12, roi: -1e9 }); return pastCache.get(k); };
  const disc = (e) => { const m = String(e.discount || "").match(/(\d+(?:\.\d+)?)\s*%/) || String(e.discount || "").match(/\$\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : -1; };
  function applySort(list, which, smart) {
    const k = UI.sort[which];
    const by = {
      smart, starts: (a, b) => t(a.starts_at) - t(b.starts_at), ends: (a, b) => t(a.ends_at) - t(b.ends_at),
      newest: (a, b) => t(b.received_at, 0) - t(a.received_at, 0), oldest: (a, b) => t(a.received_at) - t(b.received_at),
      discount: (a, b) => disc(b) - disc(a), profit: (a, b) => past(b).profit - past(a).profit, roi: (a, b) => (past(b).roi ?? -1e9) - (past(a).roi ?? -1e9),
      sales: (a, b) => past(b).n - past(a).n, artist: (a, b) => (a.artists?.[0] || a.event_name || a.subject || "").localeCompare(b.artists?.[0] || b.event_name || b.subject || ""),
    }[k] || smart;
    return list.sort(by);
  }
  const sortMenu = (which, repaint, opts = SORTS) => {
    const sel = h("select", { "aria-label": "Sort by", class: "auto-w" }, opts.map(([v, txt]) => h("option", { value: v, text: `Sort: ${txt}`, selected: UI.sort[which] === v })));
    sel.onchange = () => { UI.sort[which] = sel.value; repaint(); };
    return sel;
  };
  const NO_DISC = SORTS.filter(([k]) => k !== "discount");
  const priceLine = (st) => `Bought avg ${fmtMoney(st.buyEach)}/ticket → sold avg ${fmtMoney(st.sellEach)}/ticket (${signed(st.perTix)} each)`;
  const seat = (r) => [r.section ? `Sec ${r.section}` : "", r.row_name ? `Row ${r.row_name}` : ""].filter(Boolean).join(" · ") || "—";
  function salesTable(rows) {
    const list = [...rows].sort((a, b) => String(b.sold_date || "").localeCompare(String(a.sold_date || ""))).slice(0, 12);
    return h("div", { class: "table-wrap" }, h("table", { class: "hist-table small" },
      h("thead", {}, h("tr", {}, ["Sold", "Show", "Venue", "Seats", "Qty", "Bought ea", "Sold ea", "Profit"].map((t) => h("th", { text: t })))),
      h("tbody", {}, list.map((r) => h("tr", {},
        h("td", { text: r.sold_date ? fmtDate(r.sold_date) : "—" }),
        h("td", { text: r.event_date ? fmtDate(r.event_date) : "—" }),
        h("td", { text: r.venue || "—" }),
        h("td", { text: seat(r) }),
        h("td", { class: "num", text: fmtInt(num(r.quantity) || 1) }),
        h("td", { class: "num", text: r.cost_per != null ? fmtMoney(+r.cost_per) : num(r.quantity) ? fmtMoney(num(r.total_cost) / num(r.quantity)) : "—" }),
        h("td", { class: "num", text: r.sold_per != null ? fmtMoney(+r.sold_per) : num(r.quantity) ? fmtMoney(num(r.total_sale) / num(r.quantity)) : "—" }),
        h("td", { class: `num ${num(r.profit) < 0 ? "down" : "up"}`, text: signed(num(r.profit)) }))))),
      rows.length > list.length ? h("div", { class: "muted small", text: `Newest ${list.length} of ${rows.length} shown.` }) : "");
  }
  function bookBlock(label, source, rows, e) {
    const st = stats(rows);
    if (!st) return h("div", { class: "book" }, h("div", { class: "history-head" }, h("b", { class: "small", text: label }), h("span", { class: "muted small", text: source })), h("div", { class: "muted small", text: "Never sold." }));
    const v = verdict(st);
    const city = lc((e.city || "").split(",")[0]), venue = lc(e.venue);
    const local = stats(rows.filter((r) => (venue && lc(r.venue) === venue) || (city && lc(r.city || "").startsWith(city))));
    const venues = [...new Set(rows.map((r) => r.venue).filter(Boolean))].slice(0, 3).join(", ");
    return h("div", { class: "book" },
      h("div", { class: "history-head" }, h("b", { class: "small", text: label }), h("span", { class: "muted small", text: source }), h("span", { class: `pill ${v.c}`, text: v.t })),
      h("div", { class: `small ${st.profit < 0 ? "down" : st.roi >= 0.2 ? "up" : ""}`, text: statLine(st) }),
      h("div", { class: "small", text: priceLine(st) }),
      local && local.n !== st.n ? h("div", { class: "small", text: `At this venue/city: ${statLine(local)}` }) : local ? h("div", { class: "muted small", text: "All of these were at this venue/city." }) : h("div", { class: "muted small", text: `Not sold here before${venues ? ` (sold at ${venues})` : ""}.` }),
      h("details", {}, h("summary", { class: "small", text: `See each sale (${st.n})` }), salesTable(rows)));
  }
  function holdingBlock(names) {
    const ks = (names || []).map(lc).filter(Boolean), today = todayISO();
    const rows = inv.filter((p) => p.remaining_qty > 0 && (!p.event_date || p.event_date >= today) && ks.some((k) => [p.discord_artist, p.artist].some((n) => n && sameName(lc(n), k))));
    if (!rows.length) return "";
    const qty = rows.reduce((t, p) => t + num(p.remaining_qty), 0);
    return h("div", { class: "book" },
      h("div", { class: "history-head" }, h("b", { class: "small", text: "You hold now" }), h("span", { class: "muted small", text: "your inventory" }), h("span", { class: "pill warn", text: `${fmtInt(qty)} tix` })),
      rows.slice(0, 6).map((p) => h("div", { class: "small", text: `${p.event_date ? fmtDate(p.event_date) : "Date?"} · ${p.venue || ""} · ${seat(p)} · ${fmtInt(p.remaining_qty)} left${p.cost_per != null ? ` · bought ${fmtMoney(+p.cost_per)} ea` : ""}` })));
  }
  function history(e) {
    const names = e.artists && e.artists.length ? e.artists : [e.event_name];
    const mine = rowsFor(sales, names), company = rowsFor(plt, names), hold = holdingBlock(names);
    if (!mine.length && !company.length && !hold) return h("div", { class: "history muted small", text: "No history: neither you nor PLT has sold this artist." });
    return h("div", { class: "history" },
      hold,
      bookBlock("Your sales", "#danielbehnam-sales", mine, e),
      bookBlock("PLT sales", "#plt-sales, company-wide", company, e));
  }
  const pillFor = (a) => {
    const hq = matchName(held, a), st = stats(pastSales([a])), ps = stats(rowsFor(plt, [a]));
    const tip = [hq ? `You hold ${hq} tickets` : "", st ? `Your sales: ${statLine(st)}. ${priceLine(st)}` : "", ps ? `PLT sales: ${statLine(ps)}. ${priceLine(ps)}` : ""].filter(Boolean).join("\n");
    const c = hq ? "warn" : st ? (st.profit < 0 ? "bad" : "good") : "";
    return h("span", { class: `pill ${c}`, title: tip }, a, hq ? ` · ${hq} held` : "", st ? ` · you ${pct(st.roi)}` : "", ps ? ` · PLT ${pct(ps.roi)}` : "");
  };

  async function setFlag(e, field, value) {
    const { error } = await sb.from("deal_emails").update({ [field]: value }).eq("id", e.id);
    if (error) return toast(niceError(error), "error");
    e[field] = value; mode === "deals" ? (paintDeals(), paintCash()) : mode === "signups" ? paintSignups() : paint();
  }
  const copy = (code) => h("button", { type: "button", class: "code", title: "Copy code", onclick: async () => { try { await navigator.clipboard.writeText(code); toast(`Copied ${code}`, "ok"); } catch { toast("Couldn't copy. Select the code instead.", "error"); } } }, code);

  function item(e) {
    const u = e.starts_at && e.kind !== "news" ? until(e.starts_at) : null;
    const flags = (e.artists || []).map(pillFor);
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
        /^https?:\/\//i.test(e.link || "")
          ? h("a", { class: "btn small primary", href: e.link, target: "_blank", rel: "noopener noreferrer", title: "Open the show page from this email", text: "Show page ↗" })
          : h("a", { class: "btn small", href: `https://www.google.com/search?q=${encodeURIComponent([(e.artists || [])[0] || e.subject, e.sender_name, "tickets"].filter(Boolean).join(" "))}`, target: "_blank", rel: "noopener noreferrer", title: "No show link in this email yet, so this searches for it", text: "Find show ↗" }),
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
      mine: ["Your artists", (e) => !e.done && !SIDE.has(e.kind) && (e.artists || []).some((a) => matchName(held, a) || matchName(sold, a))],
      all: ["Everything", (e) => !SIDE.has(e.kind) && (Date.parse(e.received_at) > recent || e.pinned)],
      done: ["Done", (e) => e.done && !SIDE.has(e.kind)],
    };
    const [, pick] = tabs[UI.tab];
    const list = applySort(emails.filter(pick), "presales", (a, b) =>
      (b.pinned - a.pinned) || (["presale", "onsale"].includes(UI.tab) ? (Date.parse(a.starts_at || "2999-01-01") - Date.parse(b.starts_at || "2999-01-01")) : (Date.parse(b.received_at) - Date.parse(a.received_at))));
    listBox.replaceChildren(
      h("div", { class: "seg", role: "group", "aria-label": "Show" }, Object.entries(tabs).map(([k, [t, f]]) =>
        h("button", { type: "button", class: UI.tab === k ? "on" : "", onclick: () => { UI.tab = k; UI.show = 60; paint(); } }, `${t} ${fmtInt(emails.filter(f).length)}`))), h("div", { class: "list-sort" }, sortMenu("presales", paint, NO_DISC)),
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

  // ---------- deals ----------
  const SITES = { ticketmaster: "Ticketmaster", axs: "AXS", seatgeek: "SeatGeek", livenation: "Live Nation", etix: "Etix", eventbrite: "Eventbrite", dice: "DICE", paciolan: "Paciolan", venue: "venue site", other: "ticket site" };
  const siteOf = (e) => {
    if (e.buy_site && SITES[e.buy_site]) return SITES[e.buy_site];
    try { const host = new URL(e.buy_link).hostname; const k = Object.keys(SITES).find((x) => host.includes(x)); return k ? SITES[k] : host.replace(/^www\./, ""); } catch { return "ticket site"; }
  };
  const ok = (u) => /^https?:\/\//i.test(u || "");
  function dealCard(e) {
    const left = e.ends_at ? Date.parse(e.ends_at) - Date.now() : null;
    const ends = e.ends_at ? (left < 0 ? { t: "Ended", c: "muted" } : left < 48 * 3600000 ? { t: `Ends ${until(e.ends_at).text.replace("in ", "in ")}`, c: "down" } : { t: `Ends ${when.format(new Date(e.ends_at))}`, c: "" }) : { t: "No end date given", c: "muted" };
    const title = e.event_name || (e.artists || [])[0] || e.subject;
    const where = [e.venue, e.city].filter(Boolean).join(", ");
    return h("article", { class: `offer ${e.pinned ? "pinned" : ""} ${e.done ? "is-done" : ""}` },
      h("div", { class: "offer-hit" }, h("b", { text: e.discount || "Offer" }), h("span", { class: `small ${ends.c}`, text: ends.t })),
      h("div", { class: "offer-body" },
        h("div", { class: "offer-title" }, h("b", { text: title })),
        h("div", { class: "muted small", text: [where, e.event_dates].filter(Boolean).join(" · ") || e.sender_name || "" }),
        e.summary ? h("div", { class: "small", text: e.summary }) : "",
        e.buy_note ? h("div", { class: "small meh", text: e.buy_note }) : "",
        history(e),
        (e.codes || []).length ? h("div", { class: "deal-tags" }, h("span", { class: "muted small", text: "Code" }), (e.codes || []).map(copy)) : h("div", { class: "muted small", text: "No code needed" })),
      h("div", { class: "deal-actions" },
        ok(e.buy_link) ? h("a", { class: "btn small primary", href: e.buy_link, target: "_blank", rel: "noopener noreferrer", text: `Buy on ${siteOf(e)} ↗` })
          : h("a", { class: "btn small", href: `https://www.ticketmaster.com/search?q=${encodeURIComponent([title, e.city].filter(Boolean).join(" "))}`, target: "_blank", rel: "noopener noreferrer", title: "No event page found yet, so this searches Ticketmaster", text: "Search Ticketmaster ↗" }),
        ok(e.link) ? h("a", { class: "btn small ghost", href: e.link, target: "_blank", rel: "noopener noreferrer", title: "The offer link from the email", text: "Offer ↗" }) : "",
        h("a", { class: "btn small ghost", href: `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAILBOX)}#all/${encodeURIComponent(e.gmail_id)}`, target: "_blank", rel: "noopener noreferrer", text: "Email" }),
        h("button", { type: "button", class: "star", "aria-pressed": String(e.pinned), "aria-label": e.pinned ? "Unpin" : "Pin", text: e.pinned ? "★" : "☆", onclick: () => setFlag(e, "pinned", !e.pinned) }),
        h("button", { type: "button", class: "small ghost", text: e.done ? "Undo" : "Done", onclick: () => setFlag(e, "done", !e.done) })));
  }
  const dealBox = h("div");
  // ---------- Concert Cash (credit codes that work like gift cards) ----------
  const isCash = (e) => /concert\s*cash/i.test(`${e.discount || ""} ${e.event_name || ""}`);
  const cashBox = h("div");
  const cashValue = (e) => { const m = /\$\s*([\d,.]+)/.exec(e.discount || ""); const per = m ? +m[1].replace(/,/g, "") : 0; return per * Math.max(1, (e.codes || []).length); };
  function paintCash() {
    const now = Date.now(), all = emails.filter((e) => e.kind === "deal" && isCash(e));
    const open = all.filter((e) => !e.done && (!e.ends_at || Date.parse(e.ends_at) > now));
    const total = open.reduce((t, e) => t + cashValue(e), 0);
    const shown = open.sort((a, b) => Date.parse(a.ends_at || "2999-01-01") - Date.parse(b.ends_at || "2999-01-01"));
    cashBox.replaceChildren(
      h("p", { class: "small" }, open.length ? `${fmtMoney(total)} unused across ${fmtInt(open.reduce((t, e) => t + Math.max(1, (e.codes || []).length), 0))} code(s).` : "No unused Concert Cash right now. New codes show up here automatically."),
      shown.length ? h("div", { class: "offer-list mt" }, shown.map(dealCard)) : "",
      all.length > open.length ? h("details", { class: "mt" }, h("summary", { class: "small", text: `Used or expired (${all.length - open.length})` }), h("div", { class: "offer-list mt" }, all.filter((e) => !open.includes(e)).map(dealCard))) : "");
  }
  function paintDeals() {
    const now = Date.now(), live = (e) => !e.ends_at || Date.parse(e.ends_at) > now;
    const deals = emails.filter((e) => e.kind === "deal" && !isCash(e));
    const tabs = {
      active: ["Active", (e) => !e.done && live(e)],
      soon: ["Ending in 48h", (e) => !e.done && e.ends_at && Date.parse(e.ends_at) > now && Date.parse(e.ends_at) < now + 48 * 3600000],
      mine: ["Your artists", (e) => !e.done && live(e) && (e.artists || []).some((a) => matchName(held, a) || matchName(sold, a))],
      all: ["Last 30 days", (e) => Date.parse(e.received_at) > now - 30 * 86400000 || e.pinned],
      done: ["Done", (e) => e.done],
    };
    const [, pick] = tabs[UI.dtab];
    const list = applySort(deals.filter(pick), "deals", (a, b) => (b.pinned - a.pinned) || (Date.parse(a.ends_at || "2999-01-01") - Date.parse(b.ends_at || "2999-01-01")) || (Date.parse(b.received_at) - Date.parse(a.received_at)));
    dealBox.replaceChildren(
      h("div", { class: "seg", role: "group", "aria-label": "Show" }, Object.entries(tabs).map(([k, [t, f]]) =>
        h("button", { type: "button", class: UI.dtab === k ? "on" : "", onclick: () => { UI.dtab = k; UI.dshow = 40; paintDeals(); } }, `${t} ${fmtInt(deals.filter(f).length)}`))), h("div", { class: "list-sort" }, sortMenu("deals", paintDeals)),
      list.length ? h("div", { class: "offer-list mt" }, list.slice(0, UI.dshow).map(dealCard)) :
        h("p", { class: "muted mt", text: deals.length ? "Nothing here right now." : "No deals yet. The inbox is scanned for discounts and promo codes three times a day." }),
      list.length > UI.dshow ? h("button", { type: "button", class: "mt", text: `Show more (${list.length - UI.dshow} left)`, onclick: () => { UI.dshow += 40; paintDeals(); } }) : "");
  }

  // ---------- presale sign-ups ----------
  const signBox = h("div");
  function paintSignups() {
    const now = Date.now(), open = (e) => !e.starts_at || Date.parse(e.ends_at || e.starts_at) > now - 6 * 3600000;
    const signs = emails.filter((e) => e.kind === "signup");
    const tabs = {
      open: ["Open", (e) => !e.done && open(e)],
      soon: ["Closing in 48h", (e) => !e.done && e.starts_at && Date.parse(e.starts_at) > now && Date.parse(e.starts_at) < now + 48 * 3600000],
      mine: ["Your artists", (e) => !e.done && open(e) && (e.artists || []).some((a) => matchName(held, a) || matchName(sold, a))],
      all: ["Last 30 days", (e) => Date.parse(e.received_at) > now - 30 * 86400000 || e.pinned],
      done: ["Done", (e) => e.done],
    };
    const [, pick] = tabs[UI.stab];
    const list = applySort(signs.filter(pick), "signups", (a, b) => (b.pinned - a.pinned) || (Date.parse(a.starts_at || "2999-01-01") - Date.parse(b.starts_at || "2999-01-01")) || (Date.parse(b.received_at) - Date.parse(a.received_at)));
    signBox.replaceChildren(
      h("div", { class: "seg", role: "group", "aria-label": "Show" }, Object.entries(tabs).map(([k, [t, f]]) =>
        h("button", { type: "button", class: UI.stab === k ? "on" : "", onclick: () => { UI.stab = k; UI.sshow = 60; paintSignups(); } }, `${t} ${fmtInt(signs.filter(f).length)}`))), h("div", { class: "list-sort" }, sortMenu("signups", paintSignups, NO_DISC)),
      list.length ? h("div", { class: "deal-list mt" }, list.slice(0, UI.sshow).map(item)) :
        h("p", { class: "muted mt", text: signs.length ? "Nothing here right now." : "No presale sign-ups yet. Emails asking you to register for a presale land here." }),
      list.length > UI.sshow ? h("button", { type: "button", class: "mt", text: `Show more (${list.length - UI.sshow} left)`, onclick: () => { UI.sshow += 60; paintSignups(); } }) : "");
  }

  const card = (title, body, note) => h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title", text: title })), body, note ? h("p", { class: "note-line", text: note }) : "");
  if (mode === "deals") {
    const activeN = emails.filter((e) => e.kind === "deal" && !isCash(e) && !e.done && (!e.ends_at || Date.parse(e.ends_at) > Date.now())).length;
    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {},
        h("h1", { text: "Deals" }),
        h("p", { class: "sub", text: `Discounts, promo codes, BOGO and free-ticket offers from ${MAILBOX}, with the Ticketmaster, AXS or SeatGeek page to use them on. ${fmtInt(activeN)} active.` }))),
      h("div", { class: "stack" },
        card("Concert Cash", cashBox, "Live Nation / Ticketmaster Concert Cash codes found in your emails. Each code works like a gift card: one code per order, at Ticketmaster checkout under \"+ Add Credits / Promo Codes / Gift Codes\", on Live Nation-promoted shows. Tap a code to copy it, and tap Done once it's used."),
        card("Ticket deals", dealBox, "Scanned three times a day. Sorted by which ends first. Each deal shows past results for that artist in two separate books, Your sales (#danielbehnam-sales) and PLT sales (#plt-sales): profit, ROI, average bought and sold price per ticket, and every sale with its section and row. Tap a code to copy it.")));
    paintDeals();
    paintCash();
    arrange(root, "deals2");
    return;
  }
  if (mode === "signups") {
    const openN = emails.filter((e) => e.kind === "signup" && !e.done && (!e.starts_at || Date.parse(e.ends_at || e.starts_at) > Date.now() - 6 * 3600000)).length;
    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {},
        h("h1", { text: "Signups" }),
        h("p", { class: "sub", text: `Presales you have to register for first (artist presale sign-ups, Verified Fan, Seated), pulled out of ${MAILBOX}. ${fmtInt(openN)} open.` }))),
      h("div", { class: "stack" },
        card("Presale sign-ups", signBox, "Sorted by the date in the email (sign-up deadline or presale start). Once you've registered, tap Done. Yellow means you hold tickets for that artist; sold artists show your ROI (green made money, red lost money)."),
        card("Sign up for more presales", trackerBox, "Only places that aren't emailing you yet are listed. Live Nation, Ticketmaster, AEG, Goldenvoice, Bowery, AXS, SeatGeek, Bandsintown, MSG, Barclays, MetLife and others already are.")));
    trackerBox.replaceChildren(tracker());
    paintSignups();
    arrange(root, "signups");
    return;
  }
  const upcoming = emails.filter((e) => !e.done && e.kind === "presale" && e.starts_at && Date.parse(e.starts_at) > Date.now() && Date.parse(e.starts_at) < Date.now() + 48 * 3600000).length;
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {},
      h("h1", { text: "Presales" }),
      h("p", { class: "sub", text: `Presale codes and on-sales pulled out of ${MAILBOX}.${upcoming ? ` ${upcoming === 1 ? "1 presale starts" : `${upcoming} presales start`} in the next 48 hours.` : ""}` }))),
    h("div", { class: "stack" },
      card("Presales and on-sales", listBox, "Sorted every few hours. Presales you have to register for first are on the Signups page. Artists you hold tickets for are marked in yellow; ones you've sold show your ROI (green made money, red lost money; hover for details). Tap a code to copy it.")));
  paint();
  arrange(root, "deals");
}
