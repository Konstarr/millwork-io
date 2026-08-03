-- Optimize RLS: replace per-row is_member(org_id) function calls with a
-- direct subquery predicate. Postgres treats this as a semi-join and
-- evaluates the membership set once per query, not once per row. Fixes
-- "stack depth limit exceeded" when reading tables with 9k+ rows.
--
-- Also swaps is_admin(org_id) for its inlined equivalent on the two
-- tables (orgs, memberships) that use it.

set search_path = public;

-- ============ helper: membership subquery ============
-- We inline this as literal SQL in each policy so Postgres can plan it
-- once per query. is_member/is_admin still exist for use in RPCs.

-- ============ orgs ============
drop policy if exists orgs_select on orgs;
create policy orgs_select on orgs for select
  using (id in (select org_id from memberships where user_id = auth.uid()));

drop policy if exists orgs_update on orgs;
create policy orgs_update on orgs for update
  using (id in (select org_id from memberships where user_id = auth.uid() and role in ('owner','admin')))
  with check (id in (select org_id from memberships where user_id = auth.uid() and role in ('owner','admin')));

-- ============ memberships ============
drop policy if exists memberships_select      on memberships;
drop policy if exists memberships_admin_write on memberships;

-- Users can always see membership rows for orgs they belong to.
create policy memberships_select on memberships for select
  using (org_id in (select org_id from memberships m2 where m2.user_id = auth.uid()));

-- Only owners/admins can add/remove members.
create policy memberships_write on memberships for all
  using (org_id in (select org_id from memberships m2 where m2.user_id = auth.uid() and m2.role in ('owner','admin')))
  with check (org_id in (select org_id from memberships m2 where m2.user_id = auth.uid() and m2.role in ('owner','admin')));

-- ============ business tables (customers, projects, materials, labor_rates, estimates, estimate_lines) ============
do $$
declare t text;
begin
  for t in select unnest(array['customers','projects','materials','labor_rates','estimates','estimate_lines'])
  loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('drop policy if exists %I_write  on %I', t, t);
    execute format($sql$
      create policy %I_select on %I for select
        using (org_id in (select org_id from memberships where user_id = auth.uid()));
    $sql$, t, t);
    execute format($sql$
      create policy %I_write on %I for all
        using (org_id in (select org_id from memberships where user_id = auth.uid()))
        with check (org_id in (select org_id from memberships where user_id = auth.uid()));
    $sql$, t, t);
  end loop;
end $$;
