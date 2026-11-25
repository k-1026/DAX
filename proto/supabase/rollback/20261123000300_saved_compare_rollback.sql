-- 6-D 함수만 제거한다. 기존 담기 목록·매물 데이터는 유지한다.
drop function if exists public.saved_compare(uuid[]);
drop function if exists public.saved_set(uuid,boolean,uuid);
drop function if exists public.saved_list_create(text);
drop function if exists public.saved_state();
drop function if exists public.saved_item(uuid);
