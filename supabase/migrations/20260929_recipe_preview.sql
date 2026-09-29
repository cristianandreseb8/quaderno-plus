-- Link previews (WhatsApp, iMessage, Slack…): the title, photo and a line about a recipe, for a
-- public recipe by its id or an invite-only one by a valid invite token — what the link opens.
create or replace function public.recipe_preview(p_id uuid default null, p_token text default null)
returns table (title text, thumbnail text, category text, servings text, owner_name text)
language sql stable security definer set search_path = public as $$
  select r.title, r.thumbnail, r.category, r.servings, p.display_name
  from public.recipes r
  left join public.profiles p on p.id = r.owner_id
  where (p_id is not null and r.id = p_id and r.visibility = 'public')
     or (p_token is not null and length(p_token) >= 32 and r.visibility in ('shared', 'public')
         and r.id = (select s.recipe_id from public.recipe_shares s where s.token = p_token))
  limit 1
$$;
revoke all on function public.recipe_preview(uuid, text) from public;
grant execute on function public.recipe_preview(uuid, text) to anon, authenticated;
