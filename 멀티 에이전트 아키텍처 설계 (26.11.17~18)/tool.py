"""에이전트가 쓰는 도구: search_docs (DOCS 문서 검색)

검색은 rag.py의 색인(조각·임베딩)과 numpy 코사인 유사도 검색을 그대로 사용한다.
"""

from google.genai import types

import rag

# ---------- 도구 명세 ----------
SEARCH_DOCS_SPEC = types.FunctionDeclaration(
    name="search_docs",
    description=(
        "대구 빈 상가 찾기 서비스의 서브에이전트 역할 문서(DOCS 폴더)에서 "
        "검색어와 가장 관련 있는 문서 조각을 찾는다. "
        "결과는 조각 본문과 출처 파일명을 포함한 문자열이다."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "검색어. 사용자 문장을 그대로 쓰지 말고 핵심 키워드로 쓴다.",
            },
            "top_k": {
                "type": "integer",
                "description": "가져올 조각 수 (기본 4, 최대 8)",
            },
        },
        "required": ["query"],
    },
)


# ---------- 도구 함수 ----------
def search_docs(query: str, top_k: int = rag.TOP_K) -> str:
    top_k = max(1, min(int(top_k), 8))
    chunks, matrix = rag.get_index()
    hits = rag.search(query, chunks, matrix, top_k=top_k)
    lines = [f"검색어: {query} · 결과 {len(hits)}개"]
    for n, h in enumerate(hits, start=1):
        lines.append(
            f"\n[결과 {n}] 출처: {h['source']} (조각 #{h['index']}, 유사도 {h['score']:.3f})\n{h['text']}"
        )
    return "\n".join(lines)


TOOLS = [SEARCH_DOCS_SPEC]
TOOL_FUNCTIONS = {"search_docs": search_docs}


# ======================================================================
# Multi Agentic RAG용 도구: web_search, query_table
# ======================================================================
import csv

from google import genai

from config import GEMINI_API_KEY, MODEL_NAME

# 웹 검색 전용 클라이언트: 할당량 초과(429) 등에서 재시도하며 오래 멈추지 않도록
# 재시도 1회(=재시도 없음), 대기 시간 30초로 제한한다.
WEB_TIMEOUT_SEC = 30
web_client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options=types.HttpOptions(
        timeout=WEB_TIMEOUT_SEC * 1000,
        retry_options=types.HttpRetryOptions(attempts=1),
    ),
)

WEB_SEARCH_SPEC = types.FunctionDeclaration(
    name="web_search",
    description="Google 검색으로 외부 사실을 찾는다. 결과는 검색 요약과 출처 URL 목록을 포함한 문자열이다.",
    parameters_json_schema={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "검색어 (핵심 키워드)"}},
        "required": ["query"],
    },
)


def web_search(query: str) -> str:
    """Gemini Interactions API의 google_search 도구로 검색한다 (공식 문서 방식)."""
    try:
        interaction = web_client.interactions.create(
            model=MODEL_NAME,
            input=f"다음을 웹에서 검색해 사실만 짧게 정리해줘: {query}",
            tools=[{"type": "google_search"}],
            timeout=WEB_TIMEOUT_SEC,
        )
    except Exception as e:
        reason = "API 할당량 초과(429)" if "429" in str(e) else f"{type(e).__name__}: {str(e)[:150]}"
        return f"검색어: {query}\n웹 검색 실패: {reason}\n(이 검색으로는 찾지 못함)"

    citations = []
    for step in interaction.steps or []:
        if step.type == "model_output":
            for block in step.content or []:
                if block.type == "text" and block.annotations:
                    for a in block.annotations:
                        if a.type == "url_citation" and a.url not in [c[1] for c in citations]:
                            citations.append((a.title, a.url))
    lines = [f"검색어: {query}", f"검색 요약: {interaction.output_text}", "출처 URL:"]
    lines += [f"- {title}: {url}" for title, url in citations] or ["- (출처 URL 없음)"]
    return "\n".join(lines)


TABLE_FILE = rag.DOCS_DIR / "규칙_수치표.csv"

QUERY_TABLE_SPEC = types.FunctionDeclaration(
    name="query_table",
    description=(
        "DOCS/규칙_수치표.csv에서 조회어가 들어간 행을 찾는다. "
        "업종별 반경, 점수 구분선, 기준 일수·건수 같은 수치를 조회할 때 쓴다. "
        "결과는 표 행과 출처 파일명을 포함한 문자열이다."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "조회어. 공백으로 여러 키워드를 줄 수 있다 (예: '반경 교육')"},
        },
        "required": ["query"],
    },
)


def query_table(query: str) -> str:
    with TABLE_FILE.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    keywords = [k for k in query.split() if k]
    scored = []
    for row in rows:
        text = " ".join(row.values())
        score = sum(1 for k in keywords if k in text)
        if score:
            scored.append((score, row))
    scored.sort(key=lambda x: -x[0])
    matched = [r for _, r in scored[:10]]
    source = f"{rag.DOCS_DIR.name}/{TABLE_FILE.name}"
    if not matched:
        return f"조회어: {query}\n조회 결과 없음 (표: {source})"
    header = list(rows[0].keys())
    lines = [f"조회어: {query} · {len(matched)}행 (표: {source})", "| " + " | ".join(header) + " |",
             "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(r[h] for h in header) + " |" for r in matched]
    return "\n".join(lines)


ALL_TOOL_SPECS = {"search_docs": SEARCH_DOCS_SPEC, "web_search": WEB_SEARCH_SPEC, "query_table": QUERY_TABLE_SPEC}
ALL_TOOL_FUNCTIONS = {"search_docs": search_docs, "web_search": web_search, "query_table": query_table}
