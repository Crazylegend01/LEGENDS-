/* ============================================================
   KNOT — account authentication

   Adds the missing public account flow to the static prototype:
   - email/password sign-in
   - email/password sign-up
   - password reset email
   - protected dashboard and queue navigation

   Supabase email confirmation may be enabled in the project. When it is,
   sign-up intentionally waits for the user to confirm their email.
   ============================================================ */

import { supabase } from "./supabase-client.js";

const PROTECTED_VIEWS = new Set(["dashboard", "queue", "admin"]);

let nativeGoTo;
let session = null;
let modal;
let form;
let emailInput;
let passwordInput;
let confirmInput;
let confirmField;
let submitButton;
let resetButton;
let switchButton;
let message;
let mode = "signin";
let pendingView = "dashboard";

function injectAuthStyles() {
  const style = document.createElement("style");
  style.dataset.knotAuth = "true";
  style.textContent = `
    #knot-auth-modal[hidden] { display: none !important; }
    #knot-auth-modal {
      position: fixed;
      inset: 0;
      z-index: 990;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(12, 31, 26, 0.24);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .knot-auth-card {
      width: min(100%, 420px);
      padding: 30px;
      border: 1px solid rgba(255, 255, 255, 0.68);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 24px 80px rgba(12, 31, 26, 0.2);
    }
    .knot-auth-card h2 {
      margin: 0;
      color: #0c1f1a;
      font: 700 26px/1.12 'Space Grotesk', 'Inter', sans-serif;
      letter-spacing: -0.02em;
    }
    .knot-auth-card > p {
      margin: 10px 0 22px;
      color: #5b6b66;
      font: 14px/1.6 'Inter', sans-serif;
    }
    .knot-auth-card label {
      display: block;
      margin: 14px 0 7px;
      color: #22392f;
      font: 600 12px/1.2 'Inter', sans-serif;
    }
    .knot-auth-card input {
      width: 100%;
      border: 1px solid rgba(12, 31, 26, 0.16);
      border-radius: 12px;
      padding: 12px 13px;
      color: #0c1f1a;
      background: #fff;
      font: 14px 'Inter', sans-serif;
    }
    .knot-auth-card input:focus {
      outline: 2px solid #10b981;
      outline-offset: 2px;
    }
    .knot-auth-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 22px;
    }
    .knot-auth-actions button,
    .knot-auth-link {
      border: 0;
      border-radius: 999px;
      padding: 10px 17px;
      color: #22392f;
      background: #eaf7f1;
      font: 600 13px 'Inter', sans-serif;
      cursor: pointer;
    }
    .knot-auth-actions button[type="submit"] {
      color: #fff;
      background: linear-gradient(135deg, #10b981, #059669);
    }
    .knot-auth-actions button:disabled { cursor: wait; opacity: 0.6; }
    .knot-auth-link {
      display: block;
      margin: 14px 0 0 auto;
      padding: 0;
      color: #047857;
      background: transparent;
      font-size: 12px;
    }
    .knot-auth-switch {
      margin: 20px 0 0;
      text-align: center;
      color: #5b6b66;
      font: 12px/1.5 'Inter', sans-serif;
    }
    .knot-auth-switch button {
      border: 0;
      padding: 0;
      color: #047857;
      background: transparent;
      font: 600 12px 'Inter', sans-serif;
      cursor: pointer;
    }
    .knot-auth-message {
      min-height: 20px;
      margin: 12px 0 0 !important;
      color: #a33a32 !important;
      font-size: 12px !important;
    }
    .knot-auth-message.success { color: #047857 !important; }
    @media (max-width: 480px) {
      .knot-auth-card { padding: 24px; }
      .knot-auth-actions { flex-direction: column-reverse; }
      .knot-auth-actions button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function createModal() {
  modal = document.createElement("div");
  modal.id = "knot-auth-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "knot-auth-title");
  modal.innerHTML = `
    <div class="knot-auth-card">
      <h2 id="knot-auth-title"></h2>
      <p id="knot-auth-description"></p>
      <form id="knot-auth-form" novalidate>
        <label for="knot-auth-email">Email</label>
        <input id="knot-auth-email" name="email" type="email"
          autocomplete="email" required>
        <label for="knot-auth-password">Password</label>
        <input id="knot-auth-password" name="password" type="password"
          autocomplete="new-password" minlength="8" required>
        <div id="knot-auth-confirm-field">
          <label for="knot-auth-confirm">Confirm password</label>
          <input id="knot-auth-confirm" name="confirmPassword" type="password"
            autocomplete="new-password" minlength="8">
        </div>
        <button class="knot-auth-link" type="button" data-auth-reset>
          Forgot password?
        </button>
        <p id="knot-auth-message" class="knot-auth-message" role="alert"></p>
        <div class="knot-auth-actions">
          <button type="button" data-auth-cancel>Cancel</button>
          <button type="submit"></button>
        </div>
        <p class="knot-auth-switch">
          <span id="knot-auth-switch-label"></span>
          <button type="button" data-auth-switch></button>
        </p>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  form = modal.querySelector("#knot-auth-form");
  emailInput = modal.querySelector("#knot-auth-email");
  passwordInput = modal.querySelector("#knot-auth-password");
  confirmInput = modal.querySelector("#knot-auth-confirm");
  confirmField = modal.querySelector("#knot-auth-confirm-field");
  submitButton = modal.querySelector('button[type="submit"]');
  resetButton = modal.querySelector("[data-auth-reset]");
  switchButton = modal.querySelector("[data-auth-switch]");
  message = modal.querySelector("#knot-auth-message");

  form.addEventListener("submit", submitAuth);
  resetButton.addEventListener("click", sendResetEmail);
  switchButton.addEventListener("click", () => {
    setMode(mode === "signin" ? "signup" : "signin");
  });
  modal.querySelector("[data-auth-cancel]").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });
}

