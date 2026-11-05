import { sb, h, CONFIG, fmtMoney, fmtInt, fmtDate, fmtPct, signClass, toast, modal, copyText, niceError } from "./common.js";
import { parseSalePosts } from "./parse.js";

export async function renderDiscord(root) {
  const [countRes, recentRes, runsRes, keysRes] = await Promise.all([
    sb.from("sales").select("id", { count: "exact", head: true }),
    sb.from("sales").select("artist,venue,event_date,quantity,total_sale,profit,roi,sold_date,source,created_at").order("created_at", { ascending: false }).limit(15),
    sb.from("sync_runs").select("source,received,added,created_at").eq("kind", "sales").order("created_at", { ascending: false }).limit(10),
    sb.from("sync_keys").select("id,label,key_hint,created_at,last_used_at,revoked_at").order("created_at", { ascending: false }),
  ]);
  for (const r of [countRes, recentRes, runsRes, keysRes]) if (r.error) throw r.error;
  const runs = runsRes.data, keys = keysRes.data, last = runs[0];
  const activeKeys = keys.filter((k) => !k.revoked_at);
  const lastUsed = activeKeys.map((k) => k.last_used_at).filter(Boolean).sort().at(-1);

  const tile = (label, value, foot) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value num", text: value }), foot ? h("div", { class: "foot", text: foot }) : null);
  const ago = (iso) => { if (!iso) return "never"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };

  // ---------- extension connection ----------
  const keyList = h("div", {});
  const paintKeys = () => keyList.replaceChildren(
    activeKeys.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Name", "Key ends", "Created", "Last used", ""].map((t) => h("th", { text: t })))),
      h("tbody", {}, activeKeys.map((k) => h("tr", {}, h("td", { text: k.label }), h("td", { class: "num", text: k.key_hint }),
        h("td", { text: new Date(k.created_at).toLocaleDateString() }), h("td", { text: ago(k.last_used_at) }),
        h("td", { class: "r" }, h("button", { class: "danger icon", type: "button", onclick: async () => {
          if (!confirm(`Disconnect “${k.label}”? The extension using it will stop syncing.`)) return;
          const { error } = await sb.rpc("revoke_sync_key", { p_id: k.id });
          if (error) return toast(niceError(error), "error");
          toast("Key revoked", "ok"); renderDiscord(root);
        } }, "Revoke")))))))
      : h("p", { class: "muted small", text: "No extension connected yet." }));
  paintKeys();

  const newKeyBtn = h("button", { class: "primary", type: "button" }, "＋ Create sync key");
  newKeyBtn.onclick = async () => {
    const label = prompt("Name this key (e.g. “Home laptop Chrome”)", "Chrome extension");
    if (label == null) return;
    const { data: key, error } = await sb.rpc("create_sync_key", { p_label: label });
    if (error) return toast(niceError(error), "error");
    const setup = JSON.stringify({ url: CONFIG.supabaseUrl, publicKey: CONFIG.supabaseKey, syncKey: key });
    modal("Your sync key", h("div", {},
      h("p", { class: "small", text: "Paste this into the extension's settings. It's shown only once: if you lose it, just create a new one and revoke the old one." }),
      h("div", { class: "keybox", text: key }),
      h("p", { class: "small muted mt", text: "Or copy the full setup (hub address + key) in one go:" })),
      (close) => [h("button", { type: "button", onclick: () => copyText(key, "Key copied") }, "Copy key"),
        h("button", { type: "button", onclick: () => copyText(setup, "Setup copied") }, "Copy full setup"),
        h("span", { class: "spacer" }), h("button", { class: "primary", type: "button", onclick: () => { close(); renderDiscord(root); } }, "Done")]);
  };

  // ---------- manual paste import ----------
  const ta = h("textarea", { placeholder: "Paste one or more sale posts from #" + CONFIG.discordChannel + " here…", "aria-label": "Sale posts" });
  const preview = h("div", {});
  const parseBtn = h("button", { type: "button" }, "Read posts");
  parseBtn.onclick = () => {
    const recs = parseSalePosts(ta.value);
    if (!recs.length) { preview.replaceChildren(h("p", { class: "msg error", text: "I couldn't find any sales in that text. Each post needs lines like “Event: …”, “Qty: …”, “Total: …”." })); return; }
    const cols = [["artist", "Event"], ["event_date", "Date"], ["section", "Sec"], ["row", "Row"], ["quantity", "Qty"], ["total_sale", "Total"], ["total_cost", "Cost"], ["profit", "Profit"], ["sold_date", "Sold"], ["order_number", "Order #"]];
    const importBtn = h("button", { class: "primary", type: "button" }, `Add ${recs.length} sale${recs.length > 1 ? "s" : ""}`);
    importBtn.onclick = async () => {
      importBtn.disabled = true;
      const { data, error } = await sb.rpc("ingest_sales", { p_sales: recs });
      importBtn.disabled = false;
      if (error) return toast(niceError(error), "error");
      toast(`${data.added} new sales added${data.duplicates ? ` · ${data.duplicates} duplicates skipped` : ""}`, "ok");
      ta.value = ""; renderDiscord(root);
    };
    preview.replaceChildren(h("div", { class: "table-wrap mt" }, h("table", {},
      h("thead", {}, h("tr", {}, cols.map(([, t]) => h("th", { text: t })))),
      h("tbody", {}, recs.map((r) => h("tr", {}, cols.map(([k]) => h("td", { text: r[k] || "—" }))))))),
      h("div", { class: "row mt" }, h("span", { class: "muted small", text: "Duplicates are skipped automatically." }), h("span", { class: "spacer" }), importBtn));
  };

  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Discord Sales" }), h("div", { class: "sub", text: `Channel: #${CONFIG.discordChannel}` }))),
    h("div", { class: "grid kpis" },
      tile("Sales in hub", fmtInt(countRes.count), "duplicates never counted twice"),
      tile("Last sync", last ? ago(last.created_at) : "never", last ? `${fmtInt(last.added)} new sales added` : "waiting for first sync"),
      tile("Extension", activeKeys.length ? (lastUsed ? "Connected" : "Key created") : "Not connected", activeKeys.length ? `last seen ${ago(lastUsed)}` : "create a sync key below")),
    h("div", { class: "grid two mt" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "Recent syncs" })),
        runs.length ? h("ol", { class: "rank" }, runs.map((r) => h("li", {},
          h("span", { class: "n", text: r.source === "extension" ? "🧩" : "✍" }),
          h("div", { class: "name" }, h("div", { text: `${fmtInt(r.added)} new sales added` }), h("div", { class: "meta", text: `${fmtInt(r.received)} checked · ${r.source} · ${new Date(r.created_at).toLocaleString()}` })),
          h("span", { class: `pill ${r.added ? "good" : ""}`, text: r.added ? `+${r.added}` : "0" }))))
          : h("p", { class: "muted small", text: "No syncs yet." })),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "Chrome extension" }), h("span", { class: "spacer" }), newKeyBtn),
        h("ol", { class: "steps small" },
          h("li", { text: "Click “Create sync key” and copy it." }),
          h("li", { text: "Open the extension's settings and paste the key." }),
          h("li", { text: "Use “Sync all”, “Sync new”, or turn on “Live”, and sales land here automatically." })),
        h("div", { class: "mt" }, keyList))),
    h("div", { class: "card mt" },
      h("div", { class: "card-head" }, h("h2", { text: "Paste sale posts (backup)" })),
      h("p", { class: "muted small", text: "Copy sale messages from Discord and paste them here if the extension isn't available." }),
      ta, h("div", { class: "row mt" }, parseBtn), preview),
    h("div", { class: "card mt" },
      h("div", { class: "card-head" }, h("h2", { text: "Latest sales" }), h("span", { class: "spacer" }), h("a", { href: "#dashboard", text: "Open dashboard →" })),
      recentRes.data.length ? h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Event", "Date", "Venue", "Qty", "Total", "Profit", "ROI", "Sold", "Added"].map((t, i) => h("th", { class: [3, 4, 5, 6].includes(i) ? "r" : "", text: t })))),
        h("tbody", {}, recentRes.data.map((r) => h("tr", {},
          h("td", { text: r.artist || "—" }), h("td", { text: fmtDate(r.event_date) }), h("td", { text: r.venue || "—" }),
          h("td", { class: "r num", text: r.quantity ?? "—" }), h("td", { class: "r num", text: fmtMoney(Number(r.total_sale), true) }),
          h("td", { class: `r num ${signClass(Number(r.profit))}`, text: fmtMoney(Number(r.profit), true) }),
          h("td", { class: `r num ${signClass(Number(r.roi))}`, text: fmtPct(r.roi == null ? null : Number(r.roi)) }),
          h("td", { text: fmtDate(r.sold_date) }), h("td", { class: "muted", text: ago(r.created_at) }))))))
        : h("p", { class: "muted small", text: "No sales yet." })));
}
