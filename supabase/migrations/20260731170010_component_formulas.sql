-- Formula-driven component quantities.
--
-- Component material quantities and labor hours can now be expressions
-- over the product's dimensions (variables W, H, D in feet), evaluated
-- PER ONE PRODUCT INSTANCE. Examples:
--   Case Sides   qty_formula = 'H * D * 2'
--   Case Back    qty_formula = 'W * H'
--   Edgebanding  qty_formula = 'W * 4 + H * 2'
--
-- The app evaluates the formula with the product's default dims, converts
-- to the recipe base unit (LF: /W, SF: /(W*H), EA: as-is), and caches the
-- result in the existing numeric columns (qty_per_unit / hours_per_unit)
-- so cost math everywhere else is unchanged. The formula text is the
-- source of truth for editing; the number is the compiled output.

set search_path = public;

alter table product_materials add column if not exists qty_formula   text;
alter table product_labor     add column if not exists hours_formula text;
