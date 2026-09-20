import { supabase } from "./supabase-client.js";

const state = {
  session: null,
  profile: null,
  workspace: null,
  queue: [],
  plans: [],
  settings: {},
};

const $ = (selector) => document.querySelector(selector);
const API_BASE_URL = String(window.KNOT_API_BASE_URL || "/api").replace(/\/$/, "");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function displayName() {
  const email = state.profile?.email || state.session?.user?.email || "there";
  return email.split("@")[0].replace(/[._-]+/g, " ") || "there";
}

function prettyStatus(status = "pending") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status = "pending") {
  if (status === "completed") return "posted";
  if (status === "pending" || status === "processing") return "scheduled";
  return status === "failed" ? "failed" : "draft";
}

function formatSchedule(value) {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return date.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sign in to use this workspace.");
  }
  return data.session.access_token;
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The Knot API is unavailable.");
  return body;
}

function renderPublicPricing(plans, settings) {
  const container = $("#publicPricingPlans");
  if (!container) return;
  if (!plans.length) {
    container.innerHTML = `<div class="feature-card card glass">${emptyState("Pricing is not configured yet.")}</div>`;
    return;
  }
  container.innerHTML = plans.map((plan) => {
    const checkoutKey = `${plan.plan_type}_checkout_url`;
    const checkoutUrl = safeUrl(settings[checkoutKey] || "");
    const action = checkoutUrl !== "#"
      ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noreferrer">Choose ${escapeHtml(plan.plan_type)}</a>`
      : `<button class="btn btn-primary btn-sm" type="button" disabled>Checkout coming soon</button>`;
    return `
      <div class="feature-card card glass">
        <div class="feature-icon">₦</div>
        <h3>${escapeHtml(plan.plan_type)} plan</h3>
        <p><strong>₦${escapeHtml(Number(plan.price_amount || 0).toLocaleString())}</strong> per ${escapeHtml(plan.plan_type)}.</p>
        ${action}
      </div>
    `;
  }).join("");
}

function renderQueueRows(selector, queue, includeDrag = false) {
  const container = $(selector);
  if (!container) return;

  if (!queue.length) {
    container.innerHTML = emptyState("Your queue is empty. Add the first status below.");
    return;
  }

  container.innerHTML = queue.map((item) => {
    const caption = item.caption?.trim() || "Untitled status";
    const link = safeUrl(item.cloudinary_url);
    const media = item.cloudinary_url
      ? `<a class="queue-thumb queue-thumb-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer" aria-label="Open media"></a>`
      : '<div class="queue-thumb"></div>';
    return `
      <div class="queue-row">
        ${includeDrag ? '<span class="drag">⠿</span>' : ""}
        ${media}
        <div class="queue-info">
          <b>${escapeHtml(caption)}</b>
          <span>${item.cloudinary_url ? "Media" : "Text"} · ${escapeHtml(item.status)}</span>
        </div>
        <span class="queue-time">${escapeHtml(formatSchedule(item.scheduled_for))}</span>
        <span class="status-badge ${escapeHtml(statusClass(item.status))}">
          ${escapeHtml(prettyStatus(item.status))}
        </span>
      </div>
    `;
  }).join("");
}

function renderRecentActivity(queue) {
  const container = $("#recentActivity");
  if (!container) return;
  const recent = [...queue]
    .filter((item) => item.status === "completed" || item.status === "failed")
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 4);
  if (!recent.length) {
    container.innerHTML = emptyState("No completed activity yet.");
    return;
  }
  container.innerHTML = recent.map((item) => `
    <div class="feed-item">
      <div class="feed-dot"></div>
      <div>
        <p>${escapeHtml(item.caption?.trim() || "Untitled status")} ${item.status === "failed" ? "failed" : "completed"}</p>
        <span>${escapeHtml(formatSchedule(item.updated_at || item.created_at))}</span>
      </div>
    </div>
  `).join("");
}

function renderDayStrip(queue) {
  const strip = $(".day-strip");
  if (!strip) return;

  const today = new Date();
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const key = date.toISOString().slice(0, 10);
    const count = queue.filter((item) => item.scheduled_for?.slice(0, 10) === key).length;
    return {
      key,
      label: offset === 0 ? "TODAY" : date.toLocaleDateString([], { weekday: "short" }).toUpperCase(),
      day: date.getDate(),
      count,
    };
  });

  strip.innerHTML = days.map((day, index) => `
    <div class="day-chip glass ${index === 0 ? "active" : ""}">
      <div class="d">${day.label}</div>
      <div class="n">${day.day}</div>
      <div class="count">${day.count} queued</div>
    </div>
  `).join("");
}

