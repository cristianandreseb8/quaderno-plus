-- Guests (anonymous sign-ins) have no email: their profile is named "Guest" instead of failing
-- the sign-up on the NOT NULL display_name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Guest'))
  on conflict (id) do nothing;
  return new;
end $function$;
