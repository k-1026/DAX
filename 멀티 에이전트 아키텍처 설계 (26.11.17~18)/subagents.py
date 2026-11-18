from google.genai import types

from config import MODEL_NAME, client


class SubAgent:
    def __init__(self, name: str, description: str, system_instruction: str):
        self.name = name
        self.description = description
        self.system_instruction = system_instruction

    def run(self, task: str) -> str:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=task,
            config=types.GenerateContentConfig(
                system_instruction=self.system_instruction,
            ),
        )
        return response.text


research_agent = SubAgent(
    name="research_agent",
    description="주제에 대한 정보 조사·정리가 필요할 때 호출합니다.",
    system_instruction=(
        "당신은 리서치 에이전트입니다. "
        "주어진 주제에 대해 핵심 정보, 사실, 주요 논점을 조사하여 "
        "항목별로 명확하게 정리해 반환하세요."
    ),
)

writer_agent = SubAgent(
    name="writer_agent",
    description="글·문서 작성이 필요할 때 호출합니다. 필요한 자료를 task에 함께 넣어야 합니다.",
    system_instruction=(
        "당신은 작성 에이전트입니다. "
        "task에 담긴 요구사항과 자료를 바탕으로 완성된 글(초안)을 작성해 반환하세요."
    ),
)

review_agent = SubAgent(
    name="review_agent",
    description="작성된 결과물의 검토·피드백이 필요할 때 호출합니다. 검토할 글을 task에 넣어야 합니다.",
    system_instruction=(
        "당신은 검토 에이전트입니다. "
        "전달된 글을 검토하여 문제점과 개선점을 지적하고, 수정안을 제시해 반환하세요."
    ),
)


if __name__ == "__main__":
    # 서브에이전트 3개 각각 단독 실행 테스트
    tests = [
        (research_agent, "재생에너지의 장점과 단점"),
        (writer_agent, "재생에너지의 장점을 소개하는 3문장짜리 짧은 글을 작성해줘."),
        (review_agent, "다음 글을 검토해줘: 재생에너지는 좋다. 환경에 좋고 돈도 안든다. 그래서 무조건 써야한다."),
    ]
    for agent, task in tests:
        result = agent.run(task)
        print(f"===== [{agent.name}] =====\n{result}\n")
