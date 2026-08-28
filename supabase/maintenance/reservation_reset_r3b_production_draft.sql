-- Tiger Issue #165 / R3A review artifact only.
-- Production-specific database reset draft. It is outside supabase/migrations,
-- starts disabled, and must not be enabled or executed until the user gives a
-- separate R3B destructive confirmation against the final reviewed file hash.
-- Auth deletion is intentionally excluded and follows a separate runbook only
-- after this database transaction commits and its postflight succeeds.

set tiger.r3b.execution_authorized = 'false';
set tiger.r3b.target_project_ref = 'ldbtrouofmqmnkyxiewk';

begin;
set transaction isolation level serializable;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local timezone = 'UTC';

do $authorization_gate$
begin
  if current_setting('tiger.r3b.execution_authorized', true) <> 'true'
     or current_setting('tiger.r3b.target_project_ref', true)
        <> 'ldbtrouofmqmnkyxiewk' then
    raise exception 'tiger_r3b_production_draft_not_authorized';
  end if;

  if current_database() <> 'postgres'
     or current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000
     or (select count(*) from supabase_migrations.schema_migrations) <> 51
     or (select max(version) from supabase_migrations.schema_migrations)
        <> '20260827090512' then
    raise exception 'tiger_r3b_production_runtime_or_migration_mismatch';
  end if;

  if exists (
    select 1
    from private.app_audit_events
    where operation_id = 'reservation-reset-r3b-production-20260828-v1'
       or id = -1653999
  ) then
    raise exception 'tiger_r3b_production_already_completed';
  end if;
end
$authorization_gate$;

do $maintenance_lock$
begin
  if not pg_try_advisory_xact_lock(
    hashtextextended('tiger.issue-165.reservation-reset', 0)
  ) then
    raise exception 'tiger_r3b_production_lock_unavailable';
  end if;
end
$maintenance_lock$;

-- One fixed lock order prevents selector drift between validation and delete.
-- SHARE ROW EXCLUSIVE still permits reads while rejecting concurrent writers.
lock table
  auth.identities,
  auth.users,
  private.app_audit_events,
  private.booking_admin_actions,
  private.manager_accounts,
  private.reservation_phase3b_activation_state,
  private.reservation_phase3b_operations,
  private.reservation_phase3b_writer_baseline,
  private.reservation_phase3b_writer_inventory,
  public.bookings,
  public.court_slots,
  public.courts,
  public.payment_allocation_entries,
  public.payments,
  public.profiles,
  public.recurrence_series,
  public.reservation_allocation_memberships,
  public.reservation_legacy_sources,
  public.reservation_parties,
  public.reservation_party_roles,
  public.reservation_payment_shares,
  public.reservation_session_assignments,
  public.reservation_sessions,
  public.reservation_transition_allocations,
  public.reservation_transition_parties,
  public.reservation_transition_sources,
  public.reservation_transition_targets,
  public.reservation_transitions,
  public.reservations,
  public.staff_members,
  public.venue_event_courts,
  public.venue_events,
  public.venue_member_tiers,
  public.venue_members,
  public.venue_opening_hours,
  public.venue_pricing_rules,
  public.venue_settings,
  supabase_migrations.schema_migrations
in share row exclusive mode;

create temporary table tiger_r3b_manager_users (
  user_id uuid primary key
) on commit drop;

insert into tiger_r3b_manager_users (user_id)
select distinct user_id
from public.staff_members
where role = 'admin';

create temporary table tiger_r3b_nonmanager_users (
  user_id uuid primary key
) on commit drop;

insert into tiger_r3b_nonmanager_users (user_id)
select users.id
from auth.users as users
where not exists (
  select 1
  from tiger_r3b_manager_users as managers
  where managers.user_id = users.id
);

create temporary table tiger_r3b_purge_entity_ids (
  entity_kind text not null,
  entity_id text not null,
  primary key (entity_kind, entity_id)
) on commit drop;

insert into tiger_r3b_purge_entity_ids (entity_kind, entity_id)
select 'booking', id::text from public.bookings
union all
select 'event', id::text from public.venue_events
union all
select 'member', id::text from public.venue_members;

