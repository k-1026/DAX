// 실행: node --test tests/saved-db.test.mjs
// 개발 의존성 @electric-sql/pglite 사용. 서비스 DB 접속 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('담기·비교의 실제 DB 권한과 저장 한도', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const name of ['20261118000100_profiles_consents.sql', '20261119000200_membership_tiers.sql', '20261119000300_agent_pipeline.sql', '20261119000400_mail.sql']) {
    await db.exec(await sql(name));
  }
  // RED 단계에는 새 마이그레이션이 없어 기존 DB에서 시험한다.
  const migration = await sql('20261123000300_saved_compare.sql').catch((e) => { if (e.code === 'ENOENT') return ''; throw e; });
  if (migration) await db.exec(migration);
  const user = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';
  const ids = Array.from({length: 7}, (_, i) => `10000000-0000-4000-8000-00000000000${i + 1}`);
  await db.query('insert into auth.users(id) values ($1),($2)', [user, other]);
  for (const [i, id] of ids.entries()) {
    await db.query(`insert into public.listings(id,source,source_listing_id,content_hash,listing_data,public_at)
      values ($1,'naver-test',$2,'test',$3::jsonb,now() + $4::interval)`,
      [id, String(i), JSON.stringify({gu:'중구',dong:'동인동',floor:'1층',address:'대구 중구 시험길 1',rent:100,deposit:1000,maintenance_fee:i === 0 ? null : 0,area_m2:50}), i === 6 ? '1 day' : '-1 day']);
  }
  async function login(id, role = 'authenticated') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    await db.exec(`set role ${role}`);
  }
  async function rpc(name, args = [], signature = '') {
    return (await db.query(`select public.${name}(${signature || args.map((_,i)=>`$${i+1}`).join(',')}) as result`, args)).rows[0].result;
  }
  await login(null, 'anon');
  await t.test('비로그인은 저장 RPC 실행 불가', async () => {
    await assert.rejects(() => rpc('saved_state'), /permission denied/);
  });
  await login(user);
  let listId;
  await t.test('3곳 저장·중복 저장은 그대로, 4번째는 거절', async () => {
    assert.equal((await rpc('saved_set',[ids[0],true,null])).ok, true);
    assert.equal((await rpc('saved_set',[ids[0],true,null])).ok, true);
    assert.equal((await rpc('saved_set',[ids[1],true,null])).ok, true);
    assert.equal((await rpc('saved_set',[ids[2],true,null])).ok, true);
    assert.equal((await rpc('saved_set',[ids[3],true,null])).error, 'saved_limit');
    const state = await rpc('saved_state');
    assert.equal(state.total,3);
    assert.equal(state.lists.length,1);
    listId = state.lists[0].id;
    assert.equal(state.items.find((x)=>x.listing_id===ids[0]).data.maintenance_fee,null);
  });
  await t.test('새 요청에서도 저장 유지·해제 후 다른 매물 담기', async () => {
    await login(user);
    assert.equal((await rpc('saved_state')).total,3);
    assert.equal((await rpc('saved_set',[ids[2],false,listId])).ok,true);
    assert.equal((await rpc('saved_set',[ids[3],true,listId])).ok,true);
    assert.equal((await rpc('saved_state')).total,3);
  });
  await t.test('무료 회원은 목록 1개·선공개 담기 불가', async () => {
    assert.equal((await rpc('saved_list_create',['두 번째'])).error,'list_limit');
    assert.equal((await rpc('saved_set',[ids[6],true,listId])).error,'not_available');
  });
  await t.test('2곳 반복 비교 가능·3곳과 미저장 매물은 거절', async () => {
    for (let i=0;i<4;i++) assert.equal((await rpc('saved_compare',[[ids[0],ids[1]]],'$1::uuid[]')).items.length,2);
    assert.equal((await rpc('saved_compare',[[ids[0],ids[1],ids[3]]],'$1::uuid[]')).error,'compare_limit');
    assert.equal((await rpc('saved_compare',[[ids[0],ids[4]]],'$1::uuid[]')).error,'not_saved');
    assert.equal((await rpc('saved_compare',[[ids[0],ids[0]]],'$1::uuid[]')).error,'choose_two');
  });
  await t.test('다른 회원은 목록·담은 매물 접근 불가', async () => {
    await login(other);
    assert.equal((await rpc('saved_state')).total,0);
    assert.equal((await rpc('saved_set',[ids[0],true,listId])).error,'not_found');
    assert.equal((await rpc('saved_set',[ids[0],false,listId])).error,'not_found');
    assert.equal((await rpc('saved_compare',[[ids[0],ids[1]]],'$1::uuid[]')).error,'not_saved');
    assert.equal((await db.query('select * from public.saved_lists')).rows.length,0);
    await assert.rejects(()=>db.query('insert into public.saved_lists(user_id) values ($1)',[other]),/permission denied/);
  });
  await login(null,'service_role');
  await db.exec('reset role');
  await db.query(`insert into public.subscriptions(user_id,status,current_period_start,current_period_end)
    values ($1,'active',now()-interval '1 day',now()+interval '1 day')`,[user]);
  await login(user);
  let second;
  await t.test('구독은 여러 목록·3곳 초과 담기·5곳 비교', async () => {
    second = (await rpc('saved_list_create',['다른 후보'])).id;
    assert.ok(second);
    for (const id of [ids[2],ids[4],ids[5],ids[6]]) assert.equal((await rpc('saved_set',[id,true,second])).ok,true);
    assert.equal((await rpc('saved_compare',[ids.slice(0,5)],'$1::uuid[]')).items.length,5);
    assert.equal((await rpc('saved_compare',[ids.slice(0,6)],'$1::uuid[]')).error,'compare_limit');
  });
  await t.test('구독 만료 시 선공개 숨김·초과 저장은 해제 가능', async () => {
    await db.exec('reset role');
    await db.query("update public.subscriptions set status='expired' where user_id=$1",[user]);
    await login(user);
    const state = await rpc('saved_state');
    const hidden = state.items.find((x)=>x.listing_id===ids[6]);
    assert.equal(hidden.available,false);
    assert.equal(hidden.data,undefined);
    assert.equal((await rpc('saved_compare',[[ids[0],ids[6]]],'$1::uuid[]')).error,'not_available');
    assert.equal((await rpc('saved_set',[ids[6],false,second])).ok,true);
  });
  await t.test('되돌리기는 추가 함수만 제거하고 저장 데이터 유지', async () => {
    await db.exec('reset role');
    const before = (await db.query('select count(*)::int as n from public.saved_listings')).rows[0].n;
    await db.exec(await readFile(new URL('../supabase/rollback/20261123000300_saved_compare_rollback.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select count(*)::int as n from public.saved_listings')).rows[0].n,before);
  });
});
