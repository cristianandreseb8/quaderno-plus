-- Pre-accounts data was claimed by its owner's account on 2026-09-27, so the temporary
-- policies that kept it readable without signing in are no longer needed.
drop policy if exists "recipes legacy unclaimed (temporary)" on public.recipes;
drop policy if exists "sessions legacy unclaimed (temporary)" on public.cook_sessions;
drop policy if exists "library legacy unclaimed (temporary)" on public.ingredient_library;