function renderUserShell() {
  const name = displayName();
  const workspace = state.workspace?.name || "Your workspace";
  const pending = state.queue.filter((item) => ["pending", "processing"].includes(item.status)).length;
  const completed = state.queue.filter((item) => item.status === "completed").length;
  const sessionCount = state.profile?.whatsapp_session_data
    ? Object.keys(state.profile.whatsapp_session_data).length
    : 0;

  setText("#dashboardGreeting", `Good morning, ${name}`);
  setText("#dashboardSub", state.session
    ? `Here's how ${workspace} is running today.`
    : "Sign in to load your workspace.");
  setText("#queueSummary", `${pending} statuses queued across the next 7 days.`);
  setText("#workspaceName", workspace);
  setText("#userName", name);
  setText("#queueUserName", name);
  setText("#queueWorkspaceName", workspace);
  setText("#queuedCount", String(pending));
  setText("#completedCount", String(completed));
  setText("#connectedCount", String(sessionCount));
  setText("#queueStatDelta", "Updates from your queue");
  setText("#completedStatDelta", completed ? "Synced from your queue" : "No completed statuses yet");
  setText("#connectedStatDelta", sessionCount ? "Session data connected" : "Connect a number to begin");

  renderQueueRows("#dashboardQueueList", state.queue.slice(0, 4));
  renderQueueRows("#queueListDynamic", state.queue, true);
  renderRecentActivity(state.queue);
  renderDayStrip(state.queue);
}

async function loadUserData() {
  await loadPublicData();
  const { data: sessionData } = await supabase.auth.getSession();
  state.session = sessionData.session;
  if (!state.session) return;

  const [profileResult, workspaceResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,subscription_tier,subscription_expires_at,whatsapp_session_data")
      .eq("id", state.session.user.id)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("id,name,owner_id,created_at")
      .eq("owner_id", state.session.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (workspaceResult.error) throw workspaceResult.error;
  state.profile = profileResult.data;
  state.workspace = workspaceResult.data;

  if (!state.workspace) {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ owner_id: state.session.user.id, name: `${displayName()}'s workspace` })
      .select("id,name,owner_id,created_at")
      .single();
    if (error) throw error;
    state.workspace = data;
    await supabase.from("workspace_members").upsert({
      workspace_id: data.id,
      user_id: state.session.user.id,
      role: "owner",
    });
  }

  const { data: queue, error: queueError } = await supabase
    .from("media_queue")
    .select("id,user_id,workspace_id,cloudinary_url,caption,status,scheduled_for,created_at")
    .eq("workspace_id", state.workspace.id)
    .order("scheduled_for", { ascending: true, nullsFirst: false });
  if (queueError) throw queueError;
  state.queue = queue || [];
}

async function loadPublicData() {
  const [plansResult, settingsResult] = await Promise.allSettled([
    supabase
      .from("pricing_plans")
      .select("id,plan_type,price_amount,currency")
      .order("plan_type"),
    supabase
      .from("platform_settings")
      .select("key,value")
      .eq("is_public", true),
  ]);

  if (plansResult.status === "fulfilled" && !plansResult.value.error) {
    state.plans = plansResult.value.data || [];
  } else {
    state.plans = [];
    console.warn("Pricing could not be loaded.", plansResult.reason || plansResult.value?.error);
  }

  if (settingsResult.status === "fulfilled" && !settingsResult.value.error) {
    state.settings = Object.fromEntries(
      (settingsResult.value.data || []).map((setting) => [setting.key, setting.value]),
    );
  } else {
    state.settings = {};
    console.warn("Public settings could not be loaded.", settingsResult.reason || settingsResult.value?.error);
  }
  renderPublicPricing(state.plans, state.settings);
}

async function refresh() {
  try {
    await loadUserData();
    renderUserShell();
    setText("#dataStatus", "");
  } catch (error) {
    console.error("Knot data load failed:", error);
    state.profile = null;
    state.workspace = null;
    state.queue = [];
    renderUserShell();
    setText("#dataStatus", "Connect the database migration to load your workspace data.");
  }
}

async function addQueueItem(form) {
  if (!state.session || !state.workspace) return;
  const formData = new FormData(form);
  const caption = String(formData.get("caption") || "").trim();
  const file = formData.get("file");
  const scheduledFor = String(formData.get("scheduled_for") || "") || null;

  if (!caption && !(file instanceof File && file.size > 0)) {
    throw new Error("Add a caption or choose an image/video.");
  }

  if (file instanceof File && file.size > 0) {
    formData.set("workspaceId", state.workspace.id);
    formData.set("scheduledFor", scheduledFor ? new Date(scheduledFor).toISOString() : "");
    await apiRequest("/media/upload", { method: "POST", body: formData });
  } else {
    await apiRequest("/media/queue/text", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: state.workspace.id,
        caption,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      }),
    });
  }
  form.reset();
  await refresh();
}

document.addEventListener("submit", async (event) => {
  const queueForm = event.target.closest("#newQueueForm");
  if (!queueForm) return;
  event.preventDefault();
  const form = queueForm;
  const message = form.querySelector(".form-message");
  if (message) message.textContent = "Saving…";
  try {
    await addQueueItem(form);
    if (message) message.textContent = "Saved.";
  } catch (error) {
    if (message) message.textContent = error.message || "Unable to save.";
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  if (!session) {
    state.profile = null;
    state.workspace = null;
    state.queue = [];
    renderUserShell();
    return;
  }
  await refresh();
});

window.KnotData = {
  refresh,
  getState: () => ({ ...state }),
};

window.addEventListener("knot:view", () => {
  if (state.session) refresh();
});

window.addEventListener("knot:whatsapp", (event) => {
  setText("#connectedCount", event.detail?.status === "connected" ? "1" : "0");
  setText(
    "#connectedStatDelta",
    event.detail?.status === "connected"
      ? "Session data connected"
      : "Connect a number to begin",
  );
});

refresh();