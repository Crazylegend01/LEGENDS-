-- Fixes Supabase error 42P17:
-- "infinite recursion detected in policy for relation workspaces".
--
-- The original policies checked workspaces from workspace_members policies and
-- workspace_members from workspaces policies. These security-definer helpers
-- perform the membership checks outside the querying user's RLS policies.

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
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = target_user_id
  );
$$;

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
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_id = target_user_id
  );
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public;
revoke all on function public.is_workspace_owner(uuid, uuid) from public;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid, uuid) to authenticated;

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

drop policy if exists "queue_select_owner_member_or_admin" on public.media_queue;
create policy "queue_select_owner_member_or_admin"
on public.media_queue for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_workspace_member(workspace_id, auth.uid())
);

drop policy if exists "queue_insert_owner_or_admin" on public.media_queue;
create policy "queue_insert_owner_or_admin"
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
create policy "queue_update_owner_member_or_admin"
on public.media_queue for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_workspace_member(workspace_id, auth.uid())
)
with check (
  public.is_admin()
  or (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id, auth.uid())
  )
);

drop policy if exists "queue_delete_owner_member_or_admin" on public.media_queue;
create policy "queue_delete_owner_member_or_admin"
on public.media_queue for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_workspace_member(workspace_id, auth.uid())
);