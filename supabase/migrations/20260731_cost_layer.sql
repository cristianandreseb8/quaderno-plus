-- Phase 1: the cost layer.
-- Adds purchase price, waste and allergens to the ingredient library, and a real
-- numeric yield to recipes so cost per unit can be computed instead of guessed.
--
-- NOT APPLIED YET. Review before running against blqcppmjejtnvoqlhshp.
-- Every statement is additive and idempotent: no existing column is touched, so
-- the 417 library rows and 77 recipes keep working exactly as they do today.

-- ── ingredient_library: what it costs to buy ────────────────────────────────

alter table public.ingredient_library
  add column if not exists purchase_price numeric,          -- what you pay
  add column if not exists purchase_qty   numeric,          -- for this much
  add column if not exists purchase_unit  text,             -- of this unit: kg | g | l | ml | ud
  add column if not exists currency       text default 'EUR',
  add column if not exists price_date     date,             -- when that price was true
  add column if not exists supplier       text,
  add column if not exists waste_pct      numeric default 0 -- merma: % lost in prep
    check (waste_pct >= 0 and waste_pct < 100);

-- Normalized cost, computed by the database so the app can never derive it wrong.
-- Base unit is the small unit of each dimension: g, ml, or one piece. This matches
-- toGrams() in recipeCalc.js, which already treats 1 ml as 1 g.
alter table public.ingredient_library
  add column if not exists cost_per_base numeric
  generated always as (
    case
      when purchase_price is null or purchase_qty is null or purchase_qty = 0 then null
      else purchase_price / (purchase_qty *
        case lower(coalesce(purchase_unit, 'g'))
          when 'kg' then 1000
          when 'l'  then 1000
          else 1
        end)
    end
  ) stored;

comment on column public.ingredient_library.cost_per_base is
  'Cost of one gram, one ml, or one piece, in `currency`. Generated — never write to it.';

-- ── ingredient_library: allergens ───────────────────────────────────────────
-- The 14 declarable allergens in EU Regulation 1169/2011. Stored as text[] to match
-- how `categories` and `aliases` already work in this table.

alter table public.ingredient_library
  add column if not exists allergens text[] default '{}',
  add column if not exists allergens_source text                 -- who decided
    check (allergens_source in ('ai', 'manual', 'supplier')),
  add column if not exists allergens_confirmed_at timestamptz;   -- null = AI guess, unreviewed

comment on column public.ingredient_library.allergens is
  'Subset of: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs';

-- ── recipes: a yield you can divide by ──────────────────────────────────────
-- `servings` is free text ("160 piezas de 250g") and is already wrong on some rows:
-- the 9000 g brioche batch says 160 pieces of 250 g, which would be 40 kg of dough.
-- Cost per unit needs a number, so it gets its own columns. `servings` stays as the
-- human label and is not modified.

alter table public.recipes
  add column if not exists yield_units      numeric,        -- 36
  add column if not exists yield_unit_label text,           -- 'pieza de 250 g'
  add column if not exists batch_note       text;

-- ── indexes ─────────────────────────────────────────────────────────────────
-- Costing a recipe looks up library rows by name; allergen rollups scan the array.

create index if not exists ingredient_library_priced_idx
  on public.ingredient_library (name) where purchase_price is not null;

create index if not exists ingredient_library_allergens_idx
  on public.ingredient_library using gin (allergens);
