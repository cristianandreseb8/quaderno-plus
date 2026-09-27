-- Video links shown inside a recipe (YouTube, Vimeo, Instagram, TikTok, …): [{ "id": text, "url": text }]
alter table public.recipes add column if not exists videos jsonb not null default '[]'::jsonb;
