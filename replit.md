# Knot multi-user platform

Knot lets authenticated users upload, schedule, and broadcast WhatsApp status media from individual workspaces.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Backend env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and rotated `CLOUDINARY_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/media.ts` — authenticated media upload and queue routes
- `artifacts/api-server/src/routes/whatsapp.ts` — Baileys pairing/session routes
- `artifacts/api-server/src/lib/whatsapp.ts` — session lifecycle and once-per-minute broadcaster
- `artifacts/api-server/src/lib/auth-state.ts` — Supabase-backed Baileys credential/key persistence
- `artifacts/api-server/supabase/20260908_knot_broadcast_backend.sql` — queue claim and session schema
- `lib/api-spec/openapi.yaml` — API contract source of truth

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

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details