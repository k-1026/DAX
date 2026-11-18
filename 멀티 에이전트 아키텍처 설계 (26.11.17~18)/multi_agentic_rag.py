"""Multi Agentic RAG: 오케스트레이터가 서브에이전트(문서·웹·표·리서처)에게 일을 나눠 맡기고 보고를 종합한다.

- 오케스트레이터와 서브에이전트 모두 agent_loop.run_agent를 그대로 호출한다 (agent_loop.py는 고치지 않음).
- 서브에이전트 정의는 agent/*.yaml, 공용 템플릿·보고 양식은 agent/_template.yaml.
- 기존 orchestrator.py(멀티 에이전트 모드)는 건드리지 않는다.
"""

import sys
from pathlib import Path

import yaml
from google.genai import types

from agent_loop import run_agent
from subagents import research_agent
from tool import ALL_TOOL_FUNCTIONS, ALL_TOOL_SPECS

AGENT_DIR = Path(__file__).parent / "agent"
YAML_AGENTS = ["doc_searcher", "web_searcher", "data_analyst"]
MAX_TOOL_CALLS = 5  # 서브에이전트 1회 실행당 도구 호출 한도

TEMPLATE = yaml.safe_load((AGENT_DIR / "_template.yaml").read_text(encoding="utf-8"))


def load_agent(name: str) -> dict:
    spec = yaml.safe_load((AGENT_DIR / f"{name}.yaml").read_text(encoding="utf-8"))
    spec["system_prompt"] = (
        TEMPLATE["common_instruction"].format(
            name=spec["name"], role=spec["role"].strip(),
            tool_rules=spec["tool_rules"].strip(), rules=spec["rules"].strip(),
        )
        + "\n"
        + TEMPLATE["report_format"]
    )
    return spec


AGENTS = {name: load_agent(name) for name in YAML_AGENTS}

ORCHESTRATOR_PROMPT = """너는 오케스트레이터 에이전트다. 사용자의 질문을 받아 서브에이전트(도구)에게 일을 나눠 맡기고, 보고를 종합해 사용자에게 답한다.

## 서브에이전트
- doc_searcher: 서브에이전트 역할 문서(DOCS)에서 에이전트의 세부 지침을 찾는다.
- data_analyst: DOCS의 표(규칙_수치표.csv)에서 수치·기준값을 조회한다.
- web_searcher: 웹 검색으로 외부 사실을 찾는다 (출처 URL).
- researcher: 모델이 알고 있는 지식으로 주제를 조사·정리한다 (출처 URL 없음).

## 규칙
* 에이전트 세부사항은 docs에서 검색(doc_searcher, 수치·표는 data_analyst), 외부사실은 웹에서 검색(web_searcher)한다.
* 답마다 출처를 표기한다. 한 출처에서 못 찾은 내용이 있으면 다른 출처로 메꾸지 않는다.
* 사용자 질문을 그대로 넘기지 않는다. 질문을 서브에이전트마다 맞게 다시 써서 구체적인 지시(task)로 준다. 질문의 주제가 여럿이면 주제마다 나눠 지시한다.
* web_searcher와 researcher는 역할이 겹친다. 외부 정보가 필요한데 대화 기록에 사용자가 고른 순서가 없으면, 서브에이전트를 부르지 말고 사용자에게 먼저 이렇게만 묻고 답을 끝낸다:
  "외부 정보는 web_searcher(웹 검색, 출처 URL 제공)와 researcher(모델 지식으로 정리, 출처 URL 없음) 중 무엇을 먼저 쓸까요?"
  사용자가 고르면 그 에이전트를 먼저 쓴다. 먼저 쓴 에이전트가 찾지 못하면 그 사실을 밝히고, 다른 에이전트의 결과는 섞지 말고 별도 항목으로 출처와 함께 보여준다.
* 끝내 찾지 못한 내용은 추측하지 말고 '찾지 못함'으로 표시한다.
* 서브에이전트 보고에 없는 내용을 덧붙이지 않는다.

## 답변 형식
- 핵심 답을 먼저 쓰고, 문장마다 괄호로 출처(파일명, URL, 또는 'researcher·모델 지식')를 적는다.
- 마지막에 '찾지 못함' 항목이 있으면 따로 적는다."""

PRIORITY_QUESTION_KEY = "중 무엇을 먼저 쓸까요"  # 오케스트레이터가 순서를 물었는지 확인하는 문구

RESEARCHER_SPEC = types.FunctionDeclaration(
    name="researcher",
    description=research_agent.description + " 모델 지식으로 답하며 출처 URL은 없다.",
    parameters_json_schema={
        "type": "object",
        "properties": {"task": {"type": "string", "description": "다시 쓴 구체적인 지시"}},
        "required": ["task"],
    },
)


def agent_spec(name: str) -> types.FunctionDeclaration:
    return types.FunctionDeclaration(
        name=name,
        description=AGENTS[name]["description"],
        parameters_json_schema={
            "type": "object",
            "properties": {"task": {"type": "string", "description": "사용자 질문을 다시 쓴 구체적인 지시"}},
            "required": ["task"],
        },
    )


