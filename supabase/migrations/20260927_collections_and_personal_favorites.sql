-- Collections: named lists of recipes a person keeps ("Recipes I like"). Any recipe they can
-- see can go in one — their own, one shared with them, or someone's public recipe — without copying it.
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create index collections_owner_idx on public.collections(owner_id);

create table public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, recipe_id)
);
create index collection_items_recipe_idx on public.collection_items(recipe_id);

-- Favorites are personal: each person stars any recipe they can see.
create table public.recipe_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
create index recipe_favorites_recipe_idx on public.recipe_favorites(recipe_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.recipe_favorites enable row level security;

create policy "collections: own" on public.collections for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Items belong to the collection's owner. A recipe can only be added if the person can see it
-- (the subquery on recipes runs under that person's own read policy).
create policy "collection items: own" on public.collection_items for all to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())))
  with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

create policy "favorites: own" on public.recipe_favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.recipes r where r.id = recipe_id));

-- Stars set before favorites became personal belong to the recipe's owner.
insert into public.recipe_favorites (user_id, recipe_id, created_at)
select owner_id, id, coalesce(updated_at, created_at, now()) from public.recipes
where is_favorite and owner_id is not null
on conflict do nothing;
