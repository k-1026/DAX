from google.genai import types

from config import MODEL_NAME, client
from subagents import research_agent, review_agent, writer_agent

MAX_TURNS = 10

AGENTS = {a.name: a for a in [research_agent, writer_agent, review_agent]}

# 서브에이전트를 오케스트레이터의 도구(FunctionDeclaration)로 선언
tool = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name=agent.name,
            description=agent.description,
            parameters_json_schema={
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "서브에이전트에게 맡길 작업 내용 (필요한 자료 포함)",
                    }
                },
                "required": ["task"],
            },
        )
        for agent in AGENTS.values()
    ]
)

SYSTEM_INSTRUCTION = (
    "당신은 오케스트레이터 에이전트입니다. "
    "사용자의 요청을 분석하여 필요한 서브에이전트(research_agent, writer_agent, review_agent)를 "
    "스스로 판단해 호출하세요. 서브에이전트끼리는 서로의 결과를 모르므로, "
    "앞선 서브에이전트의 결과가 필요하면 task에 그 내용을 넣어 전달하세요. "
    "서브에이전트들의 결과를 종합하여 사용자에게 최종 답변을 하세요."
)

config = types.GenerateContentConfig(
    system_instruction=SYSTEM_INSTRUCTION,
    tools=[tool],
    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
)


def run_stream(user_message: str):
    """오케스트레이터를 실행하면서 진행 이벤트(dict)를 하나씩 yield 한다."""
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=user_message)])]

    for turn in range(1, MAX_TURNS + 1):
        yield {"type": "orchestrator_start", "turn": turn}
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=contents,
            config=config,
        )

        if not response.function_calls:
            yield {"type": "final", "reply": response.text}
            return

        # 모델의 함수 호출 turn을 그대로 기록에 추가
        contents.append(response.candidates[0].content)

        response_parts = []
        for call in response.function_calls:
            task = call.args.get("task", "")
            print(f"[턴 {turn}] 오케스트레이터 → {call.name} 호출 | task: {task[:80]}...")
            yield {"type": "agent_start", "turn": turn, "agent": call.name, "task": task}
            try:
                result = AGENTS[call.name].run(task)
                function_response = {"result": result}
                print(f"[턴 {turn}] {call.name} 결과 수신 ({len(result)}자)")
                yield {"type": "agent_end", "turn": turn, "agent": call.name,
                       "result": result, "chars": len(result)}
            except Exception as e:
                function_response = {"error": str(e)}
                print(f"[턴 {turn}] {call.name} 오류: {e}")
                yield {"type": "agent_end", "turn": turn, "agent": call.name, "error": str(e)}
            response_parts.append(
                types.Part.from_function_response(name=call.name, response=function_response)
            )

        # Gemini Developer API는 함수 응답을 role="user"로 받음 (SDK 내부 자동 함수 호출과 동일)
        contents.append(types.Content(role="user", parts=response_parts))

    yield {"type": "final", "reply": "최대 반복 횟수를 넘어 답변을 완료하지 못했습니다."}


def run(user_message: str) -> str:
    reply = ""
    for event in run_stream(user_message):
        if event["type"] == "final":
            reply = event["reply"]
    return reply


if __name__ == "__main__":
    # 이벤트 순서 확인용
    for event in run_stream("재생에너지의 장점에 대한 짧은 글을 조사, 작성, 검토까지 해서 완성해줘."):
        summary = {k: (v[:40] + "..." if isinstance(v, str) and len(v) > 40 else v) for k, v in event.items()}
        print("EVENT:", summary)
