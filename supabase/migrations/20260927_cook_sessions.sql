-- A cooking session: the recipes planned for one bake/cook, the merged shopping checklist
-- ("have" doubles as a stock snapshot for the future stock system) and per-recipe progress.
create table if not exists public.cook_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null default '',
  status text not null default 'active' check (status in ('active', 'done')),
  recipes jsonb not null default '[]'::jsonb,   -- [{ "id": uuid, "factor": number }]
  shopping jsonb not null default '{}'::jsonb,  -- { have: {key: {name, qty, unit, at}}, qty: {key: text}, extra: [{id, text, have}] }
  progress jsonb not null default '{}'::jsonb   -- { recipeId: { ing: [idx], steps: [idx] } }
);

create index if not exists cook_sessions_status_idx on public.cook_sessions (status, updated_at desc);

alter table public.cook_sessions enable row level security;
create policy "allow all cook_sessions" on public.cook_sessions for all using (true) with check (true);
