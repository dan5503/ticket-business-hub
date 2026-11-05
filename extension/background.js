// ALLPWST Discord Data: sends sales to your Business Hub.
// The sync key below can ONLY add sales to your hub. It cannot read your data or logins.
// You can revoke it any time on the hub's Discord Sales page.
const HUB_URL = 'https://dan5503.github.io/ticket-business-hub/';
const SB_URL = 'https://jhbhkjomjjbldlofuigt.supabase.co';
const SB_KEY = 'sb_publishable_gI0HfDMHu4JkdoO0w_dKbw_N5tz1hOC';
const SYNC_KEY = '__SYNC_KEY__'; // private: keep this extension to yourself

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith('https://discord.com/channels/')) {
    chrome.tabs.create({ url: HUB_URL + 'app.html#discord' });
    return;
  }
  try { await chrome.tabs.sendMessage(tab.id, { type: 'toggle' }); }
  catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {}), 300);
  }
});

async function rpc(fn, body) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: SYNC_KEY, ...body })
  });
  const text = await r.text();
  if (!r.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch (e) {} throw new Error('Hub: ' + m.slice(0, 200)); }
  return text ? JSON.parse(text) : null;
}

const handlers = {
  // book 'plt' = company channel (#plt-sales), kept completely separate from your own sales
  async send({ rows, book }) { const res = await rpc(book === 'plt' ? 'ingest_plt_with_key' : 'ingest_sales_with_key', { p_sales: rows }); return { result: res }; },
  async existing({ ids, book }) { if (!ids.length) return { ids: [] }; const d = await rpc(book === 'plt' ? 'existing_plt_with_key' : 'existing_sales_with_key', { p_ids: ids }); return { ids: d || [] }; },
  async status() { return { result: await rpc('sync_status_with_key', {}) }; },
  async openHub() { chrome.tabs.create({ url: HUB_URL + 'app.html#dashboard' }); return {}; }
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg.type];
  if (!h) return;
  h(msg).then(r => reply({ ok: true, ...r })).catch(e => reply({ ok: false, error: e.message }));
  return true;
});
