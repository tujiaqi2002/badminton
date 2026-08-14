-- Repair the two original Chinese seed labels that were inserted with a
-- mis-decoded UTF-8 payload. User-authored venue content is intentionally left
-- untouched.
update public.venue_settings
set name_zh = 'Tiger 羽毛球馆'
where name_en = 'Tiger Badminton Club'
  and name_zh = 'Tiger ç¾½çƒé¦†';

update public.venue_pricing_rules
set name_zh = case name_en
  when 'Day rate' then '日间标准价'
  when 'Evening rate' then '晚间标准价'
  else name_zh
end
where name_en in ('Day rate', 'Evening rate')
  and name_zh in ('æ—¥é—´æ ‡å‡†ä»·', 'æ™šé—´æ ‡å‡†ä»·');

-- Purpose-built manager schedule feed. Keeping venue events separate from
-- bookings prevents event blocks from being mistaken for customer orders while
-- allowing the calendar UI to render both on one timeline.
create or replace function public.admin_get_venue_schedule_events(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_result jsonb;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid event date range';
  end if;
  if p_end_date - p_start_date > 62 then
    raise exception 'Event date range cannot exceed 63 days';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(event) || jsonb_build_object(
      'court_ids', coalesce(courts.court_ids, '[]'::jsonb),
      'court_names_zh', coalesce(courts.court_names_zh, '[]'::jsonb),
      'court_names_en', coalesce(courts.court_names_en, '[]'::jsonb)
    ) order by event.starts_at, event.id
  ), '[]'::jsonb)
  into v_result
  from public.venue_events event
  left join lateral (
    select
      jsonb_agg(court.id order by court.sort_order) as court_ids,
      jsonb_agg(court.name_zh order by court.sort_order) as court_names_zh,
      jsonb_agg(court.name_en order by court.sort_order) as court_names_en
    from public.venue_event_courts event_court
    join public.courts court on court.id = event_court.court_id
    where event_court.event_id = event.id
  ) courts on true
  where event.status = 'scheduled'
    and event.starts_at < (p_end_date + 1)::timestamp
    and event.ends_at > p_start_date::timestamp;

  return v_result;
end;
$$;

revoke all on function public.admin_get_venue_schedule_events(date, date) from public;
revoke execute on function public.admin_get_venue_schedule_events(date, date) from anon;
grant execute on function public.admin_get_venue_schedule_events(date, date) to authenticated;

comment on function public.admin_get_venue_schedule_events is
  'Manager-only event feed for rendering special events and closures on the booking calendar.';
