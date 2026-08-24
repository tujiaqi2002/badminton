-- Reservation migration Phase 3A follow-up: remove the redundant permissive
-- deny policy that overlaps the manager-only venue timezone SELECT policy.
--
-- Row-level security remains enabled and forced. Authenticated clients retain
-- only the timezone column grant, managers retain the only applicable SELECT
-- policy, and every client DML operation remains denied by both missing table
-- privileges and the absence of an applicable RLS policy.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $migration_guard$
declare
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_policy_count integer;
  v_column_grant_count integer;
  v_column_privilege_count integer;
begin
  select relation.relrowsecurity, relation.relforcerowsecurity
    into v_rls_enabled, v_rls_forced
  from pg_class as relation
  where relation.oid = 'public.venue_settings'::regclass;

  if not coalesce(v_rls_enabled, false)
     or not coalesce(v_rls_forced, false) then
    raise exception
      'venue_settings must retain enabled and forced RLS before policy consolidation';
  end if;

  select count(*)::integer
    into v_policy_count
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'venue_settings'
    and policy.policyname = 'venue_settings_rpc_only'
    and policy.permissive = 'PERMISSIVE'
    and policy.cmd = 'ALL'
    and policy.roles = array['authenticated']::name[]
    and policy.qual = 'false'
    and policy.with_check = 'false';

  if v_policy_count <> 1 then
    raise exception
      'venue_settings_rpc_only policy does not match the reviewed deny policy';
  end if;

  select count(*)::integer
    into v_policy_count
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'venue_settings'
    and policy.policyname =
      'managers read venue timezone for reservation shadow'
    and policy.permissive = 'PERMISSIVE'
    and policy.cmd = 'SELECT'
    and policy.roles = array['authenticated']::name[]
    and policy.with_check is null
    and position('staff_members' in policy.qual) > 0
    and position('auth.uid' in policy.qual) > 0
    and position('admin' in policy.qual) > 0;

  if v_policy_count <> 1 then
    raise exception
      'manager-only venue timezone SELECT policy does not match the reviewed boundary';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'insert'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'update'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'delete'
     ) then
    raise exception
      'authenticated must not have table-level venue_settings privileges';
  end if;

  select count(*)::integer
    into v_column_grant_count
  from information_schema.column_privileges as privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = 'venue_settings'
    and privilege.grantee = 'authenticated'
    and privilege.privilege_type = 'SELECT';

  if v_column_grant_count <> 1
     or not has_column_privilege(
       'authenticated',
       'public.venue_settings',
       'timezone',
       'select'
     ) then
    raise exception
      'authenticated must retain SELECT on venue_settings.timezone only';
  end if;

  select count(*)::integer
    into v_column_privilege_count
  from information_schema.column_privileges as privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = 'venue_settings'
    and privilege.grantee = 'authenticated';

  if v_column_privilege_count <> 1 then
    raise exception
      'authenticated venue_settings column privileges must be timezone SELECT only';
  end if;
end;
$migration_guard$;

drop policy venue_settings_rpc_only on public.venue_settings;

do $postcondition_guard$
declare
  v_policy_count integer;
  v_column_privilege_count integer;
begin
  if exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'venue_settings'
      and policy.policyname = 'venue_settings_rpc_only'
  ) then
    raise exception 'redundant venue_settings_rpc_only policy still exists';
  end if;

  select count(*)::integer
    into v_policy_count
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'venue_settings'
    and policy.permissive = 'PERMISSIVE'
    and policy.roles @> array['authenticated']::name[]
    and policy.cmd in ('ALL', 'SELECT');

  if v_policy_count <> 1 then
    raise exception
      'authenticated must have exactly one permissive venue_settings SELECT policy';
  end if;

  if exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'venue_settings'
      and policy.roles @> array['authenticated']::name[]
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception
      'authenticated venue_settings DML must remain RLS default-denied';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'insert'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'update'
     )
     or has_table_privilege(
       'authenticated',
       'public.venue_settings',
       'delete'
     ) then
    raise exception
      'policy consolidation changed authenticated table privileges';
  end if;

  select count(*)::integer
    into v_column_privilege_count
  from information_schema.column_privileges as privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = 'venue_settings'
    and privilege.grantee = 'authenticated';

  if v_column_privilege_count <> 1
     or not has_column_privilege(
       'authenticated',
       'public.venue_settings',
       'timezone',
       'select'
     ) then
    raise exception
      'policy consolidation changed authenticated column privileges';
  end if;
end;
$postcondition_guard$;

notify pgrst, 'reload schema';

commit;
