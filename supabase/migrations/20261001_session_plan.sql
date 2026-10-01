-- The control center's choices for a session: when everything (or each recipe) should be ready.
-- { ready_by: ISO time | null, recipes: { [recipe id]: { ready_by } } }
alter table public.cook_sessions add column if not exists plan jsonb not null default '{}'::jsonb;
