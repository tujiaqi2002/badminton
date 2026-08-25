-- Reservation Phase 3B.2 recovery: converge the hosted staging assertion
-- (where migration 45 already ran) with the corrected first-application
-- definition in migration 45. Production has not recorded migration 45, so it
-- will reach this migration with the corrected definition already installed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

do $migration_history$
declare
  v_version_count integer;
  v_latest_version text;
begin
  select count(*)::integer, max(version)
    into v_version_count, v_latest_version
  from supabase_migrations.schema_migrations;

  if v_version_count <> 46
     or v_latest_version <> '20260824181500' then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B zero-price recovery requires the exact 46-migration activated baseline; found count=%s latest=%s',
        v_version_count,
        coalesce(v_latest_version, '<none>')
      );
  end if;
end;
$migration_history$;

do $reconcile_assertion$
declare
  v_function regprocedure;
  v_definition text;
  v_old_shape text := $old$
  where (balance.allocated_amount >= balance.total_amount
      and balance.payment_status <> 'paid')
     or (balance.allocated_amount > 0
      and balance.allocated_amount < balance.total_amount
      and balance.payment_status <> 'pay_at_venue')
     or (balance.allocated_amount <= 0
      and balance.has_refund
      and balance.payment_status <> 'refunded')$old$;
  v_new_shape text := $new$
  where balance.allocated_amount > balance.total_amount
     or (balance.payment_status = 'paid'
      and balance.allocated_amount is distinct from balance.total_amount)
     or (balance.total_amount > 0
      and balance.allocated_amount = balance.total_amount
      and balance.payment_status <> 'paid')
     or (balance.allocated_amount > 0
      and balance.allocated_amount < balance.total_amount
      and balance.payment_status <> 'pay_at_venue')
     or (balance.allocated_amount <= 0
      and balance.has_refund
      and balance.payment_status <> 'refunded')$new$;
  v_old_count integer;
  v_new_count integer;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
begin
  v_function := pg_catalog.to_regprocedure(
    'private.assert_reservation_phase3b_activation()'
  );

  if v_function is null then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B activation assertion is missing';
  end if;

  select
    pg_catalog.pg_get_functiondef(routine.oid),
    routine.prosecdef,
    routine.provolatile,
    routine.proconfig
    into v_definition, v_security_definer, v_volatility, v_config
  from pg_catalog.pg_proc as routine
  where routine.oid = v_function;

  if v_security_definer
     or v_volatility <> 's'
     or not coalesce(v_config @> array['search_path=""']::text[], false) then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B activation assertion security shape drifted';
  end if;

  v_old_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_shape, ''))
  ) / pg_catalog.length(v_old_shape);
  v_new_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new_shape, ''))
  ) / pg_catalog.length(v_new_shape);

  if v_old_count = 1 and v_new_count = 0 then
    execute pg_catalog.replace(v_definition, v_old_shape, v_new_shape);
  elsif v_old_count = 0 and v_new_count = 1 then
    null;
  else
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'Phase 3B activation assertion source drifted; old_shape=%s recovered_shape=%s',
        v_old_count,
        v_new_count
      );
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid)
    into v_definition
  from pg_catalog.pg_proc as routine
  where routine.oid = v_function;

  v_old_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_shape, ''))
  ) / pg_catalog.length(v_old_shape);
  v_new_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new_shape, ''))
  ) / pg_catalog.length(v_new_shape);

  if v_old_count <> 0 or v_new_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'Phase 3B activation assertion reconciliation did not converge';
  end if;
end;
$reconcile_assertion$;

revoke all on function private.assert_reservation_phase3b_activation()
from public, anon, authenticated, service_role;

do $permission_assertion$
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'private.assert_reservation_phase3b_activation()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.assert_reservation_phase3b_activation()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.assert_reservation_phase3b_activation()',
       'execute'
     ) then
    raise exception using
      errcode = '55000',
      message = 'Client Phase 3B activation assertion EXECUTE grant detected';
  end if;
end;
$permission_assertion$;

select private.assert_reservation_phase3b_activation();

comment on function private.assert_reservation_phase3b_activation() is
  'PII-free Phase 3B.2 activation assertion; zero-price allocations require no Payment, positive paid balances must reconcile exactly, and over-allocation fails closed.';

commit;
