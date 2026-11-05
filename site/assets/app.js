import { sb, $, $$, h, requireSession, startIdleTimer, toast, fmtMoney } from "./common.js";
import { renderDashboard } from "./dashboard.js";
import { renderInventory } from "./inventory.js";
import { renderDiscord } from "./discord.js";
import { renderLinks } from "./links.js";

await requireSession();
startIdleTimer(30);

$("#signout").onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };

const views = { dashboard: renderDashboard, inventory: renderInventory, discord: renderDiscord, links: renderLinks };
let cleanup = null;

async function route() {
  const name = views[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
  $$("nav.tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
  if (typeof cleanup === "function") cleanup();
  const root = $("#view");
  root.replaceChildren(h("div", { class: "empty" }, "Loading…"));
  try {
    cleanup = await views[name](root);
  } catch (err) {
    console.error(err);
    root.replaceChildren(h("div", { class: "card empty" }, h("h2", { text: "Couldn't load this page" }), h("p", { text: err.message || String(err) })));
  }
}
addEventListener("hashchange", route);
route();

// Live: when the extension adds a new sale, pop a notice and refresh the dashboard.
sb.channel("sales-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales" }, (p) => {
    const r = p.new || {};
    toast(`New sale: ${r.artist || "—"} · ${fmtMoney(Number(r.profit))} profit`, "ok");
    clearTimeout(window.__liveRefresh);
    window.__liveRefresh = setTimeout(() => { if (["", "#dashboard", "#discord"].includes(location.hash)) route(); }, 1500);
  })
  .subscribe();
