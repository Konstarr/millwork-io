-- 3D takeoff support.
-- 'wall' becomes a takeoff tool (traced wall centerlines, qty = LF, no
-- product required). plan_regions marks the floor-plan rectangle per page
-- ({ "<page>": {x, y, w, h} } in PDF units); wall_height_ft is the default
-- extrusion height for the 3D view.

set search_path = public;

alter table takeoff_items drop constraint if exists takeoff_items_tool_check;
alter table takeoff_items add constraint takeoff_items_tool_check
  check (tool in ('count','linear','area','wall'));

alter table project_files
  add column if not exists plan_regions   jsonb not null default '{}'::jsonb,
  add column if not exists wall_height_ft numeric(6,2) not null default 9;
