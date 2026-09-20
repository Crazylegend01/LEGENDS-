-- Knot permissions repair
-- Run after the existing Knot migrations. This migration is idempotent.
--
-- Authorization is intentionally based on public.profiles.role, not a
-- client-controlled user_metadata value or a stale browser JWT claim.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- These security-definer helpers avoid the workspaces/workspace_members RLS
-- recursion present in the original migrations.
create or replace function public.is_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = target_user_id
  );
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;

create or replace function public.is_workspace_owner(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.workspaces
    where id = target_workspace_id
      and owner_id = target_user_id
  );
$$;

revoke all on function public.is_workspace_owner(uuid, uuid) from public;
grant execute on function public.is_workspace_owner(uuid, uuid) to authenticated;

-- Replace the original cross-referencing workspace policies. The helper
-- functions run as the definer so a workspace read cannot recurse through
-- workspace_members RLS.
drop policy if exists "workspaces_select_member_or_admin" on public.workspaces;
create policy "workspaces_select_member_or_admin"
on public.workspaces for select
to authenticated
using (
  owner_id = auth.uid()
  or public.is_admin()
  or public.is_workspace_member(id, auth.uid())
);

drop policy if exists "members_select_member_or_admin" on public.workspace_members;
create policy "members_select_member_or_admin"
on public.workspace_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_workspace_owner(workspace_id, auth.uid())
);

drop policy if exists "members_insert_owner_or_admin" on public.workspace_members;
create policy "members_insert_owner_or_admin"
on public.workspace_members for insert
to authenticated
with check (
  public.is_admin()
  or public.is_workspace_owner(workspace_id, auth.uid())
);

drop policy if exists "members_update_owner_or_admin" on public.workspace_members;
create policy "members_update_owner_or_admin"
on public.workspace_members for update
to authenticated
using (
  public.is_admin()
  or public.is_workspace_owner(workspace_id, auth.uid())
)
with check (
  public.is_admin()
  or public.is_workspace_owner(workspace_id, auth.uid())
);

drop policy if exists "members_delete_owner_or_admin" on public.workspace_members;
create policy "members_delete_owner_or_admin"
on public.workspace_members for delete
to authenticated
using (
  public.is_admin()
  or public.is_workspace_owner(workspace_id, auth.uid())
);

-- The browser needs public pricing and checkout URLs, while payment/provider
-- secrets remain readable only by an authenticated administrator.
alter table public.platform_settings enable row level security;

drop policy if exists "settings_public_read" on public.platform_settings;
create policy "settings_public_read"
on public.platform_settings for select
to anon, authenticated
using (is_public = true);

drop policy if exists "settings_admin_read" on public.platform_settings;
drop policy if exists "settings_admin_select" on public.platform_settings;
create policy "settings_admin_select"
on public.platform_settings for select
to authenticated
using (public.is_admin());

drop policy if exists "settings_admin_write" on public.platform_settings;
drop policy if exists "settings_admin_insert" on public.platform_settings;
create policy "settings_admin_insert"
on public.platform_settings for insert
to authenticated
with check (public.is_admin());

drop policy if exists "settings_admin_update" on public.platform_settings;
create policy "settings_admin_update"
on public.platform_settings for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.platform_settings to anon, authenticated;
grant insert, update on public.platform_settings to authenticated;

-- Keep queue access scoped to the owning account. Admins can still operate
-- platform-wide, but ordinary workspace members cannot read another user's
-- queue just because they share a workspace.
alter table public.media_queue enable row level security;

drop policy if exists "queue_select_owner_member_or_admin" on public.media_queue;
drop policy if exists "queue_select_own_or_admin" on public.media_queue;
create policy "queue_select_own_or_admin"
on public.media_queue for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "queue_insert_owner_or_admin" on public.media_queue;
drop policy if exists "queue_insert_own_or_admin" on public.media_queue;
create policy "queue_insert_own_or_admin"
on public.media_queue for insert
to authenticated
with check (
  public.is_admin()
  or (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id, auth.uid())
  )
);

drop policy if exists "queue_update_owner_member_or_admin" on public.media_queue;
drop policy if exists "queue_update_own_or_admin" on public.media_queue;
create policy "queue_update_own_or_admin"
on public.media_queue for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (
  public.is_admin()
  or (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id, auth.uid())
  )
);

drop policy if exists "queue_delete_owner_member_or_admin" on public.media_queue;
drop policy if exists "queue_delete_own_or_admin" on public.media_queue;
create policy "queue_delete_own_or_admin"
on public.media_queue for delete
to authenticated
using (user_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.media_queue to authenticated;

-- Cloudinary is the primary upload provider used by the API. The private
-- Supabase bucket below is also configured so direct/browser uploads or a
-- future provider fallback do not fail with storage RLS errors.
insert into storage.buckets (id, name, public)
values ('knot-media', 'knot-media', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "knot_media_select_own_or_admin" on storage.objects;
create policy "knot_media_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'knot-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "knot_media_insert_own_or_admin" on storage.objects;
create policy "knot_media_insert_own_or_admin"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'knot-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "knot_media_update_own_or_admin" on storage.objects;
create policy "knot_media_update_own_or_admin"
on storage.objects for update
to authenticated
using (
  bucket_id = 'knot-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
)
with check (
  bucket_id = 'knot-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "knot_media_delete_own_or_admin" on storage.objects;
create policy "knot_media_delete_own_or_admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'knot-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);