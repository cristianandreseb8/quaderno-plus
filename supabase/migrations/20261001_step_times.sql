-- Timing the work: how long each step of a recipe really took (chef mode times them by itself, a
-- step can also be timed by hand), and a clock for a whole cooking session. The app learns typical
-- times from these and plans parallel work with them.
create table if not exists public.step_times (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete set null,
  step_key text not null,              -- the step's index in its recipe
  step_text text not null default '',  -- what the step said, so a time keeps its meaning after edits
  session_id uuid references public.cook_sessions(id) on delete set null,
  factor numeric not null default 1,   -- batch size it was made at
  source text not null default 'chef', -- 'chef' (timed by chef mode) or 'manual' (a stopwatch)
  started_at timestamptz not null,
  ended_at timestamptz not null,
  active_ms integer not null check (active_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists step_times_owner_recipe_idx on public.step_times (owner_id, recipe_id);
alter table public.step_times enable row level security;
drop policy if exists "step_times: own" on public.step_times;
create policy "step_times: own" on public.step_times for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The session's clock: { start, end, paused_ms, paused_at } (ISO times, milliseconds).
alter table public.cook_sessions add column if not exists clock jsonb not null default '{}'::jsonb;
