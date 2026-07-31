-- millwork.io — initial multi-tenant schema.
--
-- Every business object is scoped by org_id. RLS gates each table so a user
-- can only read/write rows in orgs they belong to. All timestamps are UTC.
--
-- Apply once against a fresh Supabase project:
--   1. SQL Editor > New query
--   2. Paste this file, run.
-- The create_org RPC is used by the OrgOnboarding page to create a new
-- workspace and add the creating user as owner in one transaction.

set search_path = public;

-- =============== helpers ===============

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============== orgs & memberships ===============

create table if not exists orgs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text unique,
  overhead_pct          numeric(6,2) not null default 0,
  fringe_pct            numeric(6,2) not null default 0,
  default_markup_pct    numeric(6,2) not null default 15,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger orgs_updated_at before update on orgs for each row execute function set_updated_at();

create table if not exists memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists memberships_org_idx  on memberships (org_id);

-- Helper: is caller a member of :org?
create or replace function is_member(org uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from memberships
    where org_id = org and user_id = auth.uid()
  );
$$;

-- Helper: is caller an owner/admin of :org?
create or replace function is_admin(org uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from memberships
    where org_id = org and user_id = auth.uid() and role in ('owner','admin')
  );
$$;

-- =============== business tables ===============

create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
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
create trigger customers_updated_at before update on customers for each row execute function set_updated_at();
create index if not exists customers_org_idx on customers (org_id, name);

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
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
create trigger projects_updated_at before update on projects for each row execute function set_updated_at();
create index if not exists projects_org_idx      on projects (org_id, updated_at desc);
create index if not exists projects_customer_idx on projects (customer_id);

create table if not exists materials (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sku         text,
  name        text not null,
  category    text,
  unit        text not null default 'ea',
  unit_cost   numeric(12,4) not null default 0,
  waste_pct   numeric(6,2) not null default 0,
  supplier    text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger materials_updated_at before update on materials for each row execute function set_updated_at();
create index if not exists materials_org_idx on materials (org_id, name);

create table if not exists labor_rates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  category      text,
  hourly_rate   numeric(10,2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger labor_rates_updated_at before update on labor_rates for each row execute function set_updated_at();
create index if not exists labor_rates_org_idx on labor_rates (org_id, name);

create table if not exists estimates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  name          text,
  status        text not null default 'draft'
                 check (status in ('draft','sent','accepted','rejected')),
  markup_pct    numeric(6,2) not null default 15,
  tax_pct       numeric(6,3) not null default 0,
  total_amount  numeric(14,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger estimates_updated_at before update on estimates for each row execute function set_updated_at();
create index if not exists estimates_org_idx     on estimates (org_id, updated_at desc);
create index if not exists estimates_project_idx on estimates (project_id);

create table if not exists estimate_lines (
  id             uuid primary key default gen_random_uuid(),
  estimate_id    uuid not null references estimates(id) on delete cascade,
  org_id         uuid not null references orgs(id) on delete cascade,
  kind           text not null check (kind in ('material','labor','other')),
  description    text not null default '',
  material_id    uuid references materials(id)   on delete set null,
  labor_rate_id  uuid references labor_rates(id) on delete set null,
  quantity       numeric(14,4) not null default 0,
  unit           text not null default 'ea',
  unit_cost      numeric(12,4) not null default 0,
  waste_pct      numeric(6,2)  not null default 0,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists estimate_lines_est_idx on estimate_lines (estimate_id, sort_order);

-- =============== RLS ===============

alter table orgs            enable row level security;
alter table memberships     enable row level security;
alter table customers       enable row level security;
alter table projects        enable row level security;
alter table materials       enable row level security;
alter table labor_rates     enable row level security;
alter table estimates       enable row level security;
alter table estimate_lines  enable row level security;

-- orgs: members can read their org; owners/admins can update.
drop policy if exists orgs_select on orgs;
create policy orgs_select on orgs for select
  using (is_member(id));
drop policy if exists orgs_update on orgs;
create policy orgs_update on orgs for update
  using (is_admin(id)) with check (is_admin(id));
-- Insert of orgs is done through create_org() RPC (security definer);
-- deliberately no INSERT policy for authenticated users.

-- memberships: readable by anyone in the same org; admins manage them.
drop policy if exists memberships_select on memberships;
create policy memberships_select on memberships for select
  using (is_member(org_id));
drop policy if exists memberships_admin_write on memberships;
create policy memberships_admin_write on memberships for all
  using (is_admin(org_id)) with check (is_admin(org_id));

-- Generic "any member of org_id" pattern for the rest.
do $$
declare
  t text;
begin
  for t in select unnest(array['customers','projects','materials','labor_rates','estimates','estimate_lines'])
  loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (is_member(org_id))', t, t);
    execute format('drop policy if exists %I_write on %I',  t, t);
    execute format('create policy %I_write on %I for all using (is_member(org_id)) with check (is_member(org_id))', t, t);
  end loop;
end $$;

-- =============== create_org RPC ===============
-- Called from the OrgOnboarding page. Creates the workspace and makes the
-- caller the owner in one transaction. security definer so a signed-in user
-- can bootstrap their first org even though orgs has no INSERT policy.

create or replace function create_org(name_in text, slug_in text default null)
returns table (id uuid, name text, slug text)
language plpgsql security definer set search_path = public as $$
declare
  new_id  uuid;
  final_slug text;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;
  final_slug := coalesce(nullif(slug_in, ''), regexp_replace(lower(name_in), '[^a-z0-9]+', '-', 'g'));
  insert into orgs (name, slug) values (name_in, final_slug)
    returning orgs.id into new_id;
  insert into memberships (org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return query select orgs.id, orgs.name, orgs.slug from orgs where orgs.id = new_id;
end;
$$;

revoke all on function create_org(text, text) from public;
grant execute on function create_org(text, text) to authenticated;
