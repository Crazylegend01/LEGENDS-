# Knot / Legends

This is a static Knot prototype with Supabase authentication added as an
enhancement layer. The original landing page, dashboard, queue UI, and design
system are kept intact.

## Admin access

The admin panel is now protected by Supabase email/password authentication.
The browser does not use a local password, cookie flag, or custom `localStorage`
switch that could be bypassed by changing browser storage.

1. In Supabase Authentication, create the administrator user.
2. Set that user's server-controlled `app_metadata` to include:

   ```json
   { "role": "admin" }
   ```

3. Keep the Supabase URL and publishable key in your local environment
   configuration. The publishable key is safe for browser use; never put a
   service-role key in this project.
4. Serve the folder from a web server. Opening `index.html` directly with
   `file://` can prevent module imports from working in some browsers.

The guard checks `app_metadata.role`, not `user_metadata`, because user
metadata can be edited by the user. Real admin data must still be protected
with Supabase Row Level Security policies or a server-side/Edge Function
endpoint; hiding a static panel alone is not an authorization boundary.

## Files added

- `admin-guard.js` — injects the sign-in gate, protects navigation to the admin
  view, verifies the server-controlled admin role, and removes the preview
  switcher from the shipped UI.
- `supabase-client.js` — existing browser client used by the guard.

The existing `index.html`, `styles.css`, and `script.js` were not rewritten;
`index.html` only receives the one script-loader line needed to activate the
enhancement.
