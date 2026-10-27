-- HOLYVIEW: registration metadata, content management and inactive payments.
-- Apply this migration to the existing FCH Supabase project.
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists country_code text,
  add column if not exists phone_number text,
  add column if not exists phone_verified_at timestamptz;

create table if not exists public.trailers (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete cascade,
  title text,
  media_asset_path text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid references public.movies(id) on delete cascade,
  track_id uuid references public.music_tracks(id) on delete cascade,
  asset_type text not null check (asset_type in ('video','audio','poster','backdrop','cover','trailer','subtitle','encrypted_offline')),
  storage_bucket text not null default 'holyview-private',
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  check (num_nonnulls(movie_id, track_id) = 1)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text,
  provider_reference text,
  amount numeric(12,2) check (amount is null or amount >= 0),
  currency text,
  status text not null default 'disabled' check (status in ('disabled','pending','succeeded','failed','refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.trailers enable row level security;
alter table public.media_assets enable row level security;
alter table public.payments enable row level security;

drop policy if exists "published trailers readable" on public.trailers;
create policy "published trailers readable" on public.trailers for select to anon, authenticated
using (status = 'published' and exists(select 1 from public.movies m where m.id = movie_id and m.status = 'published'));

drop policy if exists "admins manage trailers" on public.trailers;
create policy "admins manage trailers" on public.trailers for all to authenticated
using (exists(select 1 from public.admin_users a where a.user_id = (select auth.uid())))
with check (exists(select 1 from public.admin_users a where a.user_id = (select auth.uid())));

drop policy if exists "admins manage media assets" on public.media_assets;
create policy "admins manage media assets" on public.media_assets for all to authenticated
using (exists(select 1 from public.admin_users a where a.user_id = (select auth.uid())))
with check (exists(select 1 from public.admin_users a where a.user_id = (select auth.uid())));

drop policy if exists "payments own read" on public.payments;
create policy "payments own read" on public.payments for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.holyview_handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, display_name, country_code, phone_number)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name',''),
    nullif(new.raw_user_meta_data ->> 'full_name',''),
    nullif(new.raw_user_meta_data ->> 'country_code',''),
    nullif(new.raw_user_meta_data ->> 'phone_number',''))
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    country_code = coalesce(excluded.country_code, public.profiles.country_code),
    phone_number = coalesce(excluded.phone_number, public.profiles.phone_number);
  insert into public.trial_usage (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_holyview on auth.users;
create trigger on_auth_user_created_holyview after insert on auth.users
for each row execute function public.holyview_handle_new_user();

insert into public.settings(key, value) values
 ('payments_enabled','false'::jsonb),
 ('trial_duration_seconds','18000'::jsonb),
 ('signup_requires_full_name','true'::jsonb),
 ('signup_requires_country_phone','true'::jsonb)
on conflict (key) do update set value=excluded.value, updated_at=now();
