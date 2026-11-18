"""Agentic RAG: 에이전트가 search_docs 도구를 스스로 판단해 호출하며 답한다.

에이전트 루프는 agent_loop.run_agent를 그대로 호출한다 (agent_loop.py는 고치지 않음).
"""

import sys

from agent_loop import run_agent
from tool import TOOL_FUNCTIONS, TOOLS

MAX_SEARCHES = 5

SYSTEM_PROMPT = """너는 서브에이전트의 역할 문서를 근거로 답하는 에이전트야. search_docs 도구로 문서를 찾을 수 있어.

* 일반 상식에 해당하는 문서가 필요없는 질문은 검색하지 않고, 검색어는 사용자의 문장을 그대로 쓰지않고 핵심키워드로 다시 쓴다.
* 질문의 주제가 여럿이면 주제마다 따로 검색
* 결과에 답이 없으면 다른 검색어로 다시 찾는다. 같은 검색어 반복하지 않는다
* 검색은 최대 5회로 제한
* 검색된 문서에 있는 내용만 근거로 답하고 문장마다 출처 파일명을 괄호로 적고
* 끝내 찾지 못한 내용은 추측하지 말고 '문서에서 찾지못함' 으로 표시"""


def make_tool_functions() -> dict:
    """질문 1개마다 검색 횟수를 세어 5회를 넘으면 검색하지 않는다 (프롬프트 규칙을 코드로도 보장)."""
    count = {"n": 0}

    def limited_search_docs(**kwargs) -> str:
        if count["n"] >= MAX_SEARCHES:
            return f"검색 횟수 제한({MAX_SEARCHES}회)에 도달했습니다. 지금까지 찾은 내용만으로 답하세요."
        count["n"] += 1
        return TOOL_FUNCTIONS["search_docs"](**kwargs)

    return {"search_docs": limited_search_docs}


def agentic_answer(question: str, on_event=None) -> dict:
    return run_agent(
        system_prompt=SYSTEM_PROMPT,
        user_message=question,
        tools=TOOLS,
        tool_functions=make_tool_functions(),
        on_event=on_event,
    )


def agentic_answer_stream(question: str):
    """agentic_answer를 별도 스레드에서 돌리며 모니터링용 진행 이벤트를 하나씩 yield 한다 (SSE용).

    이벤트: agent_think · search_start(query) · search_end(query, result) · final(reply) · steps(steps) · error(message)
    """
    import queue
    import threading

    q: queue.Queue = queue.Queue()
    done = object()

    def on_event(e: dict) -> None:
        if e["type"] == "tool_start":
            q.put({"type": "search_start", "query": e["args"].get("query", "")})
        elif e["type"] == "tool_end":
            q.put({"type": "search_end", "query": e["args"].get("query", ""), "result": e["result"]})
            q.put({"type": "agent_think"})  # 검색 결과를 보고 다시 판단
        elif e["type"] == "final":
            q.put({"type": "final", "reply": e["answer"]})

    def worker():
        try:
            q.put({"type": "agent_think"})
            result = agentic_answer(question, on_event=on_event)
            q.put({"type": "steps", "steps": result["steps"]})
        except Exception as e:
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(done)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        event = q.get()
        if event is done:
            return
        yield event


TEST_QUESTIONS = [
    "교육 업종 매물은 주변 가게 수를 몇 m 반경으로 세나요?",
    "좌표가 없는 매물을 ② 매물 수집·검증과 ③ 입지·상권 분석은 각각 어떻게 처리하나요?",
    "대구 달서구 상가의 평균 권리금은 얼마인가요?",
    "③ 입지·상권 분석에서 용도지역을 조회한다는 '토지이음'은 어느 기관이 운영하는 서비스인가요?",
    "대한민국의 수도는 어디인가요?",  # 일반 상식: 검색하지 않아야 함
]


if __name__ == "__main__":
    questions = [" ".join(sys.argv[1:])] if len(sys.argv) > 1 else TEST_QUESTIONS
    for q in questions:
        result = agentic_answer(q)
        print(f"\n{'=' * 70}\n질문: {q}\n{'-' * 70}")
        if not result["steps"]:
            print("  (검색 안 함)")
        for s in result["steps"]:
            first = s["result"].splitlines()
            sources = [l.split("출처: ")[1].split(" (")[0] for l in first if "출처: " in l]
            print(f"  검색 {s['turn']}턴: '{s['args'].get('query')}' → {', '.join(dict.fromkeys(sources)) or s['result'][:40]}")
        print(f"{'-' * 70}\n{result['answer']}")
