-- Products library + project drawing uploads.
--
-- PRODUCTS: a product is a sellable assembly (base cabinet, die wall,
-- paneling, trim run) priced per unit (LF / SF / EA). Its cost rolls up
-- from components:
--   product_materials — "per 1 product unit, consume X of material Y
--                        (+waste%)"
--   product_labor     — "per 1 product unit, spend H hours of trade Z"
-- The estimator drops a product onto an estimate as ONE line whose
-- unit_cost is a snapshot of the rollup at insert time.
--
-- DRAWINGS: architectural drawings (PDFs, images) attach to projects.
-- Binary lives in the private 'drawings' storage bucket under
-- <user_id>/<project_id>/<filename>; metadata lives in project_files.

set search_path = public;

-- ============ project_files ============

create table if not exists project_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  kind         text not null default 'drawing',
  created_at   timestamptz not null default now()
);
create index if not exists project_files_project_idx on project_files (project_id, created_at desc);

alter table project_files enable row level security;
drop policy if exists project_files_own on project_files;
create policy project_files_own on project_files for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ products ============

create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  category     text,                -- Cabinets / Die Walls / Paneling / Trim / ...
  unit         text not null default 'LF' check (unit in ('LF','SF','EA')),
  description  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists products_user_idx on products (user_id, category, name);
create trigger products_updated_at before update on products for each row execute function set_updated_at();

create table if not exists product_materials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  material_id   uuid not null references materials(id) on delete cascade,
  qty_per_unit  numeric(14,4) not null default 0,   -- material units consumed per 1 product unit
  waste_pct     numeric(6,2)  not null default 0,   -- overrides library waste when > 0
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists product_materials_product_idx on product_materials (product_id, sort_order);

create table if not exists product_labor (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  labor_rate_id  uuid not null references labor_rates(id) on delete cascade,
  hours_per_unit numeric(12,4) not null default 0,  -- trade hours per 1 product unit
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists product_labor_product_idx on product_labor (product_id, sort_order);

do $$
declare t text;
begin
  for t in select unnest(array['products','product_materials','product_labor'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_own on %I', t, t);
    execute format($sql$
      create policy %I_own on %I for all to authenticated
        using (user_id = auth.uid()) with check (user_id = auth.uid());
    $sql$, t, t);
  end loop;
end $$;

-- ============ estimate_lines: allow product lines ============

alter table estimate_lines
  add column if not exists product_id uuid references products(id) on delete set null;

alter table estimate_lines drop constraint if exists estimate_lines_kind_check;
alter table estimate_lines add constraint estimate_lines_kind_check
  check (kind in ('material','labor','product','other'));

-- ============ storage: private 'drawings' bucket ============
-- Guarded: on newer Supabase projects the postgres role may not own the
-- storage schema. If any statement is refused we raise a notice instead of
-- failing the whole migration — then create the bucket + policies in the
-- Dashboard (Storage → New bucket 'drawings', private; policies below).

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('drawings', 'drawings', false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'Could not create storage bucket via SQL (%). Create a private bucket named "drawings" in the Dashboard.', sqlerrm;
end $$;

do $$
begin
  execute $sql$
    create policy drawings_rw on storage.objects for all to authenticated
      using (
        bucket_id = 'drawings'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'drawings'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $sql$;
exception
  when duplicate_object then null;
  when others then
    raise notice 'Could not create storage policy via SQL (%). Add an RLS policy on storage.objects for bucket "drawings" scoped to auth.uid() folder prefix in the Dashboard.', sqlerrm;
end $$;
