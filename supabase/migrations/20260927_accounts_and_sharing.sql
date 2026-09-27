-- Accounts, recipe ownership (private / shared / public) and invite-link sharing.
-- Applied in two steps on 2026-09-27: accounts_and_sharing + sharing_helpers_private_schema.
-- This file is the resulting end state.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.recipes add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.recipes add column if not exists visibility text not null default 'private';
alter table public.recipes add constraint recipes_visibility_check check (visibility in ('private', 'shared', 'public'));
alter table public.recipes add constraint recipes_owner_profile_fk foreign key (owner_id) references public.profiles(id) on delete cascade;
create index if not exists recipes_owner_idx on public.recipes (owner_id);
create index if not exists recipes_public_idx on public.recipes (visibility) where visibility = 'public';

-- One row per invited person. The token is the invite link; it binds to the account that
-- opens it first, so access never depends on an (unverified) email address.
create table if not exists public.recipe_shares (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  label text not null default '',
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (recipe_id, user_id)
);
create index if not exists recipe_shares_user_idx on public.recipe_shares (user_id);
create index if not exists recipe_shares_recipe_idx on public.recipe_shares (recipe_id);
alter table public.recipe_shares enable row level security;

-- Policy helpers outside the API schema (not callable through /rest/v1/rpc); definer rights
-- let the recipes and shares policies refer to each other without recursing.
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create or replace function private.owns_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recipes where id = rid and owner_id = auth.uid())
$$;
create or replace function private.shared_with_me(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recipe_shares where recipe_id = rid and user_id = auth.uid())
$$;
revoke all on function private.owns_recipe(uuid), private.shared_with_me(uuid) from public;
grant execute on function private.owns_recipe(uuid), private.shared_with_me(uuid) to anon, authenticated;

drop policy if exists "Allow all operations" on public.recipes;
create policy "recipes read: public, own, shared" on public.recipes for select
  using (visibility = 'public' or owner_id = auth.uid() or (visibility = 'shared' and private.shared_with_me(id)));
create policy "recipes insert: own" on public.recipes for insert to authenticated with check (owner_id = auth.uid());
create policy "recipes update: own" on public.recipes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "recipes delete: own" on public.recipes for delete to authenticated using (owner_id = auth.uid());
-- TEMPORARY (dropped once the existing data is claimed by its owner's account).
create policy "recipes legacy unclaimed (temporary)" on public.recipes for all to anon using (owner_id is null) with check (owner_id is null);

create policy "shares: owner manages" on public.recipe_shares for all to authenticated
  using (private.owns_recipe(recipe_id)) with check (private.owns_recipe(recipe_id));
create policy "shares: see mine" on public.recipe_shares for select to authenticated using (user_id = auth.uid());

create or replace function public.accept_recipe_share(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; bound uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select recipe_id, user_id into rid, bound from public.recipe_shares where token = p_token;
  if rid is null then return null; end if;
  if bound = auth.uid() or private.owns_recipe(rid) then return rid; end if;
  if exists (select 1 from public.recipe_shares where recipe_id = rid and user_id = auth.uid()) then return rid; end if;
  if bound is not null then return null; end if; -- link already used by someone else
  update public.recipe_shares set user_id = auth.uid(), accepted_at = now() where token = p_token and user_id is null;
  return rid;
end $$;
revoke all on function public.accept_recipe_share(text) from public, anon;
grant execute on function public.accept_recipe_share(text) to authenticated;

create policy "profiles: read own" on public.profiles for select using (id = auth.uid());
create policy "profiles: read owners of visible recipes" on public.profiles for select
  using (exists (select 1 from public.recipes r where r.owner_id = profiles.id));
create policy "profiles: update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

alter table public.cook_sessions add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
drop policy if exists "allow all cook_sessions" on public.cook_sessions;
create policy "sessions: own" on public.cook_sessions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "sessions legacy unclaimed (temporary)" on public.cook_sessions for all to anon using (owner_id is null) with check (owner_id is null);

alter table public.ingredient_library add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
drop policy if exists "Allow all ingredient_library" on public.ingredient_library;
create policy "library: own" on public.ingredient_library for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "library legacy unclaimed (temporary)" on public.ingredient_library for all to anon using (owner_id is null) with check (owner_id is null);

drop policy if exists "allow all client_errors" on public.client_errors;
create policy "client_errors: insert" on public.client_errors for insert to anon, authenticated with check (true);
