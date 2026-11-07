// Lets your hub's Inventory page see that this extension is installed and ask it to sync the sheet now.
document.documentElement.dataset.hubExtension = '1.2';
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || !e.data || e.data.type !== 'hub-sheet-sync') return;
  chrome.runtime.sendMessage({ type: 'sheetSync' }, (res) => {
    window.postMessage({ type: 'hub-sheet-sync-result', res: res || { ok: false, error: chrome.runtime.lastError?.message || 'No answer' } }, location.origin);
  });
});
