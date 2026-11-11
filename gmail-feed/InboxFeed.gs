/**
 * Business Hub — Inbox feed
 * Runs inside danielbehman@primelioninc.com (script.google.com, your own account; no admin needed).
 * Every 15 minutes it copies new emails into the Hub so the deal / presale scans can see them,
 * including emails forwarded from Outlook buyer accounts that Gmail hides from outside apps.
 *
 * Setup (once):
 *   1. In the Hub, Discord page, create a sync key and copy it.
 *   2. script.google.com → New project → paste this file → Project Settings → Script properties:
 *        HUB_SYNC_KEY = <the key from step 1>
 *   3. Run "install" once and click Allow. Done: it now runs every 15 minutes.
 * To stop: run "uninstall".
 */
const HUB_URL = "https://jhbhkjomjjbldlofuigt.supabase.co";
const HUB_PUBLIC_KEY = "sb_publishable_gI0HfDMHu4JkdoO0w_dKbw_N5tz1hOC"; // publishable key, safe to share
const TICKET_WORDS = /(ticket|presale|pre-sale|on sale|onsale|promo|code|offer|discount|% off|bogo|buy one|half off|free admission|fees|unlock|sign up|register|verified fan|last chance|flash sale|deal|save|package|bundle|4-pack)/i;

function install() {
  uninstall();
  ScriptApp.newTrigger("syncInbox").timeBased().everyMinutes(15).create();
  syncInbox();
}

function uninstall() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "syncInbox").forEach((t) => ScriptApp.deleteTrigger(t));
}

function syncInbox() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("HUB_SYNC_KEY");
  if (!key) throw new Error("Add HUB_SYNC_KEY in Project Settings → Script properties first.");
  const now = Math.floor(Date.now() / 1000);
  const since = Number(props.getProperty("LAST_SYNC") || now - 3 * 86400) - 1800; // 30 min overlap
  const started = Date.now();
  let batch = [], sent = 0, start = 0;

  while (Date.now() - started < 4.5 * 60 * 1000) {
    const threads = GmailApp.search(`in:anywhere -in:sent -in:chats after:${since}`, start, 100);
    if (!threads.length) break;
    for (const t of threads) {
      for (const m of t.getMessages()) {
        const when = m.getDate();
        if (when.getTime() / 1000 < since) continue;
        const subject = m.getSubject() || "";
        const plain = (m.getPlainBody() || "").replace(/\s+\n/g, "\n").slice(0, 30000);
        const ticket = TICKET_WORDS.test(subject) || TICKET_WORDS.test(plain.slice(0, 8000));
        batch.push({ id: m.getId(), thread_id: t.getId(), date: when.toISOString(), from: m.getFrom(), to: m.getTo(),
                     subject, body: ticket ? plain : "", ticket });
        if (batch.length >= 200) { sent += push(key, batch); batch = []; }
      }
    }
    start += threads.length;
  }
  if (batch.length) sent += push(key, batch);
  props.setProperty("LAST_SYNC", String(now));
  console.log(`Sent ${sent} emails to the Hub.`);
}

function push(key, msgs) {
  const res = UrlFetchApp.fetch(`${HUB_URL}/rest/v1/rpc/ingest_inbox_with_key`, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: HUB_PUBLIC_KEY, Authorization: `Bearer ${HUB_PUBLIC_KEY}` },
    payload: JSON.stringify({ p_key: key, p_msgs: msgs }),
  });
  if (res.getResponseCode() >= 300) throw new Error(`Hub said ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
  return msgs.length;
}
