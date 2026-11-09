import { sb, h, toast, modal, copyText, niceError } from "./common.js";
import { loadPrefs, savePrefs } from "./layout.js";

const COLS = "id,title,url,category,description,icon,sort_order,has_login";
const revealCache = new Map(); // id -> {username,password,at}

async function reveal(id) {
  const c = revealCache.get(id);
  if (c && Date.now() - c.at < 30000) return c;
  const { data, error } = await sb.rpc("reveal_link_login", { p_link_id: id });
  if (error) throw error;
  const v = { ...(data[0] || {}), at: Date.now() };
  revealCache.set(id, v);
  setTimeout(() => revealCache.delete(id), 30000);
  return v;
}

export async function renderLinks(root) {
  const { data: links, error } = await sb.from("hub_links").select(COLS).order("category").order("sort_order").order("title");
  if (error) throw error;
  const prefs = await loadPrefs();
  const lp = (prefs.links ||= { cats: [] });
  let q = "";
  const search = h("input", { type: "search", placeholder: "Search sites…", "aria-label": "Search sites", class: "grow" });
  const listEl = h("div", {});
  search.oninput = () => { q = search.value.toLowerCase(); paint(); };

  function paint() {
    const shown = links.filter((l) => !q || [l.title, l.url, l.category, l.description].some((v) => (v || "").toLowerCase().includes(q)));
    if (!links.length) { listEl.replaceChildren(h("div", { class: "card empty" }, h("h2", { text: "Add your first site" }), h("p", { text: "Save links to all your sites and tools, with optional logins that stay encrypted." }))); return; }
    const groups = new Map();
    shown.forEach((l) => { const k = l.category || "Other"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
    const cats = [...groups.keys()], pos = (c) => { const i = lp.cats.indexOf(c); return i < 0 ? 999 + cats.indexOf(c) : i; };
    const ordered = [...groups].sort((a, b) => pos(a[0]) - pos(b[0]));
    const moveCat = (cat, dir) => {
      const list = ordered.map(([c]) => c), i = list.indexOf(cat), j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      lp.cats = [...list, ...lp.cats.filter((c) => !list.includes(c))]; savePrefs(); paint();
    };
    listEl.replaceChildren(...ordered.flatMap(([cat, ls], i) => [
      h("div", { class: "cat-row" }, h("div", { class: "cat-title", text: cat }), h("span", { class: "spacer" }),
        q ? "" : h("div", { class: "mover arr" },
          h("button", { type: "button", class: "mv", title: "Move group up", "aria-label": `Move ${cat} up`, disabled: i === 0, onclick: () => moveCat(cat, -1) }, "↑"),
          h("button", { type: "button", class: "mv", title: "Move group down", "aria-label": `Move ${cat} down`, disabled: i === ordered.length - 1, onclick: () => moveCat(cat, +1) }, "↓"))),
      h("div", { class: "cards" }, ls.map((l, j) => card(l, q ? null : { first: j === 0, last: j === ls.length - 1, move: (dir) => moveSite(ls, l, dir) })))]));
  }

  // swap two sites inside a group and save their order
  async function moveSite(ls, l, dir) {
    const i = ls.indexOf(l), j = i + dir;
    if (j < 0 || j >= ls.length) return;
    const list = [...ls]; [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, k) => (x.sort_order = k));
    links.sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    paint();
    const res = await Promise.all(list.map((x, k) => sb.from("hub_links").update({ sort_order: k }).eq("id", x.id)));
    if (res.some((r) => r.error)) toast("Couldn't save the new order", "error");
  }

  function card(l, mv) {
    let host = ""; try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch {}
    const credBox = l.has_login ? credentials(l) : null;
    return h("div", { class: "lcard" },
      h("div", { class: "top" }, h("div", { class: "ico", text: l.icon || (l.title[0] || "?").toUpperCase() }),
        h("div", { class: "grow", style: { minWidth: "0" } }, h("div", { class: "t", text: l.title }), h("div", { class: "host", text: host }))),
      l.description ? h("div", { class: "desc", text: l.description }) : null,
      credBox,
      h("div", { class: "actions" },
        h("a", { class: "btn primary", href: l.url, target: "_blank", rel: "noopener noreferrer" }, "Open site"),
        h("span", { class: "spacer" }),
        mv ? h("div", { class: "mover arr" },
          h("button", { type: "button", class: "mv", title: "Move left", "aria-label": `Move ${l.title} left`, disabled: mv.first, onclick: () => mv.move(-1) }, "←"),
          h("button", { type: "button", class: "mv", title: "Move right", "aria-label": `Move ${l.title} right`, disabled: mv.last, onclick: () => mv.move(+1) }, "→")) : "",
        h("button", { class: "ghost icon", type: "button", "aria-label": `Edit ${l.title}`, onclick: () => editLink(l) }, "Edit")));
  }

  function credentials(l) {
    const userV = h("span", { class: "v", text: "••••••••" }), passV = h("span", { class: "v", text: "••••••••" });
    let timer;
    const line = (label, el, field) => {
      const btnR = h("button", { class: "ghost", type: "button" }, "Reveal");
      btnR.onclick = async () => {
        if (btnR.textContent === "Hide") { el.textContent = "••••••••"; btnR.textContent = "Reveal"; return; }
        try {
          const v = await reveal(l.id);
          el.textContent = v[field] || "(none)"; btnR.textContent = "Hide";
          clearTimeout(timer); timer = setTimeout(() => { userV.textContent = passV.textContent = "••••••••"; credBox.querySelectorAll("button.ghost").forEach((b) => (b.textContent = "Reveal")); }, 20000);
        } catch (e) { toast(niceError(e), "error"); }
      };
      const btnC = h("button", { type: "button", onclick: async () => {
        try { const v = await reveal(l.id); if (!v[field]) return toast("Nothing saved", "error"); copyText(v[field], `${label} copied`); } catch (e) { toast(niceError(e), "error"); }
      } }, "Copy");
      return h("div", { class: "line" }, h("span", { class: "k", text: label }), el, btnR, btnC);
    };
    const credBox = h("div", { class: "cred" }, line("Username", userV, "username"), line("Password", passV, "password"));
    return credBox;
  }

  function editLink(l) {
    const isNew = !l;
    l = l || { title: "", url: "https://", category: "", description: "", icon: "", has_login: false };
    const cats = [...new Set(links.map((x) => x.category).filter(Boolean))];
    const f = {
      title: h("input", { id: "l-title", value: l.title, maxlength: "80", required: true }),
      url: h("input", { id: "l-url", type: "url", value: l.url, required: true }),
      category: h("input", { id: "l-cat", value: l.category || "", list: "l-cats", maxlength: "40", placeholder: "e.g. Selling, Buying, Tools" }),
      icon: h("input", { id: "l-icon", value: l.icon || "", maxlength: "4", placeholder: "Emoji, e.g. 🎟" }),
      description: h("input", { id: "l-desc", value: l.description || "", maxlength: "200" }),
      username: h("input", { id: "l-user", autocomplete: "off", placeholder: l.has_login ? "Leave blank to keep current" : "" }),
      password: h("input", { id: "l-pass", type: "password", autocomplete: "new-password", placeholder: l.has_login ? "Leave blank to keep current" : "" }),
      clear: h("input", { id: "l-clear", type: "checkbox" }),
    };
    if (l.has_login) reveal(l.id).then((v) => { if (v.username) f.username.value = v.username; f.username.placeholder = ""; }).catch(() => {});
    const field = (id, label, el) => h("div", {}, h("label", { for: id, text: label }), el);
    modal(isNew ? "Add a site" : `Edit ${l.title}`, h("div", {},
      field("l-title", "Name", f.title), field("l-url", "Web address", f.url),
      h("div", { class: "row" }, h("div", { class: "grow" }, field("l-cat", "Category", f.category)), h("div", { style: { width: "120px" } }, field("l-icon", "Icon", f.icon))),
      h("datalist", { id: "l-cats" }, cats.map((c) => h("option", { value: c }))),
      field("l-desc", "Short description (optional)", f.description),
      h("h3", { class: "mt", text: "Saved login (optional, encrypted)" }),
      field("l-user", "Username / email", f.username), field("l-pass", "Password", f.password),
      l.has_login ? h("label", { class: "check" }, f.clear, "Remove the saved login") : null),
      (close) => [
        !isNew ? h("button", { class: "danger", type: "button", onclick: async () => {
          if (!confirm(`Delete “${l.title}”?`)) return;
          const { error } = await sb.from("hub_links").delete().eq("id", l.id);
          if (error) return toast(niceError(error), "error");
          close(); toast("Deleted", "ok"); renderLinks(root);
        } }, "Delete") : null,
        h("span", { class: "spacer" }),
        h("button", { type: "button", onclick: close }, "Cancel"),
        h("button", { class: "primary", type: "button", onclick: async (e) => {
          const row = { title: f.title.value.trim(), url: f.url.value.trim(), category: f.category.value.trim() || null, icon: f.icon.value.trim() || null, description: f.description.value.trim() || null };
          if (!row.title) return toast("Give it a name", "error");
          if (!/^https?:\/\/.+/i.test(row.url)) return toast("The web address must start with https://", "error");
          e.target.disabled = true;
          let id = l.id;
          if (isNew) {
            const { data, error } = await sb.from("hub_links").insert(row).select("id").single();
            if (error) { e.target.disabled = false; return toast(niceError(error), "error"); }
            id = data.id;
          } else {
            const { error } = await sb.from("hub_links").update(row).eq("id", id);
            if (error) { e.target.disabled = false; return toast(niceError(error), "error"); }
          }
          const u = f.username.value, p = f.password.value;
          let r = null;
          if (f.clear.checked) r = await sb.rpc("set_link_login", { p_link_id: id, p_username: "", p_password: "", p_update_password: true });
          else if (u || p || l.has_login) r = await sb.rpc("set_link_login", { p_link_id: id, p_username: u, p_password: p, p_update_password: p !== "" || !l.has_login });
          if (r && r.error) { e.target.disabled = false; return toast(niceError(r.error), "error"); }
          revealCache.delete(id);
          close(); toast("Saved", "ok"); renderLinks(root);
        } }, "Save")]);
  }

  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "My Sites" }), h("p", { class: "sub", text: "Your websites and tools. Saved logins are encrypted and stay hidden until you click Reveal." })),
      h("span", { class: "spacer" }), h("button", { class: "primary", type: "button", onclick: () => editLink(null) }, "Add a site")),
    h("div", { class: "row" }, search), listEl);
  paint();
}
