-- On-drawing takeoff.
--
-- The estimator opens a drawing (PDF/image) in the takeoff view, calibrates
-- the page scale (draw a known distance, type the real feet), then places
-- products directly on the drawing:
--   count  → click markers          → qty = number of placements (EA)
--   linear → polyline               → qty = true length in feet (LF)
--   area   → polygon                → qty = true area in sqft   (SF)
--
-- Geometry is stored in PDF-space coordinates (page units at scale 1) so
-- zoom never changes saved shapes. Page scale lives on project_files.scales
-- as jsonb { "<page>": ft_per_unit }.

set search_path = public;

alter table project_files
  add column if not exists scales jsonb not null default '{}'::jsonb;

create table if not exists takeoff_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid not null references projects(id)      on delete cascade,
  file_id     uuid not null references project_files(id) on delete cascade,
  page        integer not null default 1,
  product_id  uuid references products(id) on delete set null,
  tool        text not null check (tool in ('count','linear','area')),
  points      jsonb not null default '[]'::jsonb,  -- [[x,y], ...] in PDF units
  qty         numeric(14,4) not null default 0,    -- EA count / LF length / SF area
  label       text,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_items_file_idx    on takeoff_items (file_id, page);
create index if not exists takeoff_items_project_idx on takeoff_items (project_id);

alter table takeoff_items enable row level security;
drop policy if exists takeoff_items_own on takeoff_items;
create policy takeoff_items_own on takeoff_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
