-- Expand the materials table to match the taxonomy in the reference
-- estimating workbook (Product Name, Item #, Manufacturer, Description,
-- Finish, Category, Cost, UoM). Then create a global starter_materials
-- catalog seeded with 9,273 rows from that workbook so any new org can
-- one-click import a working library instead of typing SKUs from scratch.

set search_path = public;

-- ============ expand materials ============

alter table public.materials
  add column if not exists item_number  text,
  add column if not exists manufacturer text,
  add column if not exists finish       text,
  add column if not exists description  text;

-- Old `supplier` column collides in spirit with `manufacturer`. Keep both:
-- `manufacturer` = who built the product (Hafele, Amerock, Formica).
-- `supplier`     = who you buy it from (distributor / rep house).

create index if not exists materials_org_cat_idx on public.materials (org_id, category);
create index if not exists materials_org_mfr_idx on public.materials (org_id, manufacturer);

-- ============ starter_materials (global catalog) ============

create table if not exists public.starter_materials (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  item_number   text,
  manufacturer  text,
  description   text,
  finish        text,
  category      text not null,
  unit          text not null default 'EA',
  unit_cost     numeric(12,4) not null default 0,
  waste_pct     numeric(6,2)  not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists starter_materials_category_idx     on public.starter_materials (category);
create index if not exists starter_materials_manufacturer_idx on public.starter_materials (manufacturer);

-- Publicly readable to authenticated users; nobody but the DB owner writes.
alter table public.starter_materials enable row level security;
drop policy if exists starter_materials_read on public.starter_materials;
create policy starter_materials_read on public.starter_materials
  for select to authenticated using (true);

-- ============ import RPC ============
-- Copy the entire starter catalog into a caller-owned org. Idempotent-ish:
-- we skip rows whose (name) already exists in that org so re-runs don't
-- balloon the library.

create or replace function public.import_starter_materials(org_in uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare inserted int;
begin
  if not public.is_member(org_in) then
    raise exception 'not a member of this org';
  end if;

  insert into public.materials
    (org_id, name, item_number, manufacturer, description, finish,
     category, unit, unit_cost, waste_pct, notes)
  select
    org_in, s.name, s.item_number, s.manufacturer, s.description, s.finish,
    s.category, s.unit, s.unit_cost, s.waste_pct, s.notes
  from public.starter_materials s
  where not exists (
    select 1 from public.materials m
    where m.org_id = org_in and m.name = s.name
  );

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.import_starter_materials(uuid) from public;
grant execute on function public.import_starter_materials(uuid) to authenticated;
