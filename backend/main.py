"""
FastAPI app — route definitions only.
All business logic lives in pipeline.py and cleaner.py.
"""

from cleaner import strip_sypr
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pipeline import analyze_conversation
from pydantic import BaseModel

app = FastAPI(title="SYA Detector", version="1.0.0")

# Allow all origins — local PoC only
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────────────────


class ConversationMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AnalyzeRequest(BaseModel):
    conversation: list[ConversationMessage]


class TurnResult(BaseModel):
    turn_index: int
    assistant_message: str
    sya_detected: bool
    changed_stands: list[str]
    reason: str | None
    cleaned_message: str


class AnalyzeResponse(BaseModel):
    turns: list[TurnResult]


class CleanRequest(BaseModel):
    text: str


class CleanResponse(BaseModel):
    cleaned: str


# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    """
    Analyze a conversation for Sycophantic Agreement (SYA).
    Returns one result per assistant turn.
    """
    if not request.conversation:
        raise HTTPException(status_code=400, detail="conversation must not be empty")

    conversation_dicts = [m.model_dump() for m in request.conversation]

    try:
        turns = analyze_conversation(conversation_dicts)
    except Exception as e:
        print(f"[main] /analyze error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return AnalyzeResponse(turns=turns)


@app.post("/clean", response_model=CleanResponse)
def clean(request: CleanRequest):
    """
    Strip sycophantic openers (SYPR) from a text string.
    Rule-based, no LLM involved.
    """
    if not request.text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    cleaned = strip_sypr(request.text)
    return CleanResponse(cleaned=cleaned)
