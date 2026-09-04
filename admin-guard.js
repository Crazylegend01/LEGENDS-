/* ============================================================
   KNOT — admin access enhancement

   This file is intentionally separate from the original UI layer. It adds:
   - Supabase email/password sign-in for the admin view
   - a server-controlled app_metadata.role check
   - session-aware locking when a session expires or signs out
   - removal of the demo switcher from the shipped experience

   Do not replace this with a client-only password or a localStorage flag.
   Those only hide the panel and are not security controls.
   ============================================================ */

import { supabase } from "./supabase-client.js";

const ADMIN_VIEW = "admin";
const ADMIN_ROLE = "admin";

let originalGoTo = null;
let currentSession = null;
let gate;
let form;
let emailInput;
let passwordInput;
let message;
let submitButton;
let signOutButton;

function isAdminSession(session) {
  return Boolean(
    session?.user &&
    (session.user.app_metadata?.role === ADMIN_ROLE ||
      session.user.app_metadata?.is_admin === true)
  );
}

function injectGateStyles() {
  const style = document.createElement("style");
  style.dataset.knotAdminGuard = "true";
  style.textContent = `
    #knot-admin-gate[hidden] { display: none !important; }
    #view-admin:not(.knot-admin-unlocked) { display: none !important; }
    #knot-admin-gate {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(12, 31, 26, 0.24);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .knot-admin-card {
      width: min(100%, 420px);
      padding: 30px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 24px 80px rgba(12, 31, 26, 0.2);
    }
    .knot-admin-card h2 {
      margin: 0;
      color: #0c1f1a;
      font: 700 26px/1.12 'Space Grotesk', 'Inter', sans-serif;
      letter-spacing: -0.02em;
    }
    .knot-admin-card p {
      margin: 10px 0 22px;
      color: #5b6b66;
      font: 14px/1.6 'Inter', sans-serif;
    }
    .knot-admin-card label {
      display: block;
      margin: 14px 0 7px;
      color: #22392f;
      font: 600 12px/1.2 'Inter', sans-serif;
    }
    .knot-admin-card input {
      width: 100%;
      border: 1px solid rgba(12, 31, 26, 0.16);
      border-radius: 12px;
      padding: 12px 13px;
      color: #0c1f1a;
      background: #fff;
      font: 14px 'Inter', sans-serif;
    }
    .knot-admin-card input:focus {
      outline: 2px solid #10b981;
      outline-offset: 2px;
    }
    .knot-admin-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 22px;
    }
    .knot-admin-actions button {
      border: 0;
      border-radius: 999px;
      padding: 10px 17px;
      color: #22392f;
      background: #eaf7f1;
      font: 600 13px 'Inter', sans-serif;
      cursor: pointer;
    }
    .knot-admin-actions button[type="submit"] {
      color: #fff;
      background: linear-gradient(135deg, #10b981, #059669);
    }
    .knot-admin-actions button:disabled {
      cursor: wait;
      opacity: 0.6;
    }
    .knot-admin-message {
      min-height: 20px;
      margin: 12px 0 0 !important;
      color: #a33a32 !important;
      font-size: 12px !important;
    }
    .knot-admin-message.success { color: #047857 !important; }
    @media (max-width: 480px) {
      .knot-admin-card { padding: 24px; }
      .knot-admin-actions { flex-direction: column-reverse; }
      .knot-admin-actions button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function createGate() {
  gate = document.createElement("div");
  gate.id = "knot-admin-gate";
  gate.hidden = true;
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-labelledby", "knot-admin-title");
  gate.innerHTML = `
    <div class="knot-admin-card">
      <h2 id="knot-admin-title">Admin access</h2>
      <p>Sign in with an administrator account to open the platform panel.</p>
      <form id="knot-admin-form" novalidate>
        <label for="knot-admin-email">Admin email</label>
        <input id="knot-admin-email" name="email" type="email"
          autocomplete="username" required>
        <label for="knot-admin-password">Password</label>
        <input id="knot-admin-password" name="password" type="password"
          autocomplete="current-password" minlength="8" required>
        <p id="knot-admin-message" class="knot-admin-message" role="alert"></p>
        <div class="knot-admin-actions">
          <button type="button" data-admin-cancel>Cancel</button>
          <button type="submit">Unlock admin panel</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(gate);
  form = gate.querySelector("#knot-admin-form");
  emailInput = gate.querySelector("#knot-admin-email");
  passwordInput = gate.querySelector("#knot-admin-password");
  message = gate.querySelector("#knot-admin-message");
  submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", signIn);
  gate.querySelector("[data-admin-cancel]").addEventListener("click", closeGate);
  gate.addEventListener("click", (event) => {
    if (event.target === gate) closeGate();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !gate.hidden) closeGate();
  });
}

function setMessage(text = "", success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}

function openGate() {
  if (isAdminSession(currentSession)) {
    unlockAndOpen();
    return;
  }

  setMessage("");
  gate.hidden = false;
  window.setTimeout(() => emailInput?.focus(), 0);
}

function closeGate() {
  gate.hidden = true;
  form.reset();
  setMessage("");
}

function lockAdmin() {
  currentSession = null;
  const adminView = document.getElementById("view-admin");
  adminView?.classList.remove("knot-admin-unlocked");
  signOutButton?.remove();
  signOutButton = null;

  if (document.querySelector(".view.active") === adminView && originalGoTo) {
    originalGoTo("dashboard");
  }
}

function addSignOutButton() {
  if (signOutButton) return;

  const adminView = document.getElementById("view-admin");
  const actions = adminView?.querySelector(".topbar-actions");
  if (!actions) return;

  signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.className = "btn btn-ghost btn-sm";
  signOutButton.textContent = "Sign out";
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    if (error && signOutButton) signOutButton.disabled = false;
  });
  actions.appendChild(signOutButton);
}

function unlockAndOpen() {
  const adminView = document.getElementById("view-admin");
  adminView?.classList.add("knot-admin-unlocked");
  addSignOutButton();
  closeGate();
  originalGoTo?.(ADMIN_VIEW);
}

async function signIn(event) {
  event.preventDefault();
  setMessage("");

  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.textContent = "Checking…";

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });

  if (error || !data.session || !isAdminSession(data.session)) {
    if (data.session && !isAdminSession(data.session)) {
      await supabase.auth.signOut();
    }
    setMessage(
      "Access denied. Use an administrator account with the admin role."
    );
    submitButton.disabled = false;
    submitButton.textContent = "Unlock admin panel";
    passwordInput.select();
    return;
  }

  currentSession = data.session;
  submitButton.disabled = false;
  submitButton.textContent = "Unlock admin panel";
  unlockAndOpen();
}

function removeTemplateSwitcher() {
  // The switcher is a preview affordance, not part of the shipped product.
  document.querySelector(".demo-switcher")?.remove();
}

async function initialize() {
  injectGateStyles();
  createGate();
  removeTemplateSwitcher();

  originalGoTo = window.goTo;
  if (typeof originalGoTo !== "function") {
    setMessage("Navigation is unavailable. Reload the page and try again.");
    return;
  }

  window.goTo = function guardedGoTo(name) {
    if (name === ADMIN_VIEW) {
      openGate();
      return false;
    }
    return originalGoTo(name);
  };

  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  if (!isAdminSession(currentSession)) lockAdmin();

  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    if (!isAdminSession(session)) lockAdmin();
  });
}

initialize().catch((error) => {
  console.error("Admin guard failed to initialize:", error);
  lockAdmin();
});