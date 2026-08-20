-- Product system overhaul: component slots + universal labor operations
-- + unit-agnostic estimating.
--
-- One product can now be measured with any takeoff tool (count / linear /
-- area). Its recipe stays defined per one BASE unit (products.unit) and
-- default dimensions convert other measurements into that base:
--   count EA -> LF via default_width_ft, -> SF via width x height
--   linear LF -> SF via height, -> EA via width
--   area  SF -> LF via height, -> EA via width x height
--
-- product_materials.slot names the component the material fills (Case
-- Sides, Doors, Drawer Boxes, Hinges, Pulls, Edgebanding, Interior
-- Finish, ...) so the builder reads like a cabinet spec, not a grab bag.
--
-- product_labor.op names the universal operation (Saw, CNC, Edgebanding,
-- Assembly, Finishing, Install, ...) the hours belong to.

set search_path = public;

alter table products
  add column if not exists default_width_ft  numeric(8,3) not null default 3,
  add column if not exists default_height_ft numeric(8,3) not null default 3,
  add column if not exists default_depth_ft  numeric(8,3) not null default 2;

alter table product_materials add column if not exists slot text;
alter table product_labor     add column if not exists op   text;
