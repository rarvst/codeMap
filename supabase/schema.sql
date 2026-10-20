-- Where is CODE? — database setup.
-- Paste into Supabase: SQL Editor → New query → Run. Safe to re-run.

-- Profiles: one row per signed-in member, readable by anyone.
create table if not exists public.profiles (
  id          uuid primary key default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  year        int  not null check (year between 1950 and 2100),
  city        text not null check (char_length(city) between 1 and 120),
  country     text not null check (char_length(country) between 1 and 80),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  linkedin_url text check (linkedin_url ~* '^https://([a-z]+\.)?linkedin\.com/'),
  website_url  text check (website_url ~* '^https?://[^\s]+$'),
  image_url    text check (image_url ~* '^https://[^\s]+$'),
  heritage     text check (char_length(heritage) <= 80),
  industry     text check (char_length(industry) <= 60),
  company      text check (char_length(company) <= 80),
  code_position text check (code_position in ('President', 'VP', 'CM', 'VP Role', 'Resident', 'Associate')),
  created_at  timestamptz not null default now()
);

-- Upgrades for databases created before these fields existed (no-ops on a fresh install).
alter table public.profiles drop column if exists headline;
alter table public.profiles add column if not exists heritage text check (char_length(heritage) <= 80);
alter table public.profiles add column if not exists industry text check (char_length(industry) <= 60);
alter table public.profiles add column if not exists company text check (char_length(company) <= 80);
alter table public.profiles add column if not exists code_position text
  check (code_position in ('President', 'VP', 'CM', 'VP Role', 'Resident', 'Associate'));

-- Live mode: when on, the member is shown in the city their browser was last in (city center only).
alter table public.profiles add column if not exists live_mode boolean not null default false;
alter table public.profiles add column if not exists live_city text check (char_length(live_city) <= 120);
alter table public.profiles add column if not exists live_country text check (char_length(live_country) <= 80);
alter table public.profiles add column if not exists live_lat double precision check (live_lat between -90 and 90);
alter table public.profiles add column if not exists live_lng double precision check (live_lng between -180 and 180);
alter table public.profiles add column if not exists live_updated_at timestamptz;

alter table public.profiles enable row level security;

grant select on public.profiles to anon, authenticated;
grant insert, update, delete on public.profiles to authenticated;

drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles
  for select using (true);

drop policy if exists "Members create their own profile" on public.profiles;
create policy "Members create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "Members update their own profile" on public.profiles;
create policy "Members update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Members delete their own profile" on public.profiles;
create policy "Members delete their own profile" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

-- Contact details: kept apart from profiles so only signed-in members can read them.
create table if not exists public.profile_contacts (
  id    uuid primary key references public.profiles(id) on delete cascade,
  email text check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone ~ '^\+?[0-9 ().-]{7,25}$')
);

alter table public.profile_contacts enable row level security;

revoke all on public.profile_contacts from anon;
grant select, insert, update, delete on public.profile_contacts to authenticated;

drop policy if exists "Signed-in members read contacts" on public.profile_contacts;
create policy "Signed-in members read contacts" on public.profile_contacts
  for select to authenticated using (true);

drop policy if exists "Members create their own contact" on public.profile_contacts;
create policy "Members create their own contact" on public.profile_contacts
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "Members update their own contact" on public.profile_contacts;
create policy "Members update their own contact" on public.profile_contacts
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Members delete their own contact" on public.profile_contacts;
create policy "Members delete their own contact" on public.profile_contacts
  for delete to authenticated using ((select auth.uid()) = id);

-- Profile photos: public bucket, 2 MB images, each member writes only inside a folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members list their own avatars" on storage.objects;
create policy "Members list their own avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Members upload their own avatar" on storage.objects;
create policy "Members upload their own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Members replace their own avatar" on storage.objects;
create policy "Members replace their own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Members delete their own avatar" on storage.objects;
create policy "Members delete their own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
