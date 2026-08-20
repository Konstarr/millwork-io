-- Dynamic product parameters.
--
-- products.params is a jsonb object of custom formula variables and their
-- defaults, e.g. { "SHELFQTY": 3 }. Formulas can reference them alongside
-- W/H/D: Shelves qty_formula = 'W * D * SHELFQTY'.
--
-- takeoff_items.param_overrides snapshots the values chosen for that
-- placement (the estimator can bump SHELFQTY to 5 in the takeoff rail
-- before placing). Placements with different parameter sets group into
-- separate configured estimate lines with their own evaluated unit cost.

set search_path = public;

alter table products      add column if not exists params          jsonb not null default '{}'::jsonb;
alter table takeoff_items add column if not exists param_overrides jsonb not null default '{}'::jsonb;
