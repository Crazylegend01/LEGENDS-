import { supabase } from "./supabase-client.js";

const FREE_QUEUE_LIMIT = 10;
const state = {
  session: null,
  profile: null,
  workspace: null,
  queue: [],
  isAdmin: false,
};

const $ = (selector) => document.querySelector(selector);

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

function isAdminSession(session) {
  return session?.user?.app_metadata?.role === "admin";
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
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
  setText("#dashboardSub", `Here's how ${workspace} is running today.`);
  setText("#queueSummary", `${pending} statuses queued across the next 7 days.`);
  setText("#workspaceName", workspace);
  setText("#userName", name);
  setText("#userRole", state.isAdmin ? "Administrator" : "Owner");
  setText("#queueUserName", name);
  setText("#queueWorkspaceName", workspace);
  setText("#adminUserName", name);
  setText("#queuedCount", String(pending));
  setText("#completedCount", String(completed));
  setText("#connectedCount", String(sessionCount));
  setText("#queueStatDelta", state.isAdmin ? "Admin limit bypassed" : `${FREE_QUEUE_LIMIT} free pending limit`);
  setText("#completedStatDelta", completed ? "Synced from your queue" : "No completed statuses yet");
  setText("#connectedStatDelta", sessionCount ? "Session data connected" : "Connect a number to begin");

  renderQueueRows("#dashboardQueueList", state.queue.slice(0, 4));
  renderQueueRows("#queueListDynamic", state.queue, true);
  renderRecentActivity(state.queue);
  renderDayStrip(state.queue);
}

function renderAdminMetrics(profiles, workspaces, queue) {
  setText("#adminWorkspaceCount", String(workspaces.length));
  setText("#adminUserCount", String(profiles.length));
  setText("#adminQueueCount", String(queue.length));
  setText("#adminAdminCount", String(profiles.filter((profile) => profile.role === "admin").length));
}

function renderAdminTables(profiles, workspaces, queue, plans) {
  const workspaceBody = $("#adminWorkspaceBody");
  if (workspaceBody) {
    if (!workspaces.length) {
      workspaceBody.innerHTML = `<tr><td colspan="4">${escapeHtml("No workspaces yet.")}</td></tr>`;
    } else {
      workspaceBody.innerHTML = workspaces.map((workspace) => {
        const owner = profiles.find((profile) => profile.id === workspace.owner_id);
        const count = queue.filter((item) => item.workspace_id === workspace.id).length;
        return `
          <tr>
            <td><div class="user-cell"><div class="user-avatar"></div><div>
              <b>${escapeHtml(workspace.name)}</b>
              <span>${escapeHtml(owner?.email || "Unknown owner")}</span>
            </div></div></td>
            <td>${escapeHtml(owner?.subscription_tier || "free")}</td>
            <td>${count}</td>
            <td><span class="status-badge scheduled">Active</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  const planList = $("#pricingPlanList");
  if (planList) {
    planList.innerHTML = plans.map((plan) => `
      <form class="pricing-row" data-pricing-plan="${escapeHtml(plan.id)}">
        <label>
          <span>${escapeHtml(plan.plan_type)} plan</span>
          <input name="price_amount" type="number" min="0" step="0.01"
            value="${escapeHtml(plan.price_amount)}" required>
        </label>
        <span class="currency-tag">NGN</span>
        <button class="btn btn-primary btn-sm" type="submit">Save price</button>
        <span class="pricing-message" role="status"></span>
      </form>
    `).join("") || emptyState("Pricing plans will appear after the migration runs.");
  }
}

async function loadUserData() {
  const { data: sessionData } = await supabase.auth.getSession();
  state.session = sessionData.session;
  state.isAdmin = isAdminSession(state.session);
  if (!state.session) return;

  const [profileResult, workspaceResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,role,subscription_tier,subscription_expires_at,whatsapp_session_data")
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

async function loadAdminData() {
  if (!state.isAdmin) return;
  const [profiles, workspaces, queue, plans] = await Promise.all([
    supabase.from("profiles").select("id,email,role,subscription_tier,subscription_expires_at"),
    supabase.from("workspaces").select("id,name,owner_id,created_at").order("created_at", { ascending: false }),
    supabase.from("media_queue").select("id,workspace_id,user_id,status,scheduled_for"),
    supabase.from("pricing_plans").select("id,plan_type,price_amount,currency").order("plan_type"),
  ]);

  for (const result of [profiles, workspaces, queue, plans]) {
    if (result.error) throw result.error;
  }
  renderAdminMetrics(profiles.data || [], workspaces.data || [], queue.data || []);
  renderAdminTables(profiles.data || [], workspaces.data || [], queue.data || [], plans.data || []);
}

async function refresh() {
  try {
    await loadUserData();
    renderUserShell();
    await loadAdminData();
    setText("#dataStatus", "");
  } catch (error) {
    console.error("Knot data load failed:", error);
    setText("#dataStatus", "Connect the database migration to load your workspace data.");
  }
}

async function addQueueItem(form) {
  if (!state.session || !state.workspace) return;
  const formData = new FormData(form);
  const caption = String(formData.get("caption") || "").trim();
  const cloudinaryUrl = String(formData.get("cloudinary_url") || "").trim() || null;
  const scheduledFor = String(formData.get("scheduled_for") || "") || null;

  if (!caption && !cloudinaryUrl) {
    throw new Error("Add a caption or a Cloudinary media URL.");
  }

  if (!state.isAdmin
    && state.profile?.subscription_tier === "free"
    && state.queue.filter((item) => ["pending", "processing"].includes(item.status)).length >= FREE_QUEUE_LIMIT) {
    throw new Error(`Free accounts can queue up to ${FREE_QUEUE_LIMIT} pending statuses.`);
  }

  const { error } = await supabase.from("media_queue").insert({
    user_id: state.session.user.id,
    workspace_id: state.workspace.id,
    cloudinary_url: cloudinaryUrl,
    caption,
    scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
    status: "pending",
  });
  if (error) throw error;
  form.reset();
  await refresh();
}

async function savePricingPlan(form) {
  if (!state.isAdmin) throw new Error("Only administrators can edit pricing.");
  const planId = form.dataset.pricingPlan;
  const amount = Number(new FormData(form).get("price_amount"));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative Naira price.");

  const { error } = await supabase
    .from("pricing_plans")
    .update({ price_amount: amount, currency: "NGN" })
    .eq("id", planId);
  if (error) throw error;
}

document.addEventListener("submit", async (event) => {
  const queueForm = event.target.closest("#newQueueForm");
  const pricingForm = event.target.closest("[data-pricing-plan]");
  if (!queueForm && !pricingForm) return;
  event.preventDefault();
  const form = queueForm || pricingForm;
  const message = form.querySelector(".form-message, .pricing-message");
  if (message) message.textContent = "Saving…";
  try {
    if (queueForm) await addQueueItem(form);
    else await savePricingPlan(form);
    if (message) message.textContent = "Saved.";
  } catch (error) {
    if (message) message.textContent = error.message || "Unable to save.";
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  state.isAdmin = isAdminSession(session);
  if (!session) {
    state.profile = null;
    state.workspace = null;
    state.queue = [];
    return;
  }
  await refresh();
});

window.KnotData = {
  refresh,
  isAdmin: () => state.isAdmin,
  getState: () => ({ ...state }),
};

window.addEventListener("knot:view", () => {
  if (state.session) refresh();
});

refresh();