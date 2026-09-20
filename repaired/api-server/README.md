# Knot API server

This artifact contains the persistent backend for Knot's Cloudinary media queue
and WhatsApp status broadcaster.

## Required Replit configuration

Set these through Replit Secrets/environment settings:

- `CLOUDINARY_URL` — the rotated Cloudinary URL.
- `SUPABASE_SERVICE_ROLE_KEY` — the Supabase server-only key.
- `SUPABASE_URL` — the Supabase project URL.

The service-role key and Cloudinary URL must never be sent to the browser or
committed to the repository.

## Supabase setup

Run the migrations in this order:

`../20260905_knot_multi_user.sql`

Then run:

`supabase/20260908_knot_broadcast_backend.sql`

Then run:

`supabase/20260908_knot_linking.sql`

Then:

`supabase/20260909_knot_settings.sql`

The broadcast migration adds Cloudinary metadata, session status, retry
metadata, and the atomic `claim_due_media_queue` function. The linking
migration adds a per-user `whatsapp_session_files` table that stores the
Baileys multi-file `creds.json` and Signal key files as JSONB rows. The API
never exposes those files to the browser.

## API routes

All routes except health and the development upload page require a Supabase
access token:

`Authorization: Bearer <supabase-access-token>`

- `POST /api/media/upload` — multipart `file`, `workspaceId`, `caption`,
  optional `scheduledFor`. Uploads are transformed by Cloudinary and inserted
  into `media_queue`.
- `POST /api/media/queue/text` — queues a text-only status.
- `GET /api/media/queue?workspaceId=<id>` — lists queue items.
- `DELETE /api/media/queue/<id>` — removes a queue item and its Cloudinary asset.
- `GET /api/whatsapp/session` — reads QR/connection status.
- `POST /api/whatsapp/session/start` — starts the user's Baileys session.
- `POST /api/whatsapp/session/pairing-code` — creates a phone-number pairing
  code using digits with country code.
- `DELETE /api/whatsapp/session` — logs out and clears the stored auth state.
- `GET /api/admin/settings` — reads public settings and secret metadata for admins.
- `PATCH /api/admin/settings` — writes pricing/payment/provider settings for admins.
- `GET /api/upload-ui` — small development utility for exercising the upload
  route from a browser.

## Worker behavior

The API process schedules a queue tick once per minute. The claim function uses
Postgres row locks and `SKIP LOCKED`, so multiple API processes cannot claim
the same item. Due rows are sent to Baileys' `status@broadcast` target through
the owning user's active session, then marked `completed` or `failed`.

The worker retries abandoned `processing` rows after 15 minutes. Failed rows
retain a bounded error message and attempt count so the dashboard can expose
the failure without logging credentials or message contents.

## Dashboard linking module

The existing static Knot dashboard now includes a glassmorphism **Link
WhatsApp** panel with QR-code and pairing-code flows. It polls the authenticated
session endpoint while the Baileys WebSocket is connecting and renders the
animated infinity loader, QR image, pairing code, connected state, and unlink
action.

When the static dashboard and API are hosted on different origins, define this
before loading `whatsapp-link.js`:

```html
<script>
  window.KNOT_API_BASE_URL = "https://your-api-host.example/api";
</script>
```

The module defaults to `/api` for same-origin hosting.