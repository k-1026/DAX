-- 20261124000200_ai_assistant_feature.sql 되돌리기
-- 'ai4_assistant' 기록이 남아 있으면 먼저 지워야 허용 목록을 되돌릴 수 있다.
delete from public.ai_usage where feature = 'ai4_assistant';
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('ai1_search_text', 'ai2_explain', 'ai3_compare'));
-- ai_use 함수는 20261123000800_ai_usage.sql의 원래 정의를 다시 실행해 되돌린다.
