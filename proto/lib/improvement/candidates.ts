// 개선 제안(주 1회): 리뷰 반복 요청 묶기 → 개선 후보 정리
// 규칙: 앱 개발/01_에이전트_AI서비스_제안.md A-2-2, A-2-6
import type { PipelineCall, Step } from "../pipeline/orchestrator";

export type GroupItem = { id: string; text: string };

export type Grouper = {
  provider: string;
  isTest: boolean;
  // 요청이 아닌 리뷰는 group을 null로 돌려준다.
  group: (items: GroupItem[]) => Promise<{ id: string; group: string | null; label?: string }[]>;
};

const BATCH_SIZE = 50;
const MAX_ROUNDS = 20;

// 개발용 가짜 묶기: 낱말로 요청을 묶는다. 결과는 시험용으로 표시되어 실제 후보에서 빠진다.
// AI 키를 연결하면 같은 모양(Grouper)의 AI 묶기로 바꾼다.
const FAKE_GROUPS: [string, string, RegExp][] = [
  ["map", "지도 기능 요청", /지도/],
  ["filter", "검색 조건 추가 요청", /필터|조건 (추가|검색)|검색 조건/],
  ["photo", "매물 사진 요청", /사진/],
  ["alert", "알림 관련 요청", /알림/],
];

export function fakeGrouper(): Grouper {
  return {
    provider: "fake",
    isTest: true,
    group: async (items) =>
      items.map((item) => {
        const hit = FAKE_GROUPS.find(([, , pattern]) => pattern.test(item.text));
        return { id: item.id, group: hit?.[0] ?? null, label: hit?.[1] };
      }),
  };
}

async function groupReviews(call: PipelineCall, grouper: Grouper) {
  let grouped = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const items = (await call("improvement_to_group", {
      p_provider: grouper.provider,
      p_limit: BATCH_SIZE,
    })) as GroupItem[];
    if (!items?.length) break;

    const results = await grouper.group(items);
    const saved = (await call("improvement_record_groups", {
      p_provider: grouper.provider,
      p_is_test: grouper.isTest,
      p_items: results,
    })) as number;
    grouped += saved;
    if (saved === 0) break;
  }
  return { grouped };
}

export function improvementSteps(grouper: Grouper, includeTest = false): Step[] {
  return [
    { key: "improvement_group", run: (call) => groupReviews(call, grouper) },
    {
      key: "improvement_candidates",
      run: (call) => call("improvement_weekly", { p_include_test: includeTest }),
    },
  ];
}
