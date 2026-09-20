import { supabase } from "./supabase-client.js";

// Set window.KNOT_API_BASE_URL before this module when the static app and API
// are hosted on different origins. Same-origin deployments use /api.
const API_BASE_URL = String(window.KNOT_API_BASE_URL || "/api").replace(/\/$/, "");
const state = {
  pollTimer: null,
  busy: false,
};

const $ = (selector) => document.querySelector(selector);

function setHidden(selector, hidden) {
  const element = $(selector);
  if (element) element.hidden = hidden;
}

function setStatus(status, label) {
  const badge = $("#whatsappStatusBadge");
  if (!badge) return;
  badge.textContent = label;
  badge.className = `status-badge ${status === "connected" ? "posted" : status === "qr" || status === "pairing" ? "scheduled" : "draft"}`;
}

function showStage(stage) {
  setHidden("#whatsappStageIdle", stage !== "idle");
  setHidden("#whatsappStageLoading", stage !== "loading");
  setHidden("#whatsappStageQr", stage !== "qr");
  setHidden("#whatsappStagePairing", stage !== "pairing");
  setHidden("#whatsappStageConnected", stage !== "connected");
}

function message(text, isError = false) {
  const element = $("#whatsappLinkMessage");
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("whatsapp-error", isError);
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sign in to link a WhatsApp number.");
  }
  return data.session.access_token;
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Unable to contact the WhatsApp service.");
  return body;
}

function workspaceId() {
  return window.KnotData?.getState?.().workspace?.id || null;
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function renderSession(session) {
  const status = session?.status || "disconnected";
  const labels = {
    connected: "Linked",
    connecting: "Connecting",
    qr: "Scan QR",
    pairing: "Enter code",
    reconnecting: "Reconnecting",
    logged_out: "Logged out",
    disconnected: "Not linked",
  };
  setStatus(status, labels[status] || "Not linked");

  const disconnect = $("#whatsappDisconnect");
  if (disconnect) disconnect.hidden = !["connected", "qr", "pairing", "connecting", "reconnecting"].includes(status);

  if (status === "connected") {
    stopPolling();
    showStage("connected");
    message("Your WhatsApp session is ready for scheduled statuses.");
    const number = session.phone_number ? `+${session.phone_number}` : "Your number";
    const connectedNumber = $("#whatsappConnectedNumber");
    if (connectedNumber) connectedNumber.textContent = `${number} is ready for scheduled statuses.`;
    return;
  }

  if (status === "qr" && session.qrDataUrl) {
    showStage("qr");
    const image = $("#whatsappQrImage");
    if (image && image.src !== session.qrDataUrl) image.src = session.qrDataUrl;
    message("Scan the fresh QR code before it expires.");
    return;
  }

  if (status === "pairing" && session.pairingCode) {
    showStage("pairing");
    const code = $("#whatsappPairingCode");
    if (code) code.textContent = session.pairingCode;
    message("Enter the pairing code in WhatsApp to finish linking.");
    return;
  }

  if (["connecting", "reconnecting"].includes(status)) {
    showStage("loading");
    message(status === "reconnecting" ? "Reconnecting to your saved WhatsApp session…" : "Establishing a secure WhatsApp connection…");
    return;
  }

  showStage("idle");
  if (status === "logged_out") message("This WhatsApp session was logged out. Link it again to continue.");
}

async function loadSession() {
  if (!window.KnotAuth?.getSession?.() || !workspaceId()) return;
  try {
    const session = await apiRequest("/whatsapp/session");
    renderSession(session);
  } catch (error) {
    message(error.message, true);
  }
}

function beginPolling() {
  stopPolling();
  void loadSession();
  state.pollTimer = window.setInterval(loadSession, 2200);
}

async function startQr() {
  if (state.busy) return;
  state.busy = true;
  showStage("loading");
  setStatus("connecting", "Connecting");
  message("Establishing a secure WhatsApp connection…");
  try {
    await apiRequest("/whatsapp/session/start", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspaceId() }),
    });
    beginPolling();
  } catch (error) {
    showStage("idle");
    message(error.message, true);
    setStatus("disconnected", "Not linked");
  } finally {
    state.busy = false;
  }
}

async function requestPairingCode(event) {
  event.preventDefault();
  if (state.busy) return;
  const phoneNumber = String($("#whatsappPhone")?.value || "").trim();
  const pairingMessage = $("#whatsappPairingMessage");
  state.busy = true;
  showStage("loading");
  setStatus("pairing", "Preparing code");
  if (pairingMessage) pairingMessage.textContent = "Requesting code…";
  try {
    const result = await apiRequest("/whatsapp/session/pairing-code", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspaceId(), phoneNumber }),
    });
    renderSession(result);
    beginPolling();
  } catch (error) {
    showStage("idle");
    message(error.message, true);
    if (pairingMessage) pairingMessage.textContent = error.message;
    setStatus("disconnected", "Not linked");
  } finally {
    state.busy = false;
  }
}

async function disconnect() {
  if (state.busy) return;
  state.busy = true;
  stopPolling();
  try {
    await apiRequest("/whatsapp/session", { method: "DELETE" });
    showStage("idle");
    setStatus("disconnected", "Not linked");
    message("WhatsApp was unlinked. Your saved session files were removed.");
    setHidden("#whatsappDisconnect", true);
  } catch (error) {
    message(error.message, true);
  } finally {
    state.busy = false;
  }
}

function initialize() {
  $("#whatsappStartQr")?.addEventListener("click", startQr);
  $("#whatsappShowPairing")?.addEventListener("click", () => {
    const form = $("#whatsappPairingForm");
    if (form) form.hidden = !form.hidden;
    $("#whatsappPhone")?.focus();
  });
  $("#whatsappPairingForm")?.addEventListener("submit", requestPairingCode);
  $("#whatsappDisconnect")?.addEventListener("click", disconnect);
  window.addEventListener("knot:view", (event) => {
    if (event.detail?.name === "dashboard") void loadSession();
  });
  supabase.auth.onAuthStateChange(() => void loadSession());
  window.setTimeout(loadSession, 0);
}

initialize();