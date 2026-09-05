-- Knot multi-user foundation
-- Run this migration in the Supabase SQL editor before publishing the static app.
--
-- Admin authorization is based on auth.jwt()->'app_metadata'->>'role'.
-- The browser may use that claim for UX, but these policies and triggers are
-- the actual authorization boundary.

create extension if not exists pgcrypto;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'weekly', 'paid_monthly')),
  subscription_expires_at timestamptz,
  whatsapp_session_data jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table if not exists public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_type text not null unique check (plan_type in ('weekly', 'monthly')),
  price_amount numeric(12, 2) not null default 0 check (price_amount >= 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.media_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cloudinary_url text,
  caption text not null default '' check (char_length(caption) <= 4096),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  scheduled_for timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists media_queue_user_schedule_idx
  on public.media_queue (user_id, scheduled_for);
create index if not exists media_queue_workspace_schedule_idx
  on public.media_queue (workspace_id, scheduled_for);
create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists pricing_plans_set_updated_at on public.pricing_plans;
create trigger pricing_plans_set_updated_at
before update on public.pricing_plans
for each row execute function public.set_updated_at();

drop trigger if exists media_queue_set_updated_at on public.media_queue;
create trigger media_queue_set_updated_at
before update on public.media_queue
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
  workspace_name text;
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end
  )
  on conflict (id) do update
    set email = excluded.email;

  workspace_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), ''),
    split_part(coalesce(new.email, 'Knot'), '@', 1) || '''s workspace'
  );

  insert into public.workspaces (owner_id, name)
  values (new.id, workspace_name)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill accounts that existed before this migration was run.
insert into public.profiles (id, email, role)
select
  u.id,
  coalesce(u.email, ''),
  case when u.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      role = excluded.role;

insert into public.workspaces (owner_id, name)
select
  u.id,
  split_part(coalesce(u.email, 'Knot'), '@', 1) || '''s workspace'
from auth.users u
where not exists (
  select 1 from public.workspaces w where w.owner_id = u.id
);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
where not exists (
  select 1
  from public.workspace_members wm
  where wm.workspace_id = w.id and wm.user_id = w.owner_id
)
on conflict (workspace_id, user_id) do nothing;

-- Keep the requested profile role synchronized for trusted admin changes.
-- A user's client cannot promote itself because profiles has no self-update
-- policy, and admin authorization still comes from app_metadata.
create or replace function public.sync_profile_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles as p
  set role = case when new.raw_app_meta_data ->> 'role' = 'admin'
                  then 'admin' else 'user' end,
      email = coalesce(new.email, p.email)
  where p.id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_app_meta_data on auth.users
for each row execute function public.sync_profile_admin_role();

-- The free queue limit is enforced in the database so it cannot be bypassed
-- by calling Supabase directly. Trusted admins bypass this guard completely.
create or replace function public.enforce_queue_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tier text;
  pending_count integer;
begin
  if public.is_admin() then
    return new;
  end if;

  select subscription_tier into tier
  from public.profiles
  where id = new.user_id;

  if coalesce(tier, 'free') = 'free' then
    select count(*) into pending_count
    from public.media_queue
    where user_id = new.user_id
      and status in ('pending', 'processing')
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if pending_count >= 10 then
      raise exception 'Free accounts can queue up to 10 pending statuses';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists media_queue_enforce_limit on public.media_queue;
create trigger media_queue_enforce_limit
before insert or update of user_id, status on public.media_queue
for each row execute function public.enforce_queue_limit();

-- Default Nigerian pricing rows. Admins can edit these from the app.
insert into public.pricing_plans (plan_type, price_amount, currency)
values ('weekly', 0, 'NGN'), ('monthly', 0, 'NGN')
on conflict (plan_type) do nothing;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.pricing_plans enable row level security;
alter table public.media_queue enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "workspaces_select_member_or_admin" on public.workspaces;
create policy "workspaces_select_member_or_admin"
on public.workspaces for select
to authenticated
using (
  owner_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspaces_insert_owner_or_admin" on public.workspaces;
create policy "workspaces_insert_owner_or_admin"
on public.workspaces for insert
to authenticated
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "workspaces_update_owner_or_admin" on public.workspaces;
create policy "workspaces_update_owner_or_admin"
on public.workspaces for update
to authenticated
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "workspaces_delete_owner_or_admin" on public.workspaces;
create policy "workspaces_delete_owner_or_admin"
on public.workspaces for delete
to authenticated
using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "members_select_member_or_admin" on public.workspace_members;
create policy "members_select_member_or_admin"
on public.workspace_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = auth.uid()
  )
);

drop policy if exists "members_insert_owner_or_admin" on public.workspace_members;
create policy "members_insert_owner_or_admin"
on public.workspace_members for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = auth.uid()
  )
);

drop policy if exists "members_update_owner_or_admin" on public.workspace_members;
create policy "members_update_owner_or_admin"
on public.workspace_members for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = auth.uid()
  )
)
with check (public.is_admin() or user_id is not null);

drop policy if exists "members_delete_owner_or_admin" on public.workspace_members;
create policy "members_delete_owner_or_admin"
on public.workspace_members for delete
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = auth.uid()
  )
);

drop policy if exists "pricing_public_read" on public.pricing_plans;
create policy "pricing_public_read"
on public.pricing_plans for select
to anon, authenticated
using (true);

drop policy if exists "pricing_admin_insert" on public.pricing_plans;
create policy "pricing_admin_insert"
on public.pricing_plans for insert
to authenticated
with check (public.is_admin() and currency = 'NGN');

drop policy if exists "pricing_admin_update" on public.pricing_plans;
create policy "pricing_admin_update"
on public.pricing_plans for update
to authenticated
using (public.is_admin())
with check (public.is_admin() and currency = 'NGN');

drop policy if exists "pricing_admin_delete" on public.pricing_plans;
create policy "pricing_admin_delete"
on public.pricing_plans for delete
to authenticated
using (public.is_admin());

drop policy if exists "queue_select_owner_member_or_admin" on public.media_queue;
create policy "queue_select_owner_member_or_admin"
on public.media_queue for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = media_queue.workspace_id and wm.user_id = auth.uid()
  )
);

drop policy if exists "queue_insert_owner_or_admin" on public.media_queue;
create policy "queue_insert_owner_or_admin"
on public.media_queue for insert
to authenticated
with check (
  public.is_admin()
  or (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = media_queue.workspace_id and wm.user_id = auth.uid()
    )
  )
);

drop policy if exists "queue_update_owner_member_or_admin" on public.media_queue;
create policy "queue_update_owner_member_or_admin"
on public.media_queue for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = media_queue.workspace_id and wm.user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = media_queue.workspace_id and wm.user_id = auth.uid()
    )
  )
);

drop policy if exists "queue_delete_owner_member_or_admin" on public.media_queue;
create policy "queue_delete_owner_member_or_admin"
on public.media_queue for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = media_queue.workspace_id and wm.user_id = auth.uid()
  )
);