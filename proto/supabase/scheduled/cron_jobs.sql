-- 예약 실행 등록 (배포한 사이트 주소가 있을 때 Supabase SQL 편집기에서 한 번 실행)
-- migration이 아니다. 사이트 주소와 비밀값이 프로젝트마다 다르기 때문이다.
--
-- 실행 전 준비: Supabase 대시보드 → Project Settings → Vault 에 두 값을 등록한다.
--   site_url    : 배포 주소 (예: https://dax-mocha.vercel.app, 끝에 / 없이)
--   cron_secret : Vercel 환경 변수 CRON_SECRET 과 같은 값
-- 값을 이 파일이나 채팅에 적지 않는다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 상태 점검: 5분마다
select cron.schedule(
  'monitor-every-5-minutes',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'site_url') || '/api/cron/monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- 메일 정리(야간에 미룬 메일, 2년 주기 수신 동의 안내): 매시 정각
select cron.schedule(
  'mail-maintenance-hourly',
  '0 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'site_url') || '/api/cron/mail',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- 주간 실행(피드백 분석): 매주 월요일 새벽 3시(한국 시간) = 일요일 18시(UTC)
select cron.schedule(
  'weekly-monday-3am-kst',
  '0 18 * * 0',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'site_url') || '/api/cron/weekly',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- 해제할 때:
-- select cron.unschedule('weekly-monday-3am-kst');
-- select cron.unschedule('monitor-every-5-minutes');
-- select cron.unschedule('mail-maintenance-hourly');
