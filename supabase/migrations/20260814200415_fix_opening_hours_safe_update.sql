-- Keep one stable row per weekday. The previous implementation deleted every
-- row before reinserting the seven-day schedule, which is rejected when
-- Supabase safeupdate is enabled and also needlessly changes row identities.
create or replace function public.admin_replace_opening_hours(p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_count integer;
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    raise exception 'Opening hours must contain all seven days';
  end if;

  if (
    select count(distinct (item ->> 'day_of_week')::smallint)
    from jsonb_array_elements(p_hours) item
  ) <> 7 then
    raise exception 'Opening hours must contain each weekday once';
  end if;

  perform set_config('app.audit_operation_id', gen_random_uuid()::text, true);

  insert into public.venue_opening_hours
    (day_of_week, open_minute, close_minute, is_closed, label, updated_by)
  select
    (item ->> 'day_of_week')::smallint,
    coalesce((item ->> 'open_minute')::smallint, 600),
    coalesce((item ->> 'close_minute')::smallint, 1440),
    coalesce((item ->> 'is_closed')::boolean, false),
    nullif(trim(item ->> 'label'), ''),
    v_actor_id
  from jsonb_array_elements(p_hours) item
  on conflict (day_of_week) do update set
    open_minute = excluded.open_minute,
    close_minute = excluded.close_minute,
    is_closed = excluded.is_closed,
    label = excluded.label,
    updated_by = excluded.updated_by;

  get diagnostics v_count = row_count;
  return jsonb_build_object('saved', v_count);
end;
$$;

revoke execute on function public.admin_replace_opening_hours(jsonb) from public, anon;
grant execute on function public.admin_replace_opening_hours(jsonb) to authenticated;

comment on function public.admin_replace_opening_hours(jsonb) is
  'Replaces the seven-day venue schedule with safe weekday-scoped upserts.';

notify pgrst, 'reload schema';