function setMessage(text = "", success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}

function setMode(nextMode) {
  mode = nextMode;
  const isSignup = mode === "signup";
  modal.querySelector("#knot-auth-title").textContent = isSignup
    ? "Create your Knot account"
    : "Welcome back";
  modal.querySelector("#knot-auth-description").textContent = isSignup
    ? "Create an account to start scheduling your WhatsApp statuses."
    : "Sign in to continue to your Knot workspace.";
  submitButton.textContent = isSignup ? "Create account" : "Sign in";
  switchButton.textContent = isSignup ? "Sign in instead" : "Create an account";
  modal.querySelector("#knot-auth-switch-label").textContent = isSignup
    ? "Already have an account?"
    : "New to Knot?";
  confirmField.hidden = !isSignup;
  resetButton.hidden = isSignup;
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  setMessage("");
}

function openModal(nextMode = "signin", targetView = "dashboard") {
  pendingView = targetView;
  setMode(nextMode);
  modal.hidden = false;
  window.setTimeout(() => emailInput?.focus(), 0);
}

function closeModal() {
  modal.hidden = true;
  form.reset();
  setMessage("");
}

async function submitAuth(event) {
  event.preventDefault();
  setMessage("");
  if (!form.reportValidity()) return;

  if (mode === "signup" && passwordInput.value !== confirmInput.value) {
    setMessage("The passwords do not match.");
    confirmInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = mode === "signup" ? "Creating account…" : "Signing in…";

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value,
      options: { emailRedirectTo: window.location.href },
    });

    if (error) {
      setMessage(error.message || "Unable to create the account.");
    } else if (!data.session) {
      setMessage("Account created. Check your email to confirm your account.", true);
      submitButton.disabled = false;
      submitButton.textContent = "Create account";
      return;
    } else {
      session = data.session;
      closeModal();
      nativeGoTo?.(pendingView);
    }
  } else {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });

    if (error || !data.session) {
      setMessage(error?.message || "Unable to sign in. Check your email and password.");
    } else {
      session = data.session;
      closeModal();
      nativeGoTo?.(pendingView);
    }
  }

  submitButton.disabled = false;
  submitButton.textContent = mode === "signup" ? "Create account" : "Sign in";
}

async function sendResetEmail() {
  const email = emailInput.value.trim();
  if (!emailInput.checkValidity() || !email) {
    setMessage("Enter your email first, then try again.");
    emailInput.focus();
    return;
  }

  resetButton.disabled = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href,
  });
  setMessage(
    error ? error.message : "If that account exists, a password reset email is on its way.",
    !error
  );
  resetButton.disabled = false;
}

function interceptLandingAuthLinks(event) {
  const link = event.target.closest("a");
  if (!link) return;

  const text = link.textContent.trim().toLowerCase();
  const isLogin = text === "log in";
  const isStart = text === "start free";
  const isScheduler = text === "see the scheduler";
  if (!isLogin && !isStart && !isScheduler) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openModal(isLogin ? "signin" : "signup", isScheduler ? "queue" : "dashboard");
}

async function initialize() {
  injectAuthStyles();
  createModal();

  const { data } = await supabase.auth.getSession();
  session = data.session;
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
  });

  nativeGoTo = window.goTo;
  if (typeof nativeGoTo !== "function") return;

  window.goTo = function protectedGoTo(name) {
    if (PROTECTED_VIEWS.has(name) && !session) {
      openModal("signin", name);
      return false;
    }
    return nativeGoTo(name);
  };

  document.addEventListener("click", interceptLandingAuthLinks, true);
}

window.KnotAuth = {
  open: openModal,
  getSession: () => session,
};

initialize().catch((error) => {
  console.error("Authentication UI failed to initialize:", error);
});