/* ============================================================
   KNOT — interaction layer
   Handles: initial loader, view switching (landing / dashboard /
   queue / admin), mobile sidebar toggle, active-state syncing.
   ============================================================ */

const VIEWS = ["landing", "dashboard", "queue", "admin"];

function goTo(name) {
  if (!VIEWS.includes(name)) return;

  // Swap visible view
  VIEWS.forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (!el) return;
    el.classList.toggle("active", v === name);
  });

  // Close mobile sidebar on navigation
  document.querySelectorAll(".sidebar").forEach((s) => s.classList.remove("open"));

  // Scroll fresh view to top
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  // Brief loader flash between app views for a sense of live data
  if (name !== "landing") flashLoader(420);

  window.dispatchEvent(new CustomEvent("knot:view", { detail: { name } }));
}

function toggleSidebar() {
  const activeView = document.querySelector(".view.active");
  const sidebar = activeView && activeView.querySelector(".sidebar");
  if (sidebar) sidebar.classList.toggle("open");
}

function flashLoader(duration = 700) {
  const loader = document.getElementById("loaderScreen");
  loader.classList.remove("hidden");
  window.clearTimeout(flashLoader._t);
  flashLoader._t = window.setTimeout(() => loader.classList.add("hidden"), duration);
}

// Initial load: show the glowing infinity mark briefly, then reveal the app
window.addEventListener("load", () => {
  const loader = document.getElementById("loaderScreen");
  setTimeout(() => loader.classList.add("hidden"), 1400);
});

// Close mobile sidebar when clicking outside it
document.addEventListener("click", (e) => {
  const openSidebar = document.querySelector(".sidebar.open");
  if (!openSidebar) return;
  const isToggle = e.target.closest(".mobile-topbar");
  const isInside = e.target.closest(".sidebar");
  if (!isToggle && !isInside) openSidebar.classList.remove("open");
});