def multi_answer(question: str, history: list[dict] | None = None, on_event=None) -> dict:
    """
    on_event(선택): 모니터링 화면용 진행 이벤트를 받는 함수.
      orchestrator_start · agent_start(agent, task) · tool_call(agent, tool, query)
      · tool_result(agent, tool, query, result) · agent_end(agent, report) · final(reply)
    """
    details = []  # 서브에이전트별 실행 기록 (화면 표시용)

    def emit(event: dict) -> None:
        if on_event:
            on_event(event)

    def sub_events(agent: str):
        """서브에이전트 run_agent의 이벤트를 화면용 이벤트로 바꾼다."""
        def handle(e: dict) -> None:
            if e["type"] == "tool_start":
                emit({"type": "tool_call", "agent": agent, "tool": e["tool"], "query": e["args"].get("query", "")})
            elif e["type"] == "tool_end":
                emit({"type": "tool_result", "agent": agent, "tool": e["tool"],
                      "query": e["args"].get("query", ""), "result": e["result"]})
        return handle

    def orchestrator_events(e: dict) -> None:
        """오케스트레이터 run_agent의 이벤트: 도구 = 서브에이전트 호출."""
        if e["type"] == "tool_start":
            emit({"type": "agent_start", "agent": e["tool"], "task": e["args"].get("task", "")})
        elif e["type"] == "tool_end":
            emit({"type": "agent_end", "agent": e["tool"], "report": e["result"]})
            emit({"type": "orchestrator_start"})  # 보고를 받고 다시 판단
        elif e["type"] == "final":
            emit({"type": "final", "reply": e["answer"]})

    def limited(tool_name: str):
        count = {"n": 0}

        def call(**kwargs) -> str:
            if count["n"] >= MAX_TOOL_CALLS:
                return f"도구 호출 한도({MAX_TOOL_CALLS}회)에 도달했습니다. 지금까지 찾은 내용으로 보고하세요."
            count["n"] += 1
            return ALL_TOOL_FUNCTIONS[tool_name](**kwargs)

        return call

    def make_runner(name: str):
        spec = AGENTS[name]

        def run(task: str) -> str:
            result = run_agent(
                system_prompt=spec["system_prompt"],
                user_message=task,
                tools=[ALL_TOOL_SPECS[t] for t in spec["tools"]],
                tool_functions={t: limited(t) for t in spec["tools"]},
                max_turns=8,
                on_event=sub_events(name),
            )
            details.append({"agent": name, "task": task, "report": result["answer"], "tool_steps": result["steps"]})
            return result["answer"]

        return run

    def run_researcher(task: str) -> str:
        report = research_agent.run(task) + "\n\n(출처: researcher·모델 지식, URL 없음)"
        details.append({"agent": "researcher", "task": task, "report": report, "tool_steps": []})
        return report

    tools = [agent_spec(n) for n in YAML_AGENTS] + [RESEARCHER_SPEC]
    functions = {n: make_runner(n) for n in YAML_AGENTS}
    functions["researcher"] = run_researcher

    # web_searcher·researcher는 역할이 겹치므로, 사용자에게 순서를 물어본 뒤에만 실행되게 코드로도 막는다
    asked = any(h["role"] == "assistant" and PRIORITY_QUESTION_KEY in h["text"] for h in (history or []))
    if not asked:
        def blocked(**kwargs) -> str:
            return ("(실행되지 않음) web_searcher와 researcher 중 무엇을 먼저 쓸지 사용자에게 아직 묻지 않았습니다. "
                    "서브에이전트를 더 부르지 말고, 정해진 질문으로 사용자에게 먼저 물어보세요.")
        functions["web_searcher"] = blocked
        functions["researcher"] = blocked

    message = question
    if history:
        past = "\n".join(f"{'사용자' if h['role'] == 'user' else '오케스트레이터'}: {h['text']}" for h in history)
        message = f"[이전 대화]\n{past}\n\n[현재 질문]\n{question}"

    emit({"type": "orchestrator_start"})
    result = run_agent(
        system_prompt=ORCHESTRATOR_PROMPT,
        user_message=message,
        tools=tools,
        tool_functions=functions,
        max_turns=10,
        on_event=orchestrator_events,
    )
    return {"answer": result["answer"], "steps": details}


def multi_answer_stream(question: str, history: list[dict] | None = None):
    """multi_answer를 별도 스레드에서 돌리며 진행 이벤트를 하나씩 yield 한다 (SSE용)."""
    import queue
    import threading

    q: queue.Queue = queue.Queue()
    done = object()

    def worker():
        try:
            result = multi_answer(question, history, on_event=q.put)
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


def print_result(q: str, result: dict) -> None:
    print(f"\n{'=' * 70}\n질문: {q}\n{'-' * 70}")
    if not result["steps"]:
        print("  (서브에이전트 호출 없음)")
    for d in result["steps"]:
        print(f"  ▶ {d['agent']} ← 지시: {d['task']}")
        for s in d["tool_steps"]:
            print(f"      · {s['tool']}('{s['args'].get('query', '')}')")
    print(f"{'-' * 70}\n{result['answer']}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        q = " ".join(sys.argv[1:])
        print_result(q, multi_answer(q))
    else:
        q1 = "교육 업종 매물의 주변 분석 반경은 몇 m이고, 그 반경은 어떤 에이전트가 무슨 용도로 쓰나요?"
        print_result(q1, multi_answer(q1))

        q2 = "토지이음은 어느 기관이 운영하는 서비스인가요?"
        r2 = multi_answer(q2)
        print_result(q2, r2)

        q3 = "web_searcher 먼저 써줘"
        hist = [{"role": "user", "text": q2}, {"role": "assistant", "text": r2["answer"]}]
        print_result(q3 + "  (이전 대화 포함)", multi_answer(q3, hist))
