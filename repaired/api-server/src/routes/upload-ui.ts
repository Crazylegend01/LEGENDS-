import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/upload-ui", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Knot media uploader</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;max-width:720px;margin:40px auto;padding:0 20px}
form{display:grid;gap:14px;background:#1e293b;padding:24px;border-radius:16px}
label{display:grid;gap:6px;font-size:14px}input,textarea,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #475569}
button{background:#38bdf8;color:#082f49;font-weight:700;cursor:pointer}.hint{color:#94a3b8;font-size:13px}
pre{white-space:pre-wrap;background:#020617;padding:16px;border-radius:12px}
</style></head>
<body><h1>Knot media uploader</h1>
<p class="hint">Development utility for the production API. Tokens stay in this page only and are never uploaded to Cloudinary.</p>
<form id="form">
<label>Supabase access token<input name="token" type="password" required></label>
<label>Workspace ID<input name="workspaceId" required></label>
<label>Media file<input name="file" type="file" accept="image/*,video/*" required></label>
<label>Caption<textarea name="caption" maxlength="4096"></textarea></label>
<label>Schedule (optional ISO date)<input name="scheduledFor" type="datetime-local"></label>
<button>Upload and queue</button>
</form><pre id="result">Waiting…</pre>
<script>
document.querySelector("#form").addEventListener("submit", async (event) => {
 event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
 const token = data.get("token"); data.delete("token");
 const response = await fetch("./media/upload", {method:"POST", headers:{Authorization:"Bearer "+token}, body:data});
 document.querySelector("#result").textContent = await response.text();
});
</script></body></html>`);
});

export default router;