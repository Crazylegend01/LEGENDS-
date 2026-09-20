# Knot Multi-User Platform

Knot is a glassmorphism WhatsApp status scheduler UI backed by Supabase
Auth, PostgreSQL, and Row Level Security. The landing-page visual design is
preserved, while the authenticated dashboard, queue, workspace, and admin
views now read from the database instead of demo-only rows.

## Supabase setup

1. Open the Supabase SQL editor and run
   `supabase/migrations/20260905_knot_multi_user.sql`.
2. In Authentication > URL Configuration, add the URL where `index.html` will
   be hosted. The auth flow uses that URL for sign-up confirmation and reset
   links.
3. Set the project URL and publishable browser key in `supabase-client.js`.
   The publishable key is safe for browser use. Never add a service-role key,
   GitHub token, or other secret to this static client.
4. In Supabase Auth, create the administrator user. Set its server-controlled
   `app_metadata` to:

   ```json
   { "role": "admin" }
   ```

   Do not put this value in `user_metadata`; users can edit that field.
5. Serve this folder from a web server. Opening `index.html` with `file://` can
   prevent browser module imports from working.

The `handle_new_user` trigger creates a profile, an individual workspace, and
an owner membership for every new account. The client never supplies a
`user_id` from another account. RLS policies use `auth.uid()` and the trusted
`app_metadata.role` claim, so admins can inspect all workspaces while ordinary
users only see their own workspace membership and queue.

## Pricing and admin bypass

`pricing_plans` only accepts `NGN` and has weekly and monthly rows. An
administrator can edit the amounts in the Naira pricing panel. There is no
hardcoded payment account or gateway in this bundle.

Free accounts are limited to 10 pending/processing queue items by a database
trigger. The same trigger bypasses that limit for accounts whose JWT contains
`app_metadata.role = "admin"`. RLS also grants admins platform-wide access;
the browser-side admin flag is only a UX optimization.

## Files

- `auth.js` — public sign-up, sign-in, password reset, and protected navigation.
- `admin-guard.js` — admin session gate using `app_metadata.role`.
- `knot-data.js` — user-scoped workspace/queue rendering, queue creation, and
  admin pricing/workspace data access.
- `supabase/migrations/20260905_knot_multi_user.sql` — schema, signup trigger,
  RLS policies, NGN pricing seed rows, and the free-tier database limit.
- `supabase-client.js` — browser Supabase client using only a publishable key.
