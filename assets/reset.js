import { sb, $, niceError } from "./common.js";

const form = $("#reset-form"), msg = $("#msg"), waiting = $("#waiting");
const say = (t, k = "") => { msg.textContent = t; msg.className = `msg ${k}`; msg.classList.toggle("hidden", !t); };

function ready() { waiting.classList.add("hidden"); form.classList.remove("hidden"); $("#pw1").focus(); }

sb.auth.onAuthStateChange((evt, session) => { if (evt === "PASSWORD_RECOVERY" || session) ready(); });
setTimeout(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) ready();
  else { waiting.classList.add("hidden"); say("This reset link is invalid or has expired. Request a new one from the sign-in page.", "error"); }
}, 1500);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#pw1").value;
  if (pw.length < 12) return say("Use at least 12 characters.", "error");
  if (pw !== $("#pw2").value) return say("Passwords don't match.", "error");
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) return say(niceError(error), "error");
  say("Password updated. Taking you to your hub…", "ok");
  setTimeout(() => location.replace("app.html"), 1200);
});
