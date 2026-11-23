-- 20261123000100_listing_detail.sql 되돌리기
create or replace function public.improvement_urgent_unnotified()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', urgent_kind) order by created_at), '[]'::jsonb)
  from public.listing_feedback
  where urgent_kind is not null and urgent_notified_at is null;
$$;

create or replace function public.improvement_mark_urgent_notified(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listing_feedback set urgent_notified_at = now()
  where id = any (p_ids) and urgent_notified_at is null;
$$;

drop function if exists public.submit_problem_report(text, text, uuid, text);
drop table if exists public.problem_reports;
delete from public.listing_flags where signal = 'reported';
alter table public.listing_flags drop constraint listing_flags_signal_check;
alter table public.listing_flags add constraint listing_flags_signal_check
  check (signal in ('duplicate', 'long_posting', 'relisted', 'price_outlier', 'use_mismatch'));
drop function if exists public.listing_detail(uuid);
alter table public.listing_feedback drop constraint if exists listing_feedback_one_reason;
delete from public.app_settings where key in ('guest.report_daily_limit', 'listing.stale_days');
