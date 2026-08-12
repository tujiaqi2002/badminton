create or replace function public.hook_allow_manager_accounts(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(trim(event->'user'->>'email'));
begin
  if v_email in ('321756623tu@gmail.com', 'zhangk7@gmail.com') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'This Tiger workspace is restricted to approved manager accounts.',
      'http_code', 403
    )
  );
end;
$$;

grant execute on function public.hook_allow_manager_accounts(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_allow_manager_accounts(jsonb) from public, anon, authenticated;
