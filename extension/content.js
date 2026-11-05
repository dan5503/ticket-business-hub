// ALLPWST Discord Data - in-page panel on discord.com (reads the page you have open; never uses your Discord login)
(() => {
  if (window.__salesExporter) return; window.__salesExporter = true;
  const CHANNEL = 'danielbehnam-sales';
  const BATCH = 100;
  let busy = false, stopFlag = false, observer = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const onChannel = () => document.title.toLowerCase().includes(CHANNEL);
  const store = {
    get: def => new Promise(r => chrome.storage.local.get(def, r)),
    set: obj => new Promise(r => chrome.storage.local.set(obj, r))
  };
  const getSent = async () => new Set((await store.get({ sentIds: [] })).sentIds);
  const saveSent = set => store.set({ sentIds: [...set] });

  // ================= PANEL =================
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:70px;right:24px;z-index:2147483646;display:none';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const icon = chrome.runtime.getURL('icon48.png');
  root.innerHTML = `
  <style>
    *{box-sizing:border-box;font-family:'gg sans','Noto Sans',Arial,sans-serif}
    .p{width:300px;background:#1e1f22;color:#dbdee1;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px #000a;border:1px solid #2b2d31}
    .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(120deg,#5846e6,#7c4dff 40%,#22c55e 80%,#facc15);color:#fff;cursor:move;user-select:none}
    .hd img{width:26px;height:26px;border-radius:7px;box-shadow:0 1px 4px #0005}
    .hd b{flex:1;font-size:15px}.x{cursor:pointer;font-size:18px;opacity:.85;padding:0 4px}.x:hover{opacity:1}
    .bd{padding:12px 14px}
    button{width:100%;padding:10px;margin:4px 0;border:0;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(120deg,#5846e6,#7c4dff)}
    button:hover{filter:brightness(1.1)}button:disabled{opacity:.5;cursor:default}
    #new{background:linear-gradient(120deg,#16a34a,#22c55e)}.alt{background:linear-gradient(120deg,#2563eb,#3b82f6)}
    .sec{background:#2b2d31;color:#dbdee1;font-weight:600}
    .row{display:flex;align-items:center;justify-content:space-between;margin:8px 0;padding:9px 10px;background:#2b2d31;border-radius:8px;font-size:13px;font-weight:600}
    .sw{position:relative;width:38px;height:22px}.sw input{opacity:0;width:0;height:0}
    .sl{position:absolute;inset:0;background:#4e5058;border-radius:22px;cursor:pointer;transition:.2s}
    .sl:before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
    input:checked+.sl{background:#22c55e}input:checked+.sl:before{transform:translateX(16px)}
    #st{font-size:12px;line-height:1.4;min-height:34px;margin-top:6px;padding:8px 10px;background:#111214;border-radius:8px;color:#b5bac1;white-space:pre-wrap}
    #st.err{color:#f87171}#st.ok{color:#4ade80}
    details{margin-top:8px;font-size:12px}summary{cursor:pointer;color:#949ba4}
    .lt{font-size:13px;font-weight:700;margin:2px 0 8px}
    input[type=text],input[type=password]{width:100%;margin:3px 0 7px;padding:6px 8px;border-radius:6px;border:1px solid #3f4147;background:#111214;color:#dbdee1;font-size:12px}
    #login input{font-size:13px;padding:9px 10px}
    .meta{font-size:11px;color:#80848e;margin-top:6px}
  </style>
  <div class="p">
    <div class="hd" id="drag"><img src="${icon}"><b>ALLPWST Discord Data</b><span class="x" id="close">✕</span></div>
    <div class="bd">
      <div id="main">
      <button id="new">Sync New Sales</button>
      <button id="all" class="alt">Sync All History (scrolls to top)</button>
      <div class="row"><span>Live (send new sales automatically)</span><label class="sw"><input type="checkbox" id="auto"><span class="sl"></span></label></div>
      <button id="stop" class="sec">Stop</button>
      <div id="st">Ready.</div>
      <div class="meta" id="meta"></div>
      <details><summary>More</summary>
        <div class="meta">Connected to your Business Hub · #danielbehnam-sales</div>
        <button id="hub" class="sec">Open my hub</button>
        <button id="reset" class="sec">Forget local sync history</button>
      </details>
      </div>
    </div>
  </div>`;
  const $ = id => root.getElementById(id);

  function status(text, kind) {
    const st = $('st'); st.textContent = text; st.className = kind || '';
  }
  async function refreshMeta() {
    const d = await store.get({ sentIds: [], lastRun: 0 });
    $('meta').textContent = d.sentIds.length + ' sales sent from this browser' + (d.lastRun ? ' · last ' + new Date(d.lastRun).toLocaleString() : '');
  }
  function setBusy(b) { busy = b; $('all').disabled = b; $('new').disabled = b; }

  // drag
  (() => {
    let sx, sy, ox, oy, drag = false;
    $('drag').addEventListener('mousedown', e => { if (e.target.id === 'close') return; drag = true; sx = e.clientX; sy = e.clientY; const r = host.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!drag) return; host.style.left = (ox + e.clientX - sx) + 'px'; host.style.top = (oy + e.clientY - sy) + 'px'; host.style.right = 'auto'; });
    window.addEventListener('mouseup', () => drag = false);
  })();

  const show = v => { host.style.display = v ? 'block' : 'none'; store.set({ panelOpen: v }); if (v) refreshMeta(); };
  $('close').onclick = () => show(false);
  $('all').onclick = () => guard(exportAll);
  $('new').onclick = () => guard(exportNew);
  $('stop').onclick = () => { stopFlag = true; status('Stopping…'); };
  $('auto').onchange = e => { store.set({ auto: e.target.checked }); status(e.target.checked ? 'Live ON. New sales go to your hub as they post (keep this channel open).' : 'Live OFF.', e.target.checked ? 'ok' : ''); };
  $('hub').onclick = () => bg({ type: 'openHub' });
  const bg = msg => new Promise(r => { try { chrome.runtime.sendMessage(msg, res => r(res || { ok: false, error: 'No response' })); } catch (e) { r({ ok: false, error: 'Extension was updated. Refresh this page (F5).' }); } });
  $('reset').onclick = async () => { if (confirm('Forget which sales were already synced? (Your hub still skips duplicates.)')) { await saveSent(new Set()); refreshMeta(); status('Cleared.'); } };

  store.get({ auto: false, panelOpen: false }).then(d => {
    $('auto').checked = d.auto;
    if (d.panelOpen) show(true);
    setAuto(d.auto);
  });

  function guard(fn) {
    if (!alive()) return status('Extension was updated. Refresh this page (F5).', 'err');
    if (!onChannel()) return status('Open the #' + CHANNEL + ' channel first.', 'err');
    fn();
  }

  // ================= PARSING =================
  const clean = s => (s || '').replace(/​/g, '').trim();
  const strip = s => clean(s).replace(/^[^A-Za-z0-9$+\-]+/, '');
  const money = s => { s = String(s || ''); const m = s.match(/[\d,]+(\.\d+)?/); if (!m) return null; const v = parseFloat(m[0].replace(/,/g, '')); return /-\s*\$|^\s*-/.test(s) ? -v : v; };
  const pctNum = s => { const m = String(s || '').match(/-?[\d,.]+/); return m ? parseFloat(m[0].replace(/,/g, '')) / 100 : null; };
  const toISO = s => { if (!s) return null; const d = new Date(String(s).replace(/\s+E[SD]T$/, '')); return isNaN(d) ? null : d.toISOString(); };
  const toDate = s => { const d = new Date(s); if (isNaN(d)) return null; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function parseMsg(li, source) {
    if (!/^chat-messages-\d+-\d+$/.test(li.id)) return null;
    const art = li.querySelector('article[class*="embed"], [class*="embedWrapper"]');
    if (!art) return null;
    const f = {};
    art.querySelectorAll('[class*="embedField_"], [class*="embedField-"]').forEach(el => {
      const name = strip((el.querySelector('[class*="embedFieldName"]') || {}).innerText).toUpperCase();
      if (name) f[name] = clean((el.querySelector('[class*="embedFieldValue"]') || {}).innerText);
    });
    if (!('TOTAL SALE' in f)) return null;
    const title = clean((art.querySelector('[class*="embedTitle"]') || {}).innerText);
    const result = strip((art.querySelector('[class*="embedAuthorName"]') || {}).innerText);
    const lines = clean((art.querySelector('[class*="embedDescription"]') || {}).innerText).split('\n').map(strip).filter(Boolean);
    const dateLine = lines.find(l => /\w+day, \w+ \d+, \d{4}/.test(l)) || '';
    const venueLine = lines.find(l => l.includes('•') && !/Section/.test(l)) || '';
    const seat = (lines.find(l => /Section .* Row .* Qty/.test(l)) || '').match(/Section (.+?) • Row (.+?) • Qty: (\d+)/) || [];
    const vparts = venueLine.split(' • ');
    const venue = clean(vparts[0]), city = clean(vparts.slice(1).join(' • '));
    const per = f['PER TICKET BREAKDOWN'] || '';
    const total = money(f['TOTAL SALE']), profit = money(f['PROFIT']);
    const sold = toISO(f['SOLD']), bought = toISO(f['PURCHASED']);
    const notes = f['INTERNAL NOTES'] || '';
    const email = (notes.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || null;
    // order code = what's left of Internal Notes after the email; long digit runs (card numbers) are dropped
    const order = notes.replace(email || '', '').split(/\s+/).filter(t => t && !/^\d{12,}$/.test(t.replace(/[\s-]/g, ''))).join(' ').trim().slice(0, 80) || null;
    const msgId = (li.id.match(/(\d+)$/) || [])[1];
    return {
      id: li.id,
      discord_message_id: msgId,
      artist: title,
      venue, city, result,
      event_date: dateLine ? toDate(dateLine.replace(/^\w+day, /, '')) : null,
      section: seat[1] || null,
      row: seat[2] || null,
      qty: seat[3] ? Number(seat[3]) : null,
      cost_per: money((per.match(/Cost:\s*(\$[\d,.]+)/) || [])[1]),
      sold_per: money((per.match(/Sold:\s*(\$[\d,.]+)/) || [])[1]),
      total_sale: total,
      total_cost: total != null && profit != null ? Math.round((total - profit) * 100) / 100 : null,
      profit,
      roi: f['ROI'] || null,
      purchase_date: bought ? toDate(bought) : null,
      sold_date: sold ? toDate(sold) : null,
      sold_at: sold, purchased_at: bought,
      time_to_sell: f['TIME TO SELL'] || null,
      marketplace: f['CUSTOMER'] || null,
      notes: f['PUBLIC NOTES'] || null,
      account: email,
      order_number: order
    };
  }
  const visibleSales = source => [...document.querySelectorAll('li[id^="chat-messages-"]')].map(li => parseMsg(li, source)).filter(Boolean);

  function scroller() {
    const li = document.querySelector('li[id^="chat-messages-"]');
    let el = li && li.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    return el;
  }
  const atChannelStart = () =>
    !!document.querySelector('[class*="emptyChannel"], [class*="channelStart"]') ||
    /This is the start of the #/i.test((document.querySelector('[data-list-id="chat-messages"]') || document.body).innerText.slice(0, 4000));

  async function nudgeUp(sc) {
    if (!sc) return;
    sc.scrollTop = Math.min(400, sc.scrollHeight);
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(150);
    for (let i = 0; i < 3; i++) {
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -1200, bubbles: true, cancelable: true }));
      sc.scrollTop = 0;
      sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(120);
    }
  }
  const toBottom = () => { const s = scroller(); if (s) s.scrollTop = s.scrollHeight; };

  // ================= SENDING =================
  async function send(rows, label) {
    let added = 0, dup = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      if (!alive()) throw new Error('Extension was updated. Refresh this page (F5).');
      const chunk = rows.slice(i, i + BATCH);
      let res, tries = 0;
      do {
        res = await bg({ type: 'send', rows: chunk });
        if (res.ok) break;
        tries++; if (tries < 4) await sleep(3000);
      } while (tries < 4);
      if (!res.ok) throw new Error(res.error);
      added += (res.result && res.result.added) || 0; dup += (res.result && res.result.duplicates) || 0;
      if (label) status(label + ' ' + Math.min(i + BATCH, rows.length) + '/' + rows.length + '…');
    }
    const sent = await getSent(); rows.forEach(r => sent.add(r.id)); await saveSent(sent);
    await store.set({ lastRun: Date.now() });
    return { added, dup };
  }

  // ================= EXPORT ALL =================
  async function exportAll() {
    if (busy) return; setBusy(true); stopFlag = false;
    const found = new Map();
    try {
      let sc = scroller(), stall = 0, last = -1;
      while (!stopFlag) {
        visibleSales('export').forEach(m => found.set(m.id, m));
        status('Scrolling to the top of the channel…\n' + found.size + ' sales found');
        if (atChannelStart()) { visibleSales('export').forEach(m => found.set(m.id, m)); break; }
        sc = scroller() || sc;
        await nudgeUp(sc);
        await sleep(900);
        if (found.size === last) stall++; else stall = 0; last = found.size;
        if (stall >= 200) { status('Nothing new loaded for ~5 min. Treating this as the top.'); break; }
      }
      if (stopFlag) return status('Stopped. Nothing was sent.');
      const all = [...found.values()];
      status('Reached the top: ' + all.length + ' sales found. Sending to your hub…');
      const r = await send(all, 'Sending');
      status('Done! ' + r.added + ' new sales added to your hub' + (r.dup ? ' (' + r.dup + ' were already there)' : '') + '.', 'ok');
      toBottom();
    } catch (e) { status('Error: ' + e.message, 'err'); }
    finally { setBusy(false); refreshMeta(); }
  }

  // ================= EXPORT NEW =================
  async function exportNew() {
    if (busy) return; setBusy(true); stopFlag = false;
    try {
      toBottom(); await sleep(1200);
      const fresh = new Map(); let hit = false, stall = 0, last = -1;
      while (!stopFlag && !hit) {
        const vis = visibleSales('new').filter(m => !fresh.has(m.id));
        if (vis.length) {
          const ex = await bg({ type: 'existing', ids: vis.map(m => m.discord_message_id) });
          if (!ex.ok) throw new Error(ex.error);
          const known = new Set(ex.ids);
          vis.forEach(m => { if (known.has(m.discord_message_id)) hit = true; else fresh.set(m.id, m); });
        }
        status('Looking for new sales…\n' + fresh.size + ' found');
        if (hit || atChannelStart()) break;
        await nudgeUp(scroller()); await sleep(900);
        if (fresh.size === last) stall++; else stall = 0; last = fresh.size;
        if (stall >= 200) break;
      }
      if (stopFlag) return status('Stopped. Nothing was sent.');
      const list = [...fresh.values()];
      toBottom();
      if (!list.length) return status('Up to date. No new sales.', 'ok');
      const r = await send(list, 'Sending');
      status(r.added + ' new sale' + (r.added === 1 ? '' : 's') + ' added to your hub.', 'ok');
    } catch (e) { status('Error: ' + e.message, 'err'); }
    finally { setBusy(false); refreshMeta(); }
  }

  // ================= AUTO =================
  let timer = null;
  function queueCheck() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (busy || !alive() || !onChannel()) return;
      const sent = await getSent();
      const list = visibleSales('auto').filter(m => !sent.has(m.id));
      if (!list.length) return;
      // Skip ones already in the database (e.g. from Export All on another computer)
      const ex = await bg({ type: 'existing', ids: list.map(m => m.discord_message_id) });
      const known = new Set(ex.ok ? ex.ids : []);
      const todo = list.filter(m => !known.has(m.discord_message_id));
      if (!todo.length) { const s = await getSent(); list.forEach(m => s.add(m.id)); await saveSent(s); return; }
      try {
        const r = await send(todo);
        status('Live: ' + r.added + ' new sale' + (r.added === 1 ? '' : 's') + ' added at ' + new Date().toLocaleTimeString(), 'ok');
        refreshMeta();
      } catch (e) { status('Auto error: ' + e.message, 'err'); }
    }, 2500);
  }
  function setAuto(on) {
    if (observer) { observer.disconnect(); observer = null; }
    if (!on) return;
    observer = new MutationObserver(() => queueCheck());
    observer.observe(document.body, { childList: true, subtree: true });
    queueCheck();
  }
  chrome.storage.onChanged.addListener(ch => { if (ch.auto) { setAuto(ch.auto.newValue); $('auto').checked = ch.auto.newValue; } });

  chrome.runtime.onMessage.addListener((msg, s, reply) => {
    if (msg.type === 'toggle') { show(host.style.display === 'none'); reply({ ok: true }); }
  });
})();
