-- 관리자 "AI 사용량" 화면용 읽기 전용 집계. 숫자 묶음만 돌려주고 회원 번호·접속 정보는 주지 않는다.
-- 근거: 대화로그 턴 205~207(오늘 한도를 다 쓴 사람 수, 탈퇴 회원 따로, 비회원 한도는 누적 기준,
--       기간 7/30/90일, 평소(최근 7일 평균) 대비, 한도 대비 사용 분포, 기능별 시리즈)
-- 되돌리기: supabase/rollback/20261124000300_admin_ai_usage_rollback.sql

drop function if exists public.admin_ai_usage(integer);

create function public.admin_ai_usage(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  month_start date := date_trunc('month', (now() at time zone 'Asia/Seoul'))::date;
  days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  member_limit integer := public.pipeline_setting('member.ai_daily_limit')::integer;
  subscriber_limit integer := public.pipeline_setting('subscriber.ai_daily_limit')::integer;
  guest_limit integer := public.pipeline_setting('guest.ai_total_limit')::integer;
  guest_cap integer := public.pipeline_setting('guest.ai_daily_cap')::integer;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  with recent as (
    select a.user_id, a.guest_hash, a.feature, a.used_on,
      case
        when a.user_id is null and a.guest_hash is not null then 'guest'
        when a.user_id is null then 'withdrawn'
        when p.role = 'admin' and p.deleted_at is null then 'admin'
        when exists (
          select 1 from public.subscriptions s
          where s.user_id = a.user_id
            and ((s.status in ('active', 'canceled') and s.current_period_end > now())
              or (s.status = 'past_due' and s.grace_until > now()))
        ) then 'subscriber'
        else 'member'
      end as tier
    from public.ai_usage a
    left join public.profiles p on p.id = a.user_id
    -- 지난 기간과 비교할 수 있게 기간의 두 배까지 읽는다.
    where a.counted and a.used_on >= least(month_start, today - (days * 2 - 1))
  ), per_user_day as (
    select tier, user_id, used_on, count(*) as n
    from recent where tier in ('member', 'subscriber')
    group by tier, user_id, used_on
  )
  select jsonb_build_object(
    'days', days,
    'today', (select count(*) from recent where used_on = today),
    'month', (select count(*) from recent where used_on >= month_start),
    'period', (select count(*) from recent where used_on > today - days),
    'prev_period', (select count(*) from recent where used_on <= today - days and used_on > today - days * 2),
    -- 평소 = 오늘을 뺀 최근 7일의 하루 평균
    'avg7', (select round(count(*) / 7.0, 1) from recent where used_on >= today - 7 and used_on < today),
    'features', (
      select coalesce(jsonb_object_agg(feature, jsonb_build_object('today', t, 'month', m, 'period', p)), '{}'::jsonb)
      from (
        select feature,
               count(*) filter (where used_on = today) as t,
               count(*) filter (where used_on >= month_start) as m,
               count(*) filter (where used_on > today - days) as p
        from recent group by feature
      ) f
    ),
    'tiers_today', (
      select coalesce(jsonb_object_agg(tier, jsonb_build_object('uses', n, 'people', ppl)), '{}'::jsonb)
      from (
        select tier, count(*) as n, count(distinct coalesce(user_id::text, guest_hash)) as ppl
        from recent where used_on = today group by tier
      ) t
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'MM/DD'),
        'guest', coalesce(c.guest, 0), 'member', coalesce(c.member, 0),
        'subscriber', coalesce(c.subscriber, 0), 'admin', coalesce(c.admin, 0),
        'withdrawn', coalesce(c.withdrawn, 0),
        'ai1', coalesce(c.ai1, 0), 'ai2', coalesce(c.ai2, 0), 'ai3', coalesce(c.ai3, 0), 'ai4', coalesce(c.ai4, 0)
      ) order by d.day), '[]'::jsonb)
      from (select (today - g)::date as day from generate_series(0, days - 1) g) d
      left join (
        select used_on,
               count(*) filter (where tier = 'guest') as guest,
               count(*) filter (where tier = 'member') as member,
               count(*) filter (where tier = 'subscriber') as subscriber,
               count(*) filter (where tier = 'admin') as admin,
               count(*) filter (where tier = 'withdrawn') as withdrawn,
               count(*) filter (where feature = 'ai1_search_text') as ai1,
               count(*) filter (where feature = 'ai2_explain') as ai2,
               count(*) filter (where feature = 'ai3_compare') as ai3,
               count(*) filter (where feature = 'ai4_assistant') as ai4
        from recent group by used_on
      ) c on c.used_on = d.day
    ),
    -- 한도 대비 사용: 회원·구독 회원의 "사람·하루"를 한도의 몇 %를 썼는지로 나눈다.
    'distribution', jsonb_build_object(
      'member', (select jsonb_build_object(
        'b1', count(*) filter (where n < member_limit * 0.3),
        'b2', count(*) filter (where n >= member_limit * 0.3 and n < member_limit * 0.6),
        'b3', count(*) filter (where n >= member_limit * 0.6 and n < member_limit),
        'b4', count(*) filter (where n >= member_limit))
        from per_user_day where tier = 'member' and used_on > today - days),
      'subscriber', (select jsonb_build_object(
        'b1', count(*) filter (where n < subscriber_limit * 0.3),
        'b2', count(*) filter (where n >= subscriber_limit * 0.3 and n < subscriber_limit * 0.6),
        'b3', count(*) filter (where n >= subscriber_limit * 0.6 and n < subscriber_limit),
        'b4', count(*) filter (where n >= subscriber_limit))
        from per_user_day where tier = 'subscriber' and used_on > today - days)
    ),
    'reached', jsonb_build_object(
      'member', (select count(*) from (
        select user_id from recent where used_on = today and tier = 'member'
        group by user_id having count(*) >= member_limit) q),
      'subscriber', (select count(*) from (
        select user_id from recent where used_on = today and tier = 'subscriber'
        group by user_id having count(*) >= subscriber_limit) q),
      -- 비회원 한도는 하루가 아니라 접속 하나당 전체 횟수다.
      'guest_total', (select count(*) from (
        select guest_hash from public.ai_usage
        where counted and guest_hash is not null
        group by guest_hash having count(*) >= guest_limit) q)
    ),
    'guest_today', (select count(*) from recent where used_on = today and tier = 'guest'),
    'limits', jsonb_build_object('member', member_limit, 'subscriber', subscriber_limit, 'guest_total', guest_limit, 'guest_cap', guest_cap)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_ai_usage(integer) from public, anon, authenticated;
grant execute on function public.admin_ai_usage(integer) to authenticated;
