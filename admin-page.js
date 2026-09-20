import { supabase } from "./supabase-client.js";

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

async function isAdminSession(session) {
  if (!session?.user?.id) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  return !error && data?.role === "admin";
}

function setMessage(selector, text = "", isError = false) {
  const element = $(selector);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function setPanelVisible(visible) {
  $("#adminLogin").hidden = visible;
  $("#adminPanel").hidden = !visible;
}

function renderAdminData(profiles, workspaces, queue, plans) {
  $("#adminWorkspaceCount").textContent = String(workspaces.length);
  $("#adminUserCount").textContent = String(profiles.length);
  $("#adminQueueCount").textContent = String(queue.length);
  $("#adminAdminCount").textContent = String(
    profiles.filter((profile) => profile.role === "admin").length
  );

  const workspaceBody = $("#adminWorkspaceBody");
  workspaceBody.innerHTML = workspaces.length
    ? workspaces.map((workspace) => {
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
    }).join("")
    : '<tr><td colspan="4">No workspaces yet.</td></tr>';

  const pricing = $("#pricingPlanList");
  pricing.innerHTML = plans.length
    ? plans.map((plan) => `
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
    `).join("")
    : '<div class="empty-state">No pricing plans found.</div>';
}

async function loadAdminData() {
  const results = await Promise.all([
    supabase.from("profiles").select("id,email,role,subscription_tier"),
    supabase.from("workspaces").select("id,name,owner_id,created_at").order("created_at", { ascending: false }),
    supabase.from("media_queue").select("id,workspace_id,user_id,status,scheduled_for"),
    supabase.from("pricing_plans").select("id,plan_type,price_amount,currency").order("plan_type"),
  ]);

  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  renderAdminData(
    results[0].data || [],
    results[1].data || [],
    results[2].data || [],
    results[3].data || []
  );
}

async function adminApi(path, options = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Admin session expired.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Admin API request failed.");
  return body;
}

async function loadSettings() {
  const result = await adminApi("/admin/settings");
  const form = $("#platformSettingsForm");
  if (!form) return;
  for (const setting of result.settings || []) {
    const input = form.elements.namedItem(setting.key);
    if (!input) continue;
    if (setting.is_secret) {
      input.placeholder = setting.hasValue
        ? "Saved securely. Leave blank to keep it"
        : input.placeholder;
      input.value = "";
    } else {
      input.value = setting.value || "";
    }
  }
}

async function showAuthorizedPanel(session) {
  if (!(await isAdminSession(session))) {
    setPanelVisible(false);
    return;
  }

  setPanelVisible(true);
  $("#adminIdentity").textContent = session.user.email || "Authorized admin";
  setMessage("#adminDataMessage", "Loading private data…");
  try {
    await loadAdminData();
    await loadSettings();
    setMessage("#adminDataMessage");
  } catch (error) {
    console.error("Admin data load failed:", error);
    setMessage("#adminDataMessage", "Unable to load admin data. Check that the SQL migration ran in this project.", true);
  }
}

document.addEventListener("submit", async (event) => {
  const pricingForm = event.target.closest("[data-pricing-plan]");
  const settingsForm = event.target.closest("#platformSettingsForm");
  if (!pricingForm && !settingsForm) return;
  event.preventDefault();

  if (pricingForm) {
    const planId = pricingForm.dataset.pricingPlan;
    const priceAmount = Number(new FormData(pricingForm).get("price_amount"));
    const message = pricingForm.querySelector(".pricing-message");
    if (!Number.isFinite(priceAmount) || priceAmount < 0) {
      if (message) message.textContent = "Enter a valid non-negative amount.";
      return;
    }
    if (message) message.textContent = "Saving…";
    const { error } = await supabase
      .from("pricing_plans")
      .update({ price_amount: priceAmount })
      .eq("id", planId);
    if (error) {
      if (message) message.textContent = error.message;
      return;
    }
    if (message) message.textContent = "Saved.";
    return;
  }

  const message = $("#adminSettingsMessage");
  const values = new FormData(settingsForm);
  const settings = [
    ["support_email", false, true],
    ["weekly_checkout_url", false, true],
    ["monthly_checkout_url", false, true],
    ["payment_gateway_public_key", false, true],
    ["payment_gateway_secret_key", true, false],
    ["whatsapp_provider_api_key", true, false],
  ].map(([key, isSecret, isPublic]) => ({
    key,
    value: String(values.get(key) || ""),
    isSecret,
    isPublic,
  })).filter((setting) => !setting.isSecret || setting.value);

  if (message) message.textContent = "Saving securely…";
  try {
    await adminApi("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ settings }),
    });
    if (message) message.textContent = "Settings saved.";
    await loadSettings();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
});

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#adminLoginMessage", "Checking access…");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !(await isAdminSession(data.session))) {
    if (data.session && !(await isAdminSession(data.session))) await supabase.auth.signOut();
    setMessage("#adminLoginMessage", "Access denied. This account is not authorized for this area.", true);
    button.disabled = false;
    return;
  }

  setMessage("#adminLoginMessage");
  button.disabled = false;
  await showAuthorizedPanel(data.session);
});

$("#adminSignOut").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  await showAuthorizedPanel(session);
});

const { data } = await supabase.auth.getSession();
await showAuthorizedPanel(data.session);