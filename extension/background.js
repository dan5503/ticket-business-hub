// ALLPWST Discord Data: sends sales to your Business Hub.
// The sync key below can ONLY add sales to your hub. It cannot read your data or logins.
// You can revoke it any time on the hub's Discord Sales page.
const HUB_URL = 'https://dan5503.github.io/ticket-business-hub/';
const SB_URL = 'https://jhbhkjomjjbldlofuigt.supabase.co';
const SB_KEY = 'sb_publishable_gI0HfDMHu4JkdoO0w_dKbw_N5tz1hOC';
const SYNC_KEY = '__SYNC_KEY__'; // private: keep this extension to yourself

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith('https://discord.com/channels/')) {
    sheetSync(true).catch(() => {});
    chrome.tabs.create({ url: HUB_URL + 'app.html#inventory' });
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

/* ---------- inventory Google Sheet ----------
   Chrome is already signed in to the Google account that can see the sheet, so the extension downloads it
   (no sharing changes, no admin needed) and hands the CSV to the hub. Runs every 30 minutes while Chrome is open. */
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pushToHub(body) {
  const r = await fetch(SB_URL + '/functions/v1/sheet-sync', {
    method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'push', key: SYNC_KEY, ...body })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('Hub error ' + r.status));
  return d;
}
async function downloadSheet(exportUrl) {
  // try each signed-in Google account until one can see the sheet
  let last = '';
  for (const au of ['', '0', '1', '2', '3', '4', '5']) {
    const url = exportUrl + (au === '' ? '' : (exportUrl.includes('?') ? '&' : '?') + 'authuser=' + au);
    try {
      const r = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
      const type = r.headers.get('content-type') || '';
      if (r.ok && !type.includes('text/html')) return await r.text();
      last = r.status === 403 ? 'blocked' : (type.includes('text/html') ? 'signin' : 'http ' + r.status);
    } catch (e) { last = e.message; }
  }
  if (last === 'blocked') throw new Error('Google blocked the download. The sheet owner may have turned off downloading for viewers.');
  throw new Error("Couldn't open the sheet. Make sure Chrome is signed in to the Google account that can see it (" + last + ').');
}
let sheetBusy = false;
async function sheetSync(force = false) {
  if (sheetBusy) return { busy: true };
  sheetBusy = true;
  try {
    const t = await rpc('sheet_target_with_key', {});
    const target = Array.isArray(t) ? t[0] : t;
    if (!target || !target.export_url) return { skipped: 'No Google Sheet connected in the hub' };
    let csv;
    try { csv = await downloadSheet(target.export_url); }
    catch (e) { await pushToHub({ error: e.message }).catch(() => {}); throw e; }
    const hash = await sha(csv);
    const { sheetHash } = await chrome.storage.local.get('sheetHash');
    if (!force && hash === sheetHash) { await pushToHub({ unchanged: true }).catch(() => {}); return { changed: false }; }
    const res = await pushToHub({ csv });
    await chrome.storage.local.set({ sheetHash: hash, sheetSyncedAt: Date.now() });
    return res;
  } finally { sheetBusy = false; }
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sheet') sheetSync().catch(() => {}); });
const schedule = () => chrome.alarms.create('sheet', { delayInMinutes: 1, periodInMinutes: 30 });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);

const handlers = {
  async sheetSync() { return { result: await sheetSync(true) }; },
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

