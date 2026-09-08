import { supabase } from "./supabase-client.js";

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

function isAdminSession(session) {
  return session?.user?.app_metadata?.role === "admin";
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

async function showAuthorizedPanel(session) {
  if (!isAdminSession(session)) {
    setPanelVisible(false);
    return;
  }

  setPanelVisible(true);
  $("#adminIdentity").textContent = session.user.email || "Authorized admin";
  setMessage("#adminDataMessage", "Loading private data…");
  try {
    await loadAdminData();
    setMessage("#adminDataMessage");
  } catch (error) {
    console.error("Admin data load failed:", error);
    setMessage("#adminDataMessage", "Unable to load admin data. Check that the SQL migration ran in this project.", true);
  }
}

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#adminLoginMessage", "Checking access…");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !isAdminSession(data.session)) {
    if (data.session && !isAdminSession(data.session)) await supabase.auth.signOut();
    setMessage("#adminLoginMessage", "Access denied. Use an account with app_metadata.role = admin.", true);
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