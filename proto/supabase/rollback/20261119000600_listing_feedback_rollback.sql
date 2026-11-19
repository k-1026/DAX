-- 20261119000600_listing_feedback.sql 되돌리기
drop table if exists public.listing_feedback;
drop function if exists public.listing_feedback_prepare();
drop function if exists public.mask_personal_text(text);
