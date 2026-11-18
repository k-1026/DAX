"""범용 에이전트 루프 (Gemini 함수 호출). 이 파일은 만든 뒤 고치지 않는다.

run_agent()는 시스템 프롬프트·도구 명세·도구 함수를 받아
'모델 호출 → 도구 호출이 있으면 실행 → 결과를 돌려줌'을 도구 호출이 없을 때까지 반복한다.
"""

from typing import Callable

from google.genai import types

from config import MODEL_NAME, client


def run_agent(
    system_prompt: str,
    user_message: str,
    tools: list[types.FunctionDeclaration],
    tool_functions: dict[str, Callable[..., str]],
    max_turns: int = 10,
    on_event: Callable[[dict], None] | None = None,
) -> dict:
    """
    반환값: {"answer": 최종 답변, "steps": [도구 호출 기록]}
    steps 항목: {"turn", "tool", "args", "result"}
    on_event: 진행 상황을 받을 함수(선택). 도구 호출 전후와 최종 답변 때 dict를 넘긴다.
    """
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=[types.Tool(function_declarations=tools)],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=user_message)])]
    steps = []

    def emit(event: dict) -> None:
        if on_event:
            on_event(event)

    for turn in range(1, max_turns + 1):
        response = client.models.generate_content(model=MODEL_NAME, contents=contents, config=config)

        if not response.function_calls:
            answer = response.text or ""
            emit({"type": "final", "answer": answer})
            return {"answer": answer, "steps": steps}

        # 모델의 함수 호출 turn은 그대로 기록에 추가 (thought signature 보존)
        contents.append(response.candidates[0].content)

        parts = []
        for call in response.function_calls:
            args = dict(call.args or {})
            emit({"type": "tool_start", "turn": turn, "tool": call.name, "args": args})
            func = tool_functions.get(call.name)
            try:
                if func is None:
                    raise ValueError(f"등록되지 않은 도구입니다: {call.name}")
                result = func(**args)
                payload = {"result": result}
            except Exception as e:
                result = f"오류: {e}"
                payload = {"error": str(e)}
            steps.append({"turn": turn, "tool": call.name, "args": args, "result": result})
            emit({"type": "tool_end", "turn": turn, "tool": call.name, "args": args, "result": result})
            parts.append(types.Part.from_function_response(name=call.name, response=payload))

        # Gemini Developer API는 함수 응답을 role="user"로 받는다
        contents.append(types.Content(role="user", parts=parts))

    answer = "최대 반복 횟수를 넘어 답변을 완료하지 못했습니다."
    emit({"type": "final", "answer": answer})
    return {"answer": answer, "steps": steps}
