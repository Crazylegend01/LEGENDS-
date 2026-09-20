/* ============================================================
   Example query — vanilla JS equivalent of the pages/index.tsx
   sample. Not wired into the UI; adapt the table/column names to
   your real schema (e.g. a "statuses" table for the queue view)
   and call renderExample() from script.js once ready.
   ============================================================ */

import { supabase } from "./supabase-client.js";

export async function renderExample(targetSelector = "#exampleList") {
  const { data: todos, error } = await supabase.from("todos").select();

  if (error) {
    console.error("Supabase query failed:", error.message);
    return;
  }

  const list = document.querySelector(targetSelector);
  if (!list || !todos) return;

  list.innerHTML = todos.map((todo) => `<li>${todo.name}</li>`).join("");
}
