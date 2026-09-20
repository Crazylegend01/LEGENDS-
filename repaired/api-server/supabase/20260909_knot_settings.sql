-- Knot dynamic platform settings.
-- Run after the multi-user, broadcast, and linking migrations.

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,100}$'),
  value text not null default '',
  is_secret boolean not null default false,
  is_public boolean not null default false,
  description text,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

drop policy if exists "settings_public_read" on public.platform_settings;
create policy "settings_public_read"
on public.platform_settings for select
to anon, authenticated
using (is_public = true);

drop policy if exists "settings_admin_read" on public.platform_settings;
create policy "settings_admin_read"
on public.platform_settings for select
to authenticated
using (public.is_admin());

drop policy if exists "settings_admin_write" on public.platform_settings;
create policy "settings_admin_write"
on public.platform_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.platform_settings (key, value, is_secret, is_public, description)
values
  ('support_email', '', false, true, 'Public support email shown in the app'),
  ('weekly_checkout_url', '', false, true, 'Checkout URL for the weekly plan'),
  ('monthly_checkout_url', '', false, true, 'Checkout URL for the monthly plan'),
  ('payment_gateway_public_key', '', false, true, 'Public payment gateway key'),
  ('payment_gateway_secret_key', '', true, false, 'Server-only payment gateway key'),
  ('whatsapp_provider_api_key', '', true, false, 'Optional provider API key')
on conflict (key) do nothing;