-- Reservation migration Phase 3A follow-up: least-privilege timezone access
-- for the authenticated manager shadow read model.
--
-- venue_settings intentionally remains RPC-only for every other column and
-- operation. The security-invoker shadow view needs only timezone to compare
-- legacy local timestamps with Reservation Session timestamptz values.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $migration_guard$
declare
  v_rls_enabled boolean;
  v_rls_forced boolean;
begin
  select relation.relrowsecurity, relation.relforcerowsecurity
    into v_rls_enabled, v_rls_forced
  from pg_class as relation
  where relation.oid = 'public.venue_settings'::regclass;

  if not coalesce(v_rls_enabled, false)
     or not coalesce(v_rls_forced, false) then
    raise exception
      'venue_settings must retain enabled and forced RLS before shadow access';
  end if;

  if to_regclass('public.reservation_shadow_mismatches') is null then
    raise exception 'Phase 3A shadow view is missing';
  end if;

  if not exists (
    select 1
    from pg_attribute as attribute
    where attribute.attrelid = 'public.venue_settings'::regclass
      and attribute.attname = 'timezone'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception 'venue_settings.timezone is missing';
  end if;
end;
$migration_guard$;

create policy "managers read venue timezone for reservation shadow"
on public.venue_settings
for select
to authenticated
using (
  (select exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = (select auth.uid())
      and staff.role = 'admin'
  ))
);

grant select (timezone) on table public.venue_settings to authenticated;

do $privilege_guard$
declare
  v_column_grant_count integer;
begin
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
      'authenticated must receive SELECT on venue_settings.timezone only';
  end if;
end;
$privilege_guard$;

notify pgrst, 'reload schema';

commit;
