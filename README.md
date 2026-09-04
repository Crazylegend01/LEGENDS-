# Knot / Legends

This is a static Knot prototype with Supabase authentication added as an
enhancement layer. The landing page, dashboard, queue UI, and admin shell are
kept, while the old preview/demo switcher and unused example query have been
removed.

## Account access

The site now supports Supabase email/password sign-up, sign-in, password
reset, and protected dashboard/queue navigation.

If Supabase email confirmation is enabled, a new user must confirm their email
before they can sign in. Set the redirect URL in Supabase Authentication to the
URL where this site is hosted.

## Admin access

The admin panel additionally requires a Supabase email/password session with
the server-controlled admin role.
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

- `auth.js` — adds sign-up, sign-in, password reset, and protected app
  navigation.
- `admin-guard.js` — injects the admin sign-in gate, verifies the
  server-controlled admin role, and handles admin sign-out.
- `supabase-client.js` — existing browser client used by the guard.

The original visual design remains in place, but the demo switcher CSS/markup
and its JavaScript synchronization code were removed because they were only
preview/template controls.
