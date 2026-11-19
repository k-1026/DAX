-- 20261119001100_search.sql 되돌리기
drop function if exists public.search_listings(jsonb, text, integer, text);
drop function if exists public.search_areas();
drop table if exists public.guest_search_hits;
delete from public.app_settings where key in ('guest.search_hourly_limit', 'search.page_size', 'search.badge_days');
