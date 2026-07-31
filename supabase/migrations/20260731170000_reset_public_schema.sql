-- Reset the public schema before installing millwork.io.
--
-- This exists because we are re-using the Supabase project that previously
-- hosted grainhub (suppliers/forums/wiki/news/events/etc.). Rather than list
-- every legacy object, we drop every table + routine that lives in the public
-- schema. Supabase-managed schemas (auth, storage, realtime, etc.) are left
-- alone, so existing auth.users still exist — they will simply have no
-- millwork.io membership yet and will be sent through /onboarding on first
-- sign-in.
--
-- WARNING: this deletes all rows in public.* on the first run against the
-- old project. Intentional.

do $$
declare r record;
begin
  -- Drop tables (cascades to their triggers, constraints, indexes).
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- Drop remaining functions / procedures.
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('drop routine if exists %s cascade', r.sig);
  end loop;

  -- Drop remaining views (materialized or otherwise).
  for r in
    select table_name, table_type from information_schema.tables
    where table_schema = 'public' and table_type like '%VIEW%'
  loop
    if r.table_type = 'VIEW' then
      execute format('drop view if exists public.%I cascade', r.table_name);
    else
      execute format('drop materialized view if exists public.%I cascade', r.table_name);
    end if;
  end loop;

  -- Drop custom types (enums, composites) if any.
  for r in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','c','d')
      and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;
