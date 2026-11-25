-- 6-E-1: 선호 조건 1세트 저장 (마이페이지)
-- 근거: 00_근거_기능_매핑.md U15, 앱 개발/대화로그.md 6-E 확정
-- 되돌리기: supabase/rollback/20261123000400_preferences_rollback.sql

-- 내 선호 조건 읽기 (없으면 빈 조건)
create function public.my_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select filters from public.user_preferences where user_id = auth.uid()), '{}'::jsonb);
$$;

-- 내 선호 조건 저장 (1세트). 허용한 항목만 걸러서 저장한다.
create function public.set_my_preferences(p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean jsonb := '{}'::jsonb;
  key text;
  val numeric;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'login_required');
  end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- 지역: 문자열 목록, 각 20자 이내, 최대 50개
  foreach key in array array['gu', 'dong'] loop
    if jsonb_typeof(p_filters -> key) = 'array' then
      clean := clean || jsonb_build_object(key, coalesce((
        select jsonb_agg(v) from (
          select distinct t.v from jsonb_array_elements_text(p_filters -> key) as t(v)
          where char_length(t.v) between 1 and 20 limit 50) s(v)
      ), '[]'::jsonb));
    end if;
  end loop;

  -- 금액·면적: 0 이상 1,000,000 미만의 숫자만
  foreach key in array array['rent_max', 'deposit_max', 'area_min', 'area_max'] loop
    if jsonb_typeof(p_filters -> key) = 'number' then
      val := (p_filters ->> key)::numeric;
      if val >= 0 and val < 1000000 then
        clean := clean || jsonb_build_object(key, val);
      end if;
    end if;
  end loop;

  insert into public.user_preferences (user_id, filters, updated_at)
  values (uid, clean, now())
  on conflict (user_id) do update set filters = excluded.filters, updated_at = now();

  return jsonb_build_object('ok', true, 'filters', clean);
end;
$$;

revoke all on function public.my_preferences() from public, anon, authenticated;
revoke all on function public.set_my_preferences(jsonb) from public, anon, authenticated;
grant execute on function public.my_preferences() to authenticated;
grant execute on function public.set_my_preferences(jsonb) to authenticated;
