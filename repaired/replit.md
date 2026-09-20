# Knot multi-user platform

Knot lets authenticated users upload, schedule, and broadcast WhatsApp status media from individual workspaces.

## Run & Operate

- `npm --prefix api-server run dev` — run the API server (port 5000)
- `npm --prefix api-server run typecheck` — typecheck the API server
- `npm --prefix api-server run build` — build the API server
- Backend env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CLOUDINARY_URL`

## Stack

- Node.js 20+, TypeScript 5.9
- API: Express 5
- DB: Supabase PostgreSQL with RLS
- Build: esbuild (ESM bundle)

## Where things live

- `api-server/src/routes/media.ts` — authenticated media upload and queue routes
- `api-server/src/routes/whatsapp.ts` — Baileys pairing/session routes
- `api-server/src/lib/whatsapp.ts` — session lifecycle and once-per-minute broadcaster
- `api-server/src/lib/auth-state.ts` — Supabase-backed Baileys credential/key persistence
- `api-server/supabase/20260908_knot_broadcast_backend.sql` — queue claim and session schema

## Architecture decisions

- Cloudinary credentials and Supabase service-role access stay server-side; browser requests use Supabase access tokens.
- Queue claiming is performed by a Postgres function with row locks instead of an in-memory mutex.
- Baileys auth credentials and Signal keys are stored in Supabase so sessions survive API restarts.

## Product

Users can upload WhatsApp-compatible images/videos, schedule text or media statuses, pair a WhatsApp session with a QR code, and monitor queue outcomes.

## User preferences

No hardcoded admin or provider credentials. Use Replit Secrets for server credentials.

## Gotchas

Run both Knot Supabase migrations before exercising upload, pairing, or worker routes. The worker intentionally marks jobs failed when no connected WhatsApp session exists.

## Pointers

- See `README.md` for deployment and migration order.