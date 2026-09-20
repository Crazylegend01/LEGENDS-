-- Durable multi-file WhatsApp auth state and pairing-code support.
-- Run after 20260908_knot_broadcast_backend.sql.

alter table public.whatsapp_sessions
  add column if not exists pairing_code text;

alter table public.whatsapp_sessions
  drop constraint if exists whatsapp_sessions_status_check;

alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_status_check
  check (
    status in (
      'disconnected',
      'connecting',
      'qr',
      'pairing',
      'connected',
      'reconnecting',
      'logged_out'
    )
  );

create table if not exists public.whatsapp_session_files (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text not null,
  file_data jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, file_name)
);

create index if not exists whatsapp_session_files_workspace_idx
  on public.whatsapp_session_files (workspace_id);

drop trigger if exists whatsapp_session_files_set_updated_at
  on public.whatsapp_session_files;
create trigger whatsapp_session_files_set_updated_at
before update on public.whatsapp_session_files
for each row execute function public.set_updated_at();

alter table public.whatsapp_session_files enable row level security;

revoke all on public.whatsapp_session_files from anon, authenticated;

-- The API uses the Supabase service role for these rows. No browser role gets
-- table privileges because the rows contain Signal keys and credentials.
alter table public.whatsapp_sessions
  drop column if exists auth_state;
drop policy if exists "whatsapp_sessions_select_own_or_admin"
  on public.whatsapp_sessions;
revoke all on public.whatsapp_sessions from anon, authenticated;