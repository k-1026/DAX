from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

import agentic_rag
import multi_agentic_rag
import orchestrator
import rag

INDEX_HTML = Path(__file__).parent / "static" / "index.html"

app = FastAPI()


class ChatRequest(BaseModel):
    message: str


@app.get("/")
def index():
    return FileResponse(INDEX_HTML)


# 오케스트레이터는 블로킹 호출이므로 일반 def로 선언 (FastAPI가 스레드풀에서 실행)
@app.post("/chat")
def chat(request: ChatRequest):
    reply = orchestrator.run(request.message)
    return {"reply": reply}


# RAG 모드: DOCS 문서에서 검색한 조각으로 답변 (검색 1회 + 답변 1회)
@app.post("/rag")
def rag_chat(request: ChatRequest):
    result = rag.rag_answer(request.message)
    return {"reply": result["answer"], "hits": result["hits"]}


# Agentic RAG 모드: 에이전트가 search_docs 도구를 스스로 호출하며 답변
@app.post("/agentic-rag")
def agentic_rag_chat(request: ChatRequest):
    result = agentic_rag.agentic_answer(request.message)
    return {"reply": result["answer"], "steps": result["steps"]}


# Agentic RAG 모니터링용: 진행 이벤트를 SSE로 실시간 전달
@app.post("/agentic-rag/stream", response_class=EventSourceResponse)
def agentic_rag_stream(request: ChatRequest):
    for event in agentic_rag.agentic_answer_stream(request.message):
        yield ServerSentEvent(data=event, event=event["type"])


# Multi Agentic RAG 모드: 오케스트레이터가 doc_searcher·web_searcher·data_analyst·researcher에 일을 나눠 맡김
class MultiChatRequest(BaseModel):
    message: str
    history: list[dict] = []  # [{"role": "user"|"assistant", "text": ...}] 이 모드의 이전 대화


@app.post("/multi-agentic-rag")
def multi_agentic_rag_chat(request: MultiChatRequest):
    result = multi_agentic_rag.multi_answer(request.message, request.history)
    return {"reply": result["answer"], "steps": result["steps"]}


# Multi Agentic RAG 모니터링용: 진행 이벤트를 SSE로 실시간 전달
@app.post("/multi-agentic-rag/stream", response_class=EventSourceResponse)
def multi_agentic_rag_stream(request: MultiChatRequest):
    for event in multi_agentic_rag.multi_answer_stream(request.message, request.history):
        yield ServerSentEvent(data=event, event=event["type"])


# 진행 이벤트를 SSE로 실시간 전달 (오케스트레이터/서브에이전트 상태 표시용)
@app.post("/chat/stream", response_class=EventSourceResponse)
def chat_stream(request: ChatRequest):
    try:
        for event in orchestrator.run_stream(request.message):
            yield ServerSentEvent(data=event, event=event["type"])
    except Exception as e:
        yield ServerSentEvent(data={"type": "error", "message": str(e)}, event="error")