create function pg_temp.tiger_r3b_count(
  p_relation regclass,
  p_predicate text
) returns bigint
language plpgsql
as $function$
declare
  v_count bigint;
begin
  execute format(
    'select count(*) from %s as t where %s',
    p_relation,
    p_predicate
  ) into v_count;
  return v_count;
end
$function$;

create function pg_temp.tiger_r3b_fingerprint(
  p_relation regclass,
  p_predicate text
) returns text
language plpgsql
as $function$
declare
  v_fingerprint text;
begin
  execute format(
    'select encode(extensions.digest(coalesce(string_agg(md5(to_jsonb(t)::text), '''' order by md5(to_jsonb(t)::text), to_jsonb(t)::text), ''''), ''sha256''), ''hex'') from %s as t where %s',
    p_relation,
    p_predicate
  ) into v_fingerprint;
  return v_fingerprint;
end
$function$;

create function pg_temp.tiger_r3b_nonmanager_reference_count(
  p_relation regclass,
  p_column name
) returns bigint
language plpgsql
as $function$
declare
  v_count bigint;
begin
  execute format(
    'select count(*) from %s as t where t.%I in (select user_id from tiger_r3b_nonmanager_users)',
    p_relation,
    p_column
  ) into v_count;
  return v_count;
end
$function$;

