import { sb, $, niceError } from "./common.js";

const forms = { login: $("#login-form"), forgot: $("#forgot-form"), signup: $("#signup-form") };
const msg = $("#msg");
const appUrl = new URL("app.html", location.href).href;
const resetUrl = new URL("reset.html", location.href).href;

function show(name) {
  Object.entries(forms).forEach(([k, f]) => f.classList.toggle("hidden", k !== name));
  say("");
  const first = forms[name].querySelector("input");
  if (first) first.focus();
}
function say(text, kind = "") {
  msg.textContent = text;
  msg.className = `msg ${kind}`;
  msg.classList.toggle("hidden", !text);
}
function busy(form, on) { form.querySelector("button[type=submit]").disabled = on; }

$("#show-forgot").onclick = () => show("forgot");
$("#show-signup").onclick = () => show("signup");
document.querySelectorAll(".back").forEach((b) => (b.onclick = () => show("login")));

if (new URLSearchParams(location.search).get("idle")) say("You were signed out after 30 minutes of inactivity.");

// Already signed in? Go straight to the hub.
const { data } = await sb.auth.getSession();
if (data.session) location.replace(appUrl);

forms.login.addEventListener("submit", async (e) => {
  e.preventDefault();
  busy(forms.login, true); say("");
  const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
  busy(forms.login, false);
  if (error) return say(niceError(error), "error");
  location.replace(appUrl);
});

forms.forgot.addEventListener("submit", async (e) => {
  e.preventDefault();
  busy(forms.forgot, true);
  const { error } = await sb.auth.resetPasswordForEmail($("#forgot-email").value.trim(), { redirectTo: resetUrl });
  busy(forms.forgot, false);
  if (error) return say(niceError(error), "error");
  say("If that email has an account, a reset link is on its way. Check your inbox.", "ok");
});

forms.signup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#su-password").value;
  if (pw.length < 12) return say("Use at least 12 characters.", "error");
  if (pw !== $("#su-password2").value) return say("Passwords don't match.", "error");
  busy(forms.signup, true);
  const { data, error } = await sb.auth.signUp({ email: $("#su-email").value.trim(), password: pw, options: { emailRedirectTo: appUrl } });
  busy(forms.signup, false);
  if (error) return say(niceError(error), "error");
  if (data.session) return location.replace(appUrl);
  // The owner's account is confirmed automatically, so sign straight in.
  const r = await sb.auth.signInWithPassword({ email: $("#su-email").value.trim(), password: pw });
  if (!r.error) return location.replace(appUrl);
  say("Account created! Sign in with your new password.", "ok");
  show("login");
});
