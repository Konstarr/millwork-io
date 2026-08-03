-- Nuke the org/membership layer and refactor to single-user.
--
-- The prior multi-tenant design (orgs + memberships + is_member(org_id)
-- RLS) was correct in principle but painful in two ways for a solo dev
-- building the app:
--   1. Every signup demanded a "name your company" onboarding step.
--   2. RLS policies that reference memberships from a policy ON memberships
--      recursed infinitely, and per-row is_member() function calls blew
--      the Postgres stack on 9k-row selects.
--
-- Fix: drop the whole layer. Every business row now belongs to exactly
-- one auth.users row (user_id) and RLS is a one-liner: user_id = auth.uid().
-- Client code no longer needs to know about orgs at all — on INSERT, the
-- column default fills user_id in automatically; on SELECT, RLS filters
-- automatically. Multi-tenant can come back later cleanly if needed.

set search_path = public;

-- ============ drop the old layer ============
drop function if exists public.import_starter_materials(uuid) cascade;
drop function if exists public.create_org(text, text)         cascade;
drop function if exists public.is_admin(uuid)                 cascade;
drop function if exists public.is_member(uuid)                cascade;

drop table if exists public.estimate_lines cascade;
drop table if exists public.estimates      cascade;
drop table if exists public.customers      cascade;
drop table if exists public.projects       cascade;
drop table if exists public.materials      cascade;
drop table if exists public.labor_rates    cascade;
drop table if exists public.memberships    cascade;
drop table if exists public.orgs           cascade;

-- ============ rebuild business tables ============

create table customers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  address1      text,
  address2      text,
  city          text,
  state         text,
  postal_code   text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index customers_user_idx on customers (user_id, name);
create trigger customers_updated_at before update on customers for each row execute function set_updated_at();

create table projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id   uuid references customers(id) on delete set null,
  name          text not null,
  status        text not null default 'draft'
                  check (status in ('draft','bidding','awarded','in-progress','complete','lost')),
  bid_due       date,
  location      text,
  scope_summary text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index projects_user_idx      on projects (user_id, updated_at desc);
create index projects_customer_idx  on projects (customer_id);
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();

create table materials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  item_number   text,
  manufacturer  text,
  description   text,
  finish        text,
  category      text,
  unit          text not null default 'EA',
  unit_cost     numeric(12,4) not null default 0,
  waste_pct     numeric(6,2)  not null default 0,
  supplier      text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index materials_user_idx     on materials (user_id, category);
create index materials_user_mfr_idx on materials (user_id, manufacturer);
create trigger materials_updated_at before update on materials for each row execute function set_updated_at();

create table labor_rates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  category      text,
  hourly_rate   numeric(10,2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index labor_rates_user_idx on labor_rates (user_id, name);
create trigger labor_rates_updated_at before update on labor_rates for each row execute function set_updated_at();

create table estimates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  name          text,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','rejected')),
  markup_pct    numeric(6,2)  not null default 15,
  tax_pct       numeric(6,3)  not null default 0,
  total_amount  numeric(14,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index estimates_user_idx     on estimates (user_id, updated_at desc);
create index estimates_project_idx  on estimates (project_id);
create trigger estimates_updated_at before update on estimates for each row execute function set_updated_at();

create table estimate_lines (
  id             uuid primary key default gen_random_uuid(),
  estimate_id    uuid not null references estimates(id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('material','labor','other')),
  description    text not null default '',
  material_id    uuid references materials(id)   on delete set null,
  labor_rate_id  uuid references labor_rates(id) on delete set null,
  quantity       numeric(14,4) not null default 0,
  unit           text not null default 'EA',
  unit_cost      numeric(12,4) not null default 0,
  waste_pct      numeric(6,2)  not null default 0,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index estimate_lines_est_idx on estimate_lines (estimate_id, sort_order);

-- ============ shop / burden settings, per user ============
create table user_settings (
  user_id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  overhead_pct        numeric(6,2) not null default 15,
  fringe_pct          numeric(6,2) not null default 0,
  default_markup_pct  numeric(6,2) not null default 15,
  company_name        text,
  company_address     text,
  company_phone       text,
  company_tax_pct     numeric(6,3) not null default 7.5,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger user_settings_updated_at before update on user_settings for each row execute function set_updated_at();

-- ============ RLS ============
-- Single predicate for every table: the row must belong to the caller.
-- Simple, cannot recurse, planner-friendly.

do $$
declare t text;
begin
  for t in select unnest(array[
    'customers','projects','materials','labor_rates',
    'estimates','estimate_lines','user_settings'
  ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_own on %I', t, t);
    execute format($sql$
      create policy %I_own on %I for all to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $sql$, t, t);
  end loop;
end $$;

-- ============ import RPC (no more org arg) ============
create or replace function public.import_starter_materials()
returns integer
language plpgsql security definer set search_path = public as $$
declare inserted int;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  insert into public.materials
    (user_id, name, item_number, manufacturer, description, finish,
     category, unit, unit_cost, waste_pct, notes)
  select
    auth.uid(), s.name, s.item_number, s.manufacturer, s.description, s.finish,
    s.category, s.unit, s.unit_cost, s.waste_pct, s.notes
  from public.starter_materials s
  where not exists (
    select 1 from public.materials m
    where m.user_id = auth.uid() and m.name = s.name
  );

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.import_starter_materials() from public;
grant execute on function public.import_starter_materials() to authenticated;