create temporary table tiger_r3b_expected (
  scope text not null check (scope in ('preserve', 'purge')),
  relation_name text not null,
  relation_oid regclass not null,
  predicate text not null,
  expected_count bigint not null,
  expected_fingerprint text not null check (
    expected_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  primary key (scope, relation_name)
) on commit drop;

insert into tiger_r3b_expected (
  scope,
  relation_name,
  relation_oid,
  predicate,
  expected_count,
  expected_fingerprint
) values
  ('preserve', 'auth.identities:managers', 'auth.identities'::regclass, 'user_id in (select user_id from tiger_r3b_manager_users)', 4, '0eb664bebb7c15067aa7bc42dce5eca52a5cee97ab224434da283e1889eeedc0'),
  ('preserve', 'auth.users:managers', 'auth.users'::regclass, 'id in (select user_id from tiger_r3b_manager_users)', 3, '55e1a5a2b12abc2c203afd722e35fefe501290578a3ea060909d58196614f734'),
  ('preserve', 'private.app_audit_events:preserve', 'private.app_audit_events'::regclass, 'not (entity_id in (select entity_id from tiger_r3b_purge_entity_ids))', 77, 'b250ba1cc95d719119b30031bc61d962222725ad6dd3758d2b8df284fe1e4944'),
  ('preserve', 'private.manager_accounts', 'private.manager_accounts'::regclass, 'true', 3, 'a3be003d9c48340c5405f6b6ae00d4bda492978bdc06797fe6c307d9c6b5f1bd'),
  ('preserve', 'private.reservation_phase3b_activation_state', 'private.reservation_phase3b_activation_state'::regclass, 'true', 1, '9d79ce94cb201c438598fab3fb1a768f94829b616158293bf84fcaa22f0f36a0'),
  ('preserve', 'private.reservation_phase3b_writer_baseline', 'private.reservation_phase3b_writer_baseline'::regclass, 'true', 17, '014f383f8e627259597678bb22df56c7d3a7a99c1371e85b4a22d9283ff817e7'),
  ('preserve', 'private.reservation_phase3b_writer_inventory', 'private.reservation_phase3b_writer_inventory'::regclass, 'true', 22, '4e9206b19d4559b6195eb01551470161b184b7aca41699926019ae0a5ad51675'),
  ('preserve', 'public.courts', 'public.courts'::regclass, 'true', 5, 'aecb503453865b079357b94e88a3586fbe66900005272f7662631ebc12bda149'),
  ('preserve', 'public.profiles:managers', 'public.profiles'::regclass, 'id in (select user_id from tiger_r3b_manager_users)', 2, 'be34a6ec3f50d6311f72995a067ca81909582ef5449b992dbf6ec84b0097da71'),
  ('preserve', 'public.staff_members', 'public.staff_members'::regclass, 'true', 3, 'd8064254954bcf0f0f4e7df8b80d9ab557957655f58ad2b77c3a78f43d24577e'),
  ('preserve', 'public.venue_member_tiers', 'public.venue_member_tiers'::regclass, 'true', 5, 'ad1796a1ceda89c1e8f40dd937aa4b148be33fe101e7639a7e2a233b0c0ac731'),
  ('preserve', 'public.venue_opening_hours', 'public.venue_opening_hours'::regclass, 'true', 7, '241fadffe2ee0d2f2377cf9d8d678bd665e5fa25a9388bc731ecf32505c7e32d'),
  ('preserve', 'public.venue_pricing_rules', 'public.venue_pricing_rules'::regclass, 'true', 5, 'e9e14ef2564d9dfe3ed94cb59f7bf058711e4bf1998d175e7da4ace31422d81f'),
  ('preserve', 'public.venue_settings', 'public.venue_settings'::regclass, 'true', 1, '4e5eb4cc4491888620ee66df860024e8cc050d370a522defeffe1551b4fb729d'),
  ('preserve', 'supabase_migrations.schema_migrations', 'supabase_migrations.schema_migrations'::regclass, 'true', 51, 'dc290d06def4b5b7187b7832b7f3f572d33d1c5638e1433ce8dcc66eb12ddf91'),
  ('purge', 'private.app_audit_events:purge', 'private.app_audit_events'::regclass, 'entity_id in (select entity_id from tiger_r3b_purge_entity_ids)', 1661, '9d627dd6eb52be2702bca52530b8276b28fea3c81e8ccc03b676b5e41bd7eb31'),
  ('purge', 'private.booking_admin_actions', 'private.booking_admin_actions'::regclass, 'booking_id::text in (select entity_id from tiger_r3b_purge_entity_ids where entity_kind = ''booking'')', 1308, '2b7bc3de3967dc5c1c58eaa99c9da1c82870053edc31d290f76323eba27306b0'),
  ('purge', 'private.reservation_phase3b_operations', 'private.reservation_phase3b_operations'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.bookings', 'public.bookings'::regclass, 'true', 192, '9d3dcc315fba764b37a009cf41c7bc81883b2d46571203fd8c08aea3d21a525e'),
  ('purge', 'public.court_slots', 'public.court_slots'::regclass, 'true', 139, '607d90a150cb83c6ec93cdc2839d2997051d6496ca56abd8a0b1c83e99576bdb'),
  ('purge', 'public.payment_allocation_entries', 'public.payment_allocation_entries'::regclass, 'true', 26, 'ad5414c9de9e716e39dab07931242b60a38088df667e4f0f0706c15c53000443'),
  ('purge', 'public.payments', 'public.payments'::regclass, 'true', 23, '0634a8f3d97cb5bd057198c5fac1f48fbe6d83e387ec430108a2a9ff95fae3fc'),
  ('purge', 'public.profiles:nonmanager', 'public.profiles'::regclass, 'id in (select user_id from tiger_r3b_nonmanager_users)', 1, 'f9dd6a9a60cd4cec0bb709dcbe2ef68887367b4b6d0799b5a0fa6d95a2947bc6'),
  ('purge', 'public.recurrence_series', 'public.recurrence_series'::regclass, 'true', 2, 'e8da4d417dc73d1012395e6fc7e1d7a819d94da5d55811d50ed5b5f56fb11979'),
  ('purge', 'public.reservation_allocation_memberships', 'public.reservation_allocation_memberships'::regclass, 'true', 192, '549a44b64ae1c9c57b2ff896af8e597f0e559170f90aeb75dee2f3100405a41b'),
  ('purge', 'public.reservation_legacy_sources', 'public.reservation_legacy_sources'::regclass, 'true', 136, '0ef67e13d2826040a0e2f673b4813862af9fddda2e31f9deb73207641a6e5e5e'),
  ('purge', 'public.reservation_parties', 'public.reservation_parties'::regclass, 'true', 131, 'b482f0242d17b0758fe62b207c115fa09dbe4e75b5065dcffeff21a744635132'),
  ('purge', 'public.reservation_party_roles', 'public.reservation_party_roles'::regclass, 'true', 254, '05bf7db8c244c667af8d82f0b2c8b7e7bcdf6c6c18225292bc3b1d472d56bfa2'),
  ('purge', 'public.reservation_payment_shares', 'public.reservation_payment_shares'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_session_assignments', 'public.reservation_session_assignments'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_sessions', 'public.reservation_sessions'::regclass, 'true', 135, '0d451d947bf5670a8333d802978ba0d0539f18c8cc9749f89822349bca7264eb'),
  ('purge', 'public.reservation_transition_allocations', 'public.reservation_transition_allocations'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_transition_parties', 'public.reservation_transition_parties'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_transition_sources', 'public.reservation_transition_sources'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_transition_targets', 'public.reservation_transition_targets'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservation_transitions', 'public.reservation_transitions'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.reservations', 'public.reservations'::regclass, 'true', 123, '8d318d8014cecb317934eacf5bba2d0676cd7d18ea7a3d285a1dd597e42188e7'),
  ('purge', 'public.venue_event_courts', 'public.venue_event_courts'::regclass, 'true', 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  ('purge', 'public.venue_events', 'public.venue_events'::regclass, 'true', 2, '9059d95676da54edeada26dfff0dc45a721ef9ca2fe84f27d7035dc7bd2dd3cf'),
  ('purge', 'public.venue_members', 'public.venue_members'::regclass, 'true', 2, '2471391da7fc31da9d419a74bf95445336fb03f3de5b564e93cfaac893a484cc');

create temporary table tiger_r3b_expected_auth_references (
  relation_oid regclass not null,
  column_name name not null,
  expected_count bigint not null,
  primary key (relation_oid, column_name)
) on commit drop;

insert into tiger_r3b_expected_auth_references (
  relation_oid,
  column_name,
  expected_count
) values
  ('private.app_audit_events'::regclass, 'actor_id', 0),
  ('private.booking_admin_actions'::regclass, 'actor_id', 0),
  ('private.manager_accounts'::regclass, 'created_by', 0),
  ('private.manager_accounts'::regclass, 'updated_by', 0),
  ('private.manager_accounts'::regclass, 'user_id', 0),
  ('private.reservation_phase3b_operations'::regclass, 'actor_id', 0),
  ('public.bookings'::regclass, 'user_id', 2),
  ('public.payment_allocation_entries'::regclass, 'created_by', 0),
  ('public.payments'::regclass, 'recorded_by', 0),
  ('public.profiles'::regclass, 'id', 1),
  ('public.recurrence_series'::regclass, 'created_by', 0),
  ('public.reservation_legacy_sources'::regclass, 'created_by', 0),
  ('public.reservation_parties'::regclass, 'auth_user_id', 2),
  ('public.reservation_parties'::regclass, 'created_by', 0),
  ('public.reservation_party_roles'::regclass, 'created_by', 0),
  ('public.reservation_payment_shares'::regclass, 'created_by', 0),
  ('public.reservation_session_assignments'::regclass, 'actor_id', 0),
  ('public.reservation_sessions'::regclass, 'created_by', 0),
  ('public.reservation_transitions'::regclass, 'actor_id', 0),
  ('public.reservations'::regclass, 'created_by', 0),
  ('public.staff_members'::regclass, 'user_id', 0),
  ('public.venue_events'::regclass, 'updated_by', 0),
  ('public.venue_member_tiers'::regclass, 'updated_by', 0),
  ('public.venue_members'::regclass, 'auth_user_id', 0),
  ('public.venue_members'::regclass, 'updated_by', 0),
  ('public.venue_opening_hours'::regclass, 'updated_by', 0),
  ('public.venue_pricing_rules'::regclass, 'updated_by', 0),
  ('public.venue_settings'::regclass, 'updated_by', 0);

create temporary table tiger_r3b_timing (
  started_at timestamptz not null,
  reset_at timestamptz
) on commit drop;

insert into tiger_r3b_timing (started_at) values (clock_timestamp());

do $production_preflight$
declare
  v_mismatch text;
  v_preserve_fingerprint text;
  v_purge_fingerprint text;
begin
  if (select count(*) from tiger_r3b_manager_users) <> 3
     or (select count(*) from tiger_r3b_nonmanager_users) <> 1
     or (select count(*) from auth.users) <> 4
     or (select count(*) from auth.identities where user_id in (select user_id from tiger_r3b_nonmanager_users)) <> 1
     or (select encode(extensions.digest(user_id::text, 'sha256'), 'hex') from tiger_r3b_nonmanager_users)
        <> '71b3e7bbce898d4cce09ef50c3457f25877dec9d5ce9f2a46578f3ad04d294b6' then
    raise exception 'tiger_r3b_production_auth_selector_mismatch';
  end if;

  select relation_name
  into v_mismatch
  from tiger_r3b_expected
  where expected_count <> pg_temp.tiger_r3b_count(relation_oid, predicate)
     or expected_fingerprint <> pg_temp.tiger_r3b_fingerprint(relation_oid, predicate)
  order by scope, relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r3b_production_manifest_mismatch:%', v_mismatch;
  end if;

  select encode(extensions.digest(string_agg(
    relation_name || ':' || expected_count || ':' || expected_fingerprint,
    '|' order by relation_name
  ), 'sha256'), 'hex')
  into v_preserve_fingerprint
  from tiger_r3b_expected
  where scope = 'preserve';

  select encode(extensions.digest(string_agg(
    relation_name || ':' || expected_count || ':' || expected_fingerprint,
    '|' order by relation_name
  ), 'sha256'), 'hex')
  into v_purge_fingerprint
  from tiger_r3b_expected
  where scope = 'purge';

  if v_preserve_fingerprint <> 'd5c5186d647d6f5a9d8f552d886e92773733905821694be1d28b381ac045310f'
     or v_purge_fingerprint <> 'c945049e3725602fd00a9e963591962e74744f96bf89852d32143f384a8cb39c'
     or (select sum(expected_count) from tiger_r3b_expected where scope = 'preserve') <> 206
     or (select sum(expected_count) from tiger_r3b_expected where scope = 'purge') <> 4327 then
    raise exception 'tiger_r3b_production_manifest_self_check_failed';
  end if;

  if exists (
    (
      select conrelid, attname::name
      from pg_constraint as constraint_row
      join lateral unnest(constraint_row.conkey) as key_column(attnum) on true
      join pg_attribute as attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_column.attnum
      join pg_class as relation_row on relation_row.oid = constraint_row.conrelid
      join pg_namespace as schema_row on schema_row.oid = relation_row.relnamespace
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'auth.users'::regclass
        and schema_row.nspname in ('public', 'private')
      except
      select relation_oid::oid, column_name
      from tiger_r3b_expected_auth_references
    )
    union all
    (
      select relation_oid::oid, column_name
      from tiger_r3b_expected_auth_references
      except
      select conrelid, attname::name
      from pg_constraint as constraint_row
      join lateral unnest(constraint_row.conkey) as key_column(attnum) on true
      join pg_attribute as attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_column.attnum
      join pg_class as relation_row on relation_row.oid = constraint_row.conrelid
      join pg_namespace as schema_row on schema_row.oid = relation_row.relnamespace
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'auth.users'::regclass
        and schema_row.nspname in ('public', 'private')
    )
  ) then
    raise exception 'tiger_r3b_production_auth_fk_catalog_drift';
  end if;

  select relation_oid::text || '.' || column_name::text
  into v_mismatch
  from tiger_r3b_expected_auth_references
  where expected_count <> pg_temp.tiger_r3b_nonmanager_reference_count(
    relation_oid,
    column_name
  )
  order by relation_oid::text, column_name::text
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r3b_production_auth_reference_mismatch:%', v_mismatch;
  end if;

  if exists (select 1 from public.reservations where source <> 'legacy_migration')
     or exists (select 1 from public.payments where provider_reference is not null)
     or (select coalesce(sum(amount), 0) from public.payment_allocation_entries) <> 1642.00
     or (select last_value from private.app_audit_events_id_seq) <> 1985
     or not (select is_called from private.app_audit_events_id_seq)
     or (select last_value from private.booking_admin_actions_id_seq) <> 1410
     or not (select is_called from private.booking_admin_actions_id_seq)
     or (select last_value from public.payment_allocation_entries_id_seq) <> 26
     or not (select is_called from public.payment_allocation_entries_id_seq)
     or (select last_value from public.reservation_legacy_sources_id_seq) <> 136
     or not (select is_called from public.reservation_legacy_sources_id_seq)
     or (select last_value from public.reservation_transitions_sequence_seq) <> 1
     or (select is_called from public.reservation_transitions_sequence_seq)
     or (select last_value from public.reservations_reference_number_seq) <> 1122
     or not (select is_called from public.reservations_reference_number_seq) then
    raise exception 'tiger_r3b_production_business_or_sequence_mismatch';
  end if;
end
$production_preflight$;

set local session_replication_role = replica;

delete from private.booking_admin_actions
where booking_id::text in (
  select entity_id
  from tiger_r3b_purge_entity_ids
  where entity_kind = 'booking'
);
delete from private.app_audit_events
where entity_id in (select entity_id from tiger_r3b_purge_entity_ids);
delete from public.reservation_allocation_memberships;
delete from public.reservation_transition_parties;
delete from public.reservation_transition_allocations;
delete from public.reservation_transition_sources;
delete from public.reservation_transition_targets;
delete from public.reservation_session_assignments;
delete from public.reservation_transitions;
delete from private.reservation_phase3b_operations;
delete from public.payment_allocation_entries;
delete from public.reservation_payment_shares;
delete from public.payments;
delete from public.reservation_party_roles;
delete from public.reservation_legacy_sources;
delete from public.court_slots;
delete from public.bookings;
delete from public.reservation_parties;
delete from public.reservation_sessions;
delete from public.reservations;
delete from public.recurrence_series;
delete from public.profiles
where id in (select user_id from tiger_r3b_nonmanager_users);
delete from public.venue_event_courts;
delete from public.venue_events;
delete from public.venue_members;

set local session_replication_role = origin;

update tiger_r3b_timing set reset_at = clock_timestamp();

do $database_postflight$
declare
  v_mismatch text;
begin
  select relation_name
  into v_mismatch
  from tiger_r3b_expected
  where scope = 'purge'
    and pg_temp.tiger_r3b_count(relation_oid, predicate) <> 0
  order by relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r3b_production_purge_incomplete:%', v_mismatch;
  end if;

  select relation_name
  into v_mismatch
  from tiger_r3b_expected
  where scope = 'preserve'
    and (
      expected_count <> pg_temp.tiger_r3b_count(relation_oid, predicate)
      or expected_fingerprint <> pg_temp.tiger_r3b_fingerprint(
        relation_oid,
        predicate
      )
    )
  order by relation_name
  limit 1;

  if v_mismatch is not null then
    raise exception 'tiger_r3b_production_preserve_drift:%', v_mismatch;
  end if;

  if exists (
    select 1
    from tiger_r3b_expected_auth_references
    where pg_temp.tiger_r3b_nonmanager_reference_count(
      relation_oid,
      column_name
    ) <> 0
  ) then
    raise exception 'tiger_r3b_production_auth_reference_remains';
  end if;

  if (select count(*) from auth.users where id in (select user_id from tiger_r3b_nonmanager_users)) <> 1
     or (select count(*) from auth.identities where user_id in (select user_id from tiger_r3b_nonmanager_users)) <> 1
     or (select count(*) from tiger_r3b_manager_users) <> 3
     or exists (select 1 from pg_constraint where contype = 'f' and not convalidated)
     or (select count(*) from pg_publication_tables where pubname = 'supabase_realtime') <> 1
     or not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'court_slots'
     )
     or (select count(*) from pg_class as relation_row join pg_namespace as schema_row on schema_row.oid = relation_row.relnamespace where schema_row.nspname = 'public' and relation_row.relkind = 'r' and relation_row.relrowsecurity) <> 28
     or (select count(*) from supabase_migrations.schema_migrations) <> 51
     or (select max(version) from supabase_migrations.schema_migrations) <> '20260827090512'
     or (select last_value from private.app_audit_events_id_seq) <> 1985
     or not (select is_called from private.app_audit_events_id_seq)
     or (select last_value from private.booking_admin_actions_id_seq) <> 1410
     or not (select is_called from private.booking_admin_actions_id_seq)
     or (select last_value from public.payment_allocation_entries_id_seq) <> 26
     or not (select is_called from public.payment_allocation_entries_id_seq)
     or (select last_value from public.reservation_legacy_sources_id_seq) <> 136
     or not (select is_called from public.reservation_legacy_sources_id_seq)
     or (select last_value from public.reservation_transitions_sequence_seq) <> 1
     or (select is_called from public.reservation_transitions_sequence_seq)
     or (select last_value from public.reservations_reference_number_seq) <> 1122
     or not (select is_called from public.reservations_reference_number_seq) then
    raise exception 'tiger_r3b_production_database_postflight_failed';
  end if;
end
$database_postflight$;

insert into private.app_audit_events (
  id,
  occurred_at,
  transaction_id,
  operation_id,
  event_type,
  entity_type,
  entity_id,
  actor_id,
  actor_email,
  actor_kind,
  source,
  before_state,
  after_state,
  changed_fields,
  metadata,
  reverts_operation_id
) overriding system value
select
  -1653999,
  clock_timestamp(),
  txid_current(),
  'reservation-reset-r3b-production-20260828-v1',
  'maintenance.reservation_reset_committed',
  'maintenance_run',
  'issue-165-r3b-production-v1',
  null,
  null,
  'system',
  'reservation_reset_r3b',
  null,
  null,
  array[]::text[],
  jsonb_build_object(
    'schema_version', 1,
    'project_ref', 'ldbtrouofmqmnkyxiewk',
    'postgres_version', current_setting('server_version'),
    'migration_count', 51,
    'preserve_rows', 206,
    'purge_rows', 4327,
    'preserve_fingerprint', 'd5c5186d647d6f5a9d8f552d886e92773733905821694be1d28b381ac045310f',
    'purge_fingerprint', 'c945049e3725602fd00a9e963591962e74744f96bf89852d32143f384a8cb39c',
    'encrypted_backup_sha256', '7e4e3f877940cc92e79268ae28f71211097e71efaa12bdb9775b256fd377f115',
    'database_reset_ms', round(extract(epoch from (reset_at - started_at)) * 1000, 3),
    'auth_deleted', false,
    'auth_next_step_required', true,
    'sequence_values_unchanged', true
  ),
  null
from tiger_r3b_timing;

commit;

select jsonb_build_object(
  'status', 'tiger_r3b_database_reset_committed_auth_pending',
  'operation_id', operation_id,
  'migration_count', (metadata ->> 'migration_count')::integer,
  'preserve_rows', (metadata ->> 'preserve_rows')::integer,
  'purge_rows', (metadata ->> 'purge_rows')::integer,
  'preserve_fingerprint', metadata ->> 'preserve_fingerprint',
  'purge_fingerprint', metadata ->> 'purge_fingerprint',
  'encrypted_backup_sha256', metadata ->> 'encrypted_backup_sha256',
  'database_reset_ms', (metadata ->> 'database_reset_ms')::numeric,
  'auth_deleted', (metadata ->> 'auth_deleted')::boolean,
  'auth_next_step_required',
    (metadata ->> 'auth_next_step_required')::boolean,
  'second_run_policy', 'reject_same_operation_id'
) as tiger_r3b_database_result
from private.app_audit_events
where operation_id = 'reservation-reset-r3b-production-20260828-v1';
