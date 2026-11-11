/**
 * Business Hub: forwarded-email fix
 *
 * Runs inside danielbehman@primelioninc.com. Nothing to fill in.
 * Setup: script.google.com → New project → paste this whole file → pick "install" in the toolbar → Run → Allow.
 * To stop it later: pick "uninstall" → Run.
 *
 * Why: Outlook buyer accounts "redirect" emails here. Venues with strict email security (e.g. Moody Center)
 * then fail Gmail's sender check (DMARC), and Gmail hides those emails from the Hub's deal/presale scans.
 * Every 10 minutes this script finds those emails and sends a copy to this same inbox, from you, with
 * "[Hub Fwd]" in the subject. Your own copy passes the check, so the scans see it. The original is untouched.
 * It only copies ticket-related emails, never sends anything to anyone else, and never deletes anything.
 */
const INBOX = "danielbehman@primelioninc.com";
const DONE_LABEL = "Hub/Fwd done";
const TICKET_WORDS = /(ticket|presale|pre-sale|on ?sale|promo|code|offer|discount|% off|bogo|buy one|half off|free admission|fees|unlock|sign up|register|verified fan|last chance|flash sale|deal|save|package|bundle|4-pack)/i;

function install() {
  uninstall();
  ScriptApp.newTrigger("fixHiddenForwards").timeBased().everyMinutes(10).create();
  fixHiddenForwards(); // first run also catches the last 3 days
}

function uninstall() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "fixHiddenForwards").forEach((t) => ScriptApp.deleteTrigger(t));
}

function fixHiddenForwards() {
  const props = PropertiesService.getScriptProperties();
  const now = Math.floor(Date.now() / 1000);
  const since = Number(props.getProperty("LAST_RUN") || now - 3 * 86400) - 1800; // 30 min overlap
  const done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  const started = Date.now();
  let start = 0, copied = 0;

  while (Date.now() - started < 4.5 * 60 * 1000) {
    const threads = GmailApp.search(`in:inbox -from:me -label:${DONE_LABEL.replace(/[ /]/g, "-")} after:${since}`, start, 100);
    if (!threads.length) break;
    for (const t of threads) {
      for (const m of t.getMessages()) {
        if (m.getDate().getTime() / 1000 < since) continue;
        if (!isHidden(m)) continue;
        const subject = m.getSubject() || "";
        if (!TICKET_WORDS.test(subject) && !TICKET_WORDS.test((m.getPlainBody() || "").slice(0, 8000))) continue;
        copyToSelf(m);
        copied++;
      }
      t.addLabel(done);
    }
    start += threads.length;
  }
  props.setProperty("LAST_RUN", String(now));
  console.log(`Copied ${copied} hidden forwarded emails.`);
}

// A redirected email (Resent-From / Outlook inbox rule) that failed Gmail's DMARC check.
function isHidden(m) {
  const auth = (m.getHeader("Authentication-Results") || "") + " " + (m.getHeader("ARC-Authentication-Results") || "");
  const redirected = !!(m.getHeader("Resent-From") || m.getHeader("X-MS-Exchange-Inbox-Rules-Loop"));
  return redirected && /dmarc=fail/i.test(auth);
}

function copyToSelf(m) {
  const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const head =
    `<div style="font:13px Arial;border:1px solid #ccc;padding:8px;margin-bottom:12px">` +
    `Hub-Original-Id: ${m.getId()}<br>Original-From: ${esc(m.getFrom())}<br>Original-To: ${esc(m.getTo())}<br>` +
    `Original-Date: ${m.getDate().toISOString()}<br>Original-Subject: ${esc(m.getSubject())}</div>`;
  GmailApp.sendEmail(INBOX, `[Hub Fwd] ${m.getSubject() || "(no subject)"}`,
    `Hub-Original-Id: ${m.getId()}\nOriginal-From: ${m.getFrom()}\nOriginal-To: ${m.getTo()}\nOriginal-Date: ${m.getDate().toISOString()}\nOriginal-Subject: ${m.getSubject()}\n\n${m.getPlainBody() || ""}`,
    { htmlBody: head + (m.getBody() || ""), name: "Hub Fwd" });
}
