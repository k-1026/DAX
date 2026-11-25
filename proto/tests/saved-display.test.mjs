import { test } from 'node:test';
import assert from 'node:assert/strict';
const display = await import('../lib/saved/display.ts').catch((e) => { if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e; });

test('관리비 미기재와 0원을 구분해 월 비용 표시', () => {
  assert.equal(display.monthlyCost({rent:100,maintenance_fee:null}),'100만원 + 관리비 미기재');
  assert.equal(display.monthlyCost({rent:100,maintenance_fee:0}),'100만원');
  assert.equal(display.monthlyCost({rent:100,maintenance_fee:12}),'112만원');
  assert.equal(display.monthlyCost({rent:null,maintenance_fee:10}),'미기재');
});
test('매물 이름·주소가 없으면 있는 정보만 표시', () => {
  assert.equal(display.savedTitle({building_name:null,gu:'중구',dong:'동인동'}),'중구 동인동');
  assert.equal(display.savedTitle({building_name:'시험 상가',gu:'중구',dong:'동인동'}),'시험 상가');
  assert.equal(display.savedAddress({address:null,gu:'중구',dong:'동인동'}),'중구 동인동 (상세 주소 미기재)');
});
