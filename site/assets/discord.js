import { sb, h, CONFIG, fmtMoney, fmtInt, fmtDate, fmtDateTime, fmtPct, signClass, toast, modal, copyText, niceError } from "./common.js";
import { parseSalePosts } from "./parse.js";
import { makeBoard } from "./layout.js";

const ago = (iso) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago` : new Date(iso).toLocaleDateString();
};

export async function renderDiscord(root) {
  const [countRes, recentRes, runsRes, keysRes] = await Promise.all([
    sb.from("sales").select("id", { count: "exact", head: true }),
    sb.from("sales").select("artist,venue,event_date,quantity,total_sale,profit,roi,sold_date,sold_at,marketplace,created_at").order("sold_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(15),
    sb.from("sync_runs").select("source,received,added,created_at").eq("kind", "sales").order("created_at", { ascending: false }).limit(10),
    sb.from("sync_keys").select("id,label,key_hint,created_at,last_used_at,revoked_at").order("created_at", { ascending: false }),
  ]);
  for (const r of [countRes, recentRes, runsRes, keysRes]) if (r.error) throw r.error;
  const runs = runsRes.data, last = runs[0];
  const activeKeys = keysRes.data.filter((k) => !k.revoked_at);
  const lastUsed = activeKeys.map((k) => k.last_used_at).filter(Boolean).sort().at(-1);
  const reload = () => renderDiscord(root);

  const stat = (label, value, foot) => h("div", { class: "stat" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }), h("div", { class: "foot", text: foot }));
  const overview = () => h("div", { class: "headline inv" },
    stat("Sales in your hub", fmtInt(countRes.count), "Duplicates are never counted twice"),
    stat("Last sync", last ? ago(last.created_at) : "Not yet", last ? `${fmtInt(last.added)} new sales added` : "Run “Sync All History” once"),
    stat("Extension", lastUsed ? "Connected" : activeKeys.length ? "Ready" : "Not connected", lastUsed ? `Last sent sales ${ago(lastUsed)}` : "Waiting for its first sync"),
    stat("Channel", `#${CONFIG.discordChannel}`, "Where your sale alerts post"));

  const extension = () => h("div", {},
    h("ol", { class: "steps" },
      h("li", { text: "Open #" + CONFIG.discordChannel + " on discord.com in Chrome." }),
      h("li", { text: "Click the ALLPWST Discord Data icon in Chrome's toolbar." }),
      h("li", { text: "First time: choose “Sync All History”. After that, “Sync New Sales”, or switch on Live so new sales arrive by themselves." })),
    h("h3", { class: "mt", text: "Connected extensions" }),
    activeKeys.length ? h("div", { class: "table-wrap mt" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Name", "Key ends in", "Added", "Last used", ""].map((t) => h("th", { text: t })))),
      h("tbody", {}, activeKeys.map((k) => h("tr", {}, h("td", { class: "strong", text: k.label }), h("td", { class: "num", text: k.key_hint }),
        h("td", { text: new Date(k.created_at).toLocaleDateString() }), h("td", { text: ago(k.last_used_at) }),
        h("td", { class: "r" }, h("button", { class: "danger icon", type: "button", onclick: async () => {
          if (!confirm(`Disconnect “${k.label}”? That extension will stop sending sales.`)) return;
          const { error } = await sb.rpc("revoke_sync_key", { p_id: k.id });
          if (error) return toast(niceError(error), "error");
          toast("Extension disconnected", "ok"); reload();
        } }, "Disconnect")))))))
      : h("p", { class: "muted small mt", text: "No extension connected." }),
    h("div", { class: "row mt" }, h("button", { type: "button", onclick: newKey }, "Connect another extension")));

  async function newKey() {
    const label = prompt("Name it (for example “Office laptop”)", "Chrome extension");
    if (label == null) return;
    const { data: key, error } = await sb.rpc("create_sync_key", { p_label: label });
    if (error) return toast(niceError(error), "error");
    modal("New sync key", h("div", {},
      h("p", { class: "small", text: "This key lets an extension add sales to your hub. It's shown only once. Send it to Claude to build a matching extension, or paste it into one yourself." }),
      h("div", { class: "keybox mt", text: key })),
      (close) => [h("button", { type: "button", onclick: () => copyText(key, "Key copied") }, "Copy key"), h("span", { class: "spacer" }),
        h("button", { class: "primary", type: "button", onclick: () => { close(); reload(); } }, "Done")]);
  }

  const syncs = () => runs.length
    ? h("ol", { class: "rank" }, runs.map((r) => h("li", {},
        h("div", { class: "name", text: r.added ? `${fmtInt(r.added)} new sale${r.added === 1 ? "" : "s"} added` : "No new sales" }),
        h("span", { class: `pill ${r.added ? "good" : ""}`, text: r.source === "extension" ? "Extension" : "Pasted" }),
        h("div", { class: "meta", text: `${fmtInt(r.received)} checked, ${new Date(r.created_at).toLocaleString()}` }))))
    : h("p", { class: "muted", text: "Nothing synced yet." });

  const latest = () => recentRes.data.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Event", "Show date", "Venue", "Tickets", "Total", "Profit", "ROI", "Sold at", "Sold on"].map((t, i) => h("th", { class: [3, 4, 5, 6].includes(i) ? "r" : "", text: t })))),
      h("tbody", {}, recentRes.data.map((r) => h("tr", {},
        h("td", { class: "strong", text: r.artist || "—" }), h("td", { text: fmtDate(r.event_date) }), h("td", { text: r.venue || "—" }),
        h("td", { class: "r num", text: r.quantity ?? "—" }), h("td", { class: "r num", text: fmtMoney(Number(r.total_sale), true) }),
        h("td", { class: `r num ${signClass(Number(r.profit))}`, text: fmtMoney(Number(r.profit), true) }),
        h("td", { class: `r num ${signClass(Number(r.roi))}`, text: fmtPct(r.roi == null ? null : Number(r.roi)) }),
        h("td", { class: "num", text: fmtDateTime(r.sold_at, r.sold_date) }), h("td", { text: r.marketplace || "—" }))))))
    : h("p", { class: "muted", text: "No sales yet." });

  function paste() {
    const ta = h("textarea", { placeholder: "Paste one or more sale posts here", "aria-label": "Sale posts" });
    const preview = h("div", {});
    const readBtn = h("button", { type: "button" }, "Read posts");
    readBtn.onclick = () => {
      const recs = parseSalePosts(ta.value);
      if (!recs.length) { preview.replaceChildren(h("p", { class: "msg error", text: "No sales found. Each post needs lines like “Event: …”, “Qty: …” and “Total: …”." })); return; }
      const cols = [["artist", "Event"], ["event_date", "Date"], ["section", "Section"], ["row", "Row"], ["quantity", "Tickets"], ["total_sale", "Total"], ["total_cost", "Cost"], ["profit", "Profit"], ["sold_date", "Sold"], ["order_number", "Order #"]];
      const addBtn = h("button", { class: "primary", type: "button" }, `Add ${recs.length} sale${recs.length > 1 ? "s" : ""}`);
      addBtn.onclick = async () => {
        addBtn.disabled = true;
        const { data, error } = await sb.rpc("ingest_sales", { p_sales: recs });
        addBtn.disabled = false;
        if (error) return toast(niceError(error), "error");
        toast(`${data.added} new sales added${data.duplicates ? `, ${data.duplicates} already in your hub` : ""}`, "ok");
        reload();
      };
      preview.replaceChildren(h("div", { class: "table-wrap mt" }, h("table", {},
        h("thead", {}, h("tr", {}, cols.map(([, t]) => h("th", { text: t })))),
        h("tbody", {}, recs.map((r) => h("tr", {}, cols.map(([k]) => h("td", { text: r[k] || "—" }))))))),
        h("div", { class: "row mt" }, h("span", { class: "muted small", text: "Sales already in your hub are skipped." }), h("span", { class: "spacer" }), addBtn));
    };
    return h("div", {}, ta, h("div", { class: "row mt" }, readBtn), preview);
  }

  const board = await makeBoard("discord", ["overview", "latest", "syncs", "extension", "paste"], {
    overview: { title: "Overview", bare: true, render: overview },
    latest: { title: "Latest sales", render: latest, actions: () => h("a", { class: "btn", href: "#dashboard" }, "Open Sales") },
    syncs: { title: "Recent syncs", render: syncs },
    extension: { title: "Chrome extension", hint: "The extension reads sale posts in the Discord tab you have open and sends them here. It never uses your Discord login.", render: extension },
    paste: { title: "Paste sale posts by hand", collapsed: true, hint: "A backup if the extension isn't available: copy posts from Discord and paste them below.", render: paste },
  });
  root.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", { text: "Discord" }), h("p", { class: "sub", text: `Sales from #${CONFIG.discordChannel}, sent by your Chrome extension.` }))),
    board.el);
}
