"""DOCS 폴더 문서만 사용하는 기본 RAG (벡터 DB·RAG 프레임워크 없이 numpy 사용).

흐름: 문서 읽기 → 조각내기 → Gemini 임베딩 → numpy 코사인 유사도 검색 → 상위 조각으로 답변 생성
(한 번 검색하고 한 번 답하는 단순 RAG. 에이전트 루프·도구 호출 없음)
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
from google.genai import types

from config import MODEL_NAME, client

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")
if not EMBEDDING_MODEL:
    raise RuntimeError(".env에 EMBEDDING_MODEL이 설정되어 있지 않습니다.")

BASE_DIR = Path(__file__).parent
DOCS_DIR = BASE_DIR / "DOCS"  # 색인 대상은 DOCS 폴더만 (하위 폴더·다른 폴더 제외)
EXCLUDE_FILES = {"서브에이전트 구성도.md"}  # 00~05와 내용이 겹치고 일부 내용이 상세 명세와 달라 제외

CHUNK_SIZE = 500     # 조각 최대 글자 수
CHUNK_OVERLAP = 100  # 앞 조각과 겹치는 글자 수
EMBEDDING_DIM = 768
EMBED_BATCH = 50     # 한 번의 임베딩 요청에 넣는 조각 수
TOP_K = 4            # 답변에 쓸 조각 수
CACHE_FILE = BASE_DIR / "rag_index.npz"  # 임베딩 저장 파일


# ---------- 1. 문서 읽기 ----------
def load_documents() -> list[dict]:
    docs = []
    for path in sorted(DOCS_DIR.glob("*.md")):
        if path.name in EXCLUDE_FILES:
            continue
        docs.append({
            "source": f"{DOCS_DIR.name}/{path.name}",  # 출처: 폴더명/파일명
            "title": path.stem,
            "text": path.read_text(encoding="utf-8"),
        })
    return docs


# ---------- 2. 조각내기 (줄 단위로 끊어 표·목록 한 줄이 잘리지 않게) ----------
def split_text(text: str) -> list[str]:
    lines = text.splitlines(keepends=True)
    chunks, current = [], []
    for line in lines:
        # 한 줄이 CHUNK_SIZE보다 길면 글자 단위로 자른다
        while len(line) > CHUNK_SIZE:
            lines_head, line = line[:CHUNK_SIZE], line[CHUNK_SIZE - CHUNK_OVERLAP:]
            if current:
                chunks.append("".join(current))
                current = []
            chunks.append(lines_head)
        if current and len("".join(current)) + len(line) > CHUNK_SIZE:
            chunks.append("".join(current))
            # 겹침: 앞 조각의 마지막 줄들을 CHUNK_OVERLAP 글자 안에서 다음 조각 앞에 붙인다
            overlap, size = [], 0
            for prev in reversed(current):
                if size + len(prev) > CHUNK_OVERLAP:
                    break
                overlap.insert(0, prev)
                size += len(prev)
            current = overlap
        current.append(line)
    if "".join(current).strip():
        chunks.append("".join(current))
    return [c.strip() for c in chunks if c.strip()]


def build_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for doc in docs:
        for i, piece in enumerate(split_text(doc["text"])):
            chunks.append({"source": doc["source"], "title": doc["title"], "index": i, "text": piece})
    return chunks


# ---------- 3. 임베딩 ----------
def embed(texts: list[str]) -> np.ndarray:
    vectors = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start:start + EMBED_BATCH]
        # gemini-embedding-2: 입력마다 Content로 감싸야 조각별로 따로 임베딩된다
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[types.Content(parts=[types.Part.from_text(text=t)]) for t in batch],
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        vectors.extend(e.values for e in result.embeddings)
    matrix = np.array(vectors, dtype=np.float32)
    return matrix / np.linalg.norm(matrix, axis=1, keepdims=True)  # 코사인 유사도용 정규화


def embed_chunks(chunks: list[dict]) -> np.ndarray:
    # 문서 쪽 형식: "title: {제목} | text: {내용}"
    return embed([f"title: {c['title']} | text: {c['text']}" for c in chunks])


def embed_query(question: str) -> np.ndarray:
    # 질문 쪽 형식: "task: search result | query: {질문}"
    return embed([f"task: search result | query: {question}"])[0]


# ---------- 4. 검색 ----------
def search(question: str, chunks: list[dict], matrix: np.ndarray, top_k: int = TOP_K) -> list[dict]:
    scores = matrix @ embed_query(question)
    best = np.argsort(scores)[::-1][:top_k]
    return [{**chunks[i], "score": float(scores[i])} for i in best]


# ---------- 5. 답변 생성 ----------
SYSTEM_INSTRUCTION = (
    "당신은 제공된 문서 조각만 근거로 답하는 도우미입니다. "
    "문서 조각에 답이 없으면 추측하지 말고 '문서에서 답을 찾을 수 없습니다.'라고만 답하세요. "
    "답변 끝에 근거로 쓴 조각의 출처를 [출처: 폴더/파일명] 형식으로 적으세요."
)


def answer(question: str, hits: list[dict]) -> str:
    context = "\n\n".join(
        f"[조각 {n}] 출처: {h['source']}\n{h['text']}" for n, h in enumerate(hits, start=1)
    )
    prompt = f"# 문서 조각\n{context}\n\n# 질문\n{question}"
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
    )
    return response.text


# ---------- 임베딩 저장(캐시) ----------
def fingerprint(chunks: list[dict]) -> str:
    """조각 내용·출처와 임베딩 설정이 하나라도 바뀌면 값이 달라진다."""
    payload = json.dumps(
        {"model": EMBEDDING_MODEL, "dim": EMBEDDING_DIM,
         "chunks": [[c["source"], c["index"], c["text"]] for c in chunks]},
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_cache(fp: str) -> np.ndarray | None:
    if not CACHE_FILE.exists():
        return None
    with np.load(CACHE_FILE, allow_pickle=False) as data:
        if str(data["fingerprint"]) != fp:
            return None
        return data["embeddings"]


def save_cache(fp: str, chunks: list[dict], matrix: np.ndarray) -> None:
    np.savez(
        CACHE_FILE,
        fingerprint=np.array(fp),
        embeddings=matrix,
        chunks=np.array(json.dumps(chunks, ensure_ascii=False)),  # 확인용으로 조각도 함께 저장
    )


def build_index() -> tuple[list[dict], np.ndarray]:
    docs = load_documents()
    chunks = build_chunks(docs)  # 조각내기는 API 호출이 없으므로 매번 다시 한다
    fp = fingerprint(chunks)
    matrix = load_cache(fp)
    if matrix is not None:
        status = f"저장된 임베딩 사용 ({CACHE_FILE.name})"
    else:
        matrix = embed_chunks(chunks)
        save_cache(fp, chunks, matrix)
        status = f"새로 임베딩해 저장 ({CACHE_FILE.name})"
    print(f"[색인] 문서 {len(docs)}개 → 조각 {len(chunks)}개 → 임베딩 {matrix.shape} · {status}")
    return chunks, matrix


_index: tuple[list[dict], np.ndarray] | None = None


def get_index() -> tuple[list[dict], np.ndarray]:
    """서버에서 쓸 때: 처음 한 번만 색인을 만들고 이후에는 재사용한다."""
    global _index
    if _index is None:
        _index = build_index()
    return _index


def rag_answer(question: str) -> dict:
    """웹 채팅용: 검색 1회 + 답변 1회 결과를 돌려준다."""
    chunks, matrix = get_index()
    hits = search(question, chunks, matrix)
    return {
        "answer": answer(question, hits),
        "hits": [
            {"source": h["source"], "index": h["index"], "score": round(h["score"], 3), "text": h["text"]}
            for h in hits
        ],
    }


def ask(question: str, chunks: list[dict], matrix: np.ndarray) -> None:
    hits = search(question, chunks, matrix)
    print(f"\n{'=' * 70}\n질문: {question}\n{'-' * 70}")
    for n, h in enumerate(hits, start=1):
        preview = h["text"].replace("\n", " ")[:70]
        print(f"  {n}. {h['score']:.3f}  {h['source']} #{h['index']}  | {preview}...")
    print(f"{'-' * 70}\n{answer(question, hits)}")


TEST_QUESTIONS = [
    "교육 업종 매물은 주변 가게 수를 몇 m 반경으로 세나요?",
    "좌표가 없는 매물을 ② 매물 수집·검증과 ③ 입지·상권 분석은 각각 어떻게 처리하나요?",
    "대구 달서구 상가의 평균 권리금은 얼마인가요?",
    "③ 입지·상권 분석에서 용도지역을 조회한다는 '토지이음'은 어느 기관이 운영하는 서비스인가요?",
]


if __name__ == "__main__":
    chunks, matrix = build_index()
    questions = [" ".join(sys.argv[1:])] if len(sys.argv) > 1 else TEST_QUESTIONS
    for q in questions:
        ask(q, chunks, matrix)
