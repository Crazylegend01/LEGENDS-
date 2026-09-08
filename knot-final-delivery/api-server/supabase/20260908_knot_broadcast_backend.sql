-- Knot media upload and WhatsApp broadcast backend.
-- Run after 20260905_knot_multi_user.sql in the same Supabase project.

alter table public.media_queue
  add column if not exists cloudinary_public_id text,
  add column if not exists resource_type text check (resource_type in ('image', 'video')),
  add column if not exists mime_type text,
  add column if not exists bytes bigint,
  add column if not exists attempts integer not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists last_error text,
  add column if not exists completed_at timestamptz;

create index if not exists media_queue_due_idx
  on public.media_queue (status, scheduled_for, claimed_at);

create table if not exists public.whatsapp_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'qr', 'connected', 'reconnecting', 'logged_out')),
  phone_number text,
  qr_code text,
  auth_state jsonb,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists whatsapp_sessions_workspace_idx
  on public.whatsapp_sessions (workspace_id);

drop trigger if exists whatsapp_sessions_set_updated_at on public.whatsapp_sessions;
create trigger whatsapp_sessions_set_updated_at
before update on public.whatsapp_sessions
for each row execute function public.set_updated_at();

alter table public.whatsapp_sessions enable row level security;

drop policy if exists "whatsapp_sessions_select_own_or_admin"
  on public.whatsapp_sessions;
create policy "whatsapp_sessions_select_own_or_admin"
on public.whatsapp_sessions for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

-- The service-role worker calls this function. It atomically claims rows with
-- row locks, so multiple API instances cannot broadcast the same queue item.
create or replace function public.claim_due_media_queue(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.media_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Recover jobs abandoned by a crashed worker.
  update public.media_queue
  set status = 'pending',
      claimed_at = null,
      claimed_by = null,
      updated_at = timezone('utc', now())
  where status = 'processing'
    and claimed_at < timezone('utc', now()) - interval '15 minutes';

  return query
  with candidates as (
    select id
    from public.media_queue
    where status = 'pending'
      and (scheduled_for is null or scheduled_for <= timezone('utc', now()))
    order by scheduled_for asc nulls first, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.media_queue as queue
  set status = 'processing',
      claimed_at = timezone('utc', now()),
      claimed_by = p_worker_id,
      attempts = coalesce(queue.attempts, 0) + 1,
      updated_at = timezone('utc', now())
  from candidates
  where queue.id = candidates.id
  returning queue.*;
end;
$$;

revoke all on function public.claim_due_media_queue(text, integer) from public;
grant execute on function public.claim_due_media_queue(text, integer) to service_role;