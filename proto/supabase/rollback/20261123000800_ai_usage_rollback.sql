-- 20261123000800_ai_usage.sql 되돌리기
drop function if exists public.ai_use(text, text);
drop function if exists public.ai_status(text);
drop table if exists public.ai_usage;
