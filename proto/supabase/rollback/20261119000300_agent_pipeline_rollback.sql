-- 20261119000300_agent_pipeline.sql 되돌리기
-- 주의: 매물, 변경 이력, 확인 필요 표시, 실행 기록이 모두 삭제된다.
-- 문제가 생겼을 때 관리자 확인을 받은 뒤에만 실행한다.

drop function if exists public.pipeline_review_batch(uuid, boolean);
drop function if exists public.pipeline_score(uuid);
drop function if exists public.pipeline_validate(uuid);
drop function if exists public.pipeline_diff(uuid);
drop function if exists public.pipeline_quality_check(uuid, text[]);
drop function if exists public.pipeline_step_finish(uuid, text, text, jsonb, text);
drop function if exists public.pipeline_step_begin(uuid, text);
drop function if exists public.pipeline_start_run(text, jsonb);
drop function if exists public.pipeline_identity_key(jsonb);
drop function if exists public.pipeline_setting(text);
drop function if exists public.pipeline_num(text);

drop table if exists public.agent_events;
drop table if exists public.agent_steps;
drop table if exists public.agent_runs;
drop table if exists public.listing_scores;
drop table if exists public.scoring_versions;
drop table if exists public.business_categories;
drop table if exists public.listing_flags;
drop table if exists public.listing_versions;
drop table if exists public.listings;
drop table if exists public.ingest_batches;

delete from public.app_settings where key like 'pipeline.%';
