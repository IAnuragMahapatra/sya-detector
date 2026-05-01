"""
FastAPI app — route definitions only.
All business logic lives in pipeline.py and cleaner.py.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .cleaner import strip_sypr
from .pipeline import analyze_conversation

app = FastAPI(title="Drift", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Provider config model ──────────────────────────────────────────────────────


class ProviderConfig(BaseModel):
    type: str  # "anthropic" | "openai"
    base_url: str | None = None
    api_key: str | None = None
    model: str
    anthropic_version: str = "2023-06-01"  # only used when type is "anthropic"


# ── Request / Response models ──────────────────────────────────────────────────


class ConversationMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AnalyzeRequest(BaseModel):
    provider: ProviderConfig
    conversation: list[ConversationMessage]
    previous_stands: list[str] = []  # stands from last analyzed turn (incremental)
    skip_turns: int = 0  # assistant turns already analyzed (incremental)


class TurnResult(BaseModel):
    turn_index: int
    assistant_message: str
    sya_detected: bool
    changed_stands: list[str]
    reason: str | None
    cleaned_message: str
    current_stands: list[str]
    new_info_introduced: bool


class AnalyzeResponse(BaseModel):
    turns: list[TurnResult]


class CleanRequest(BaseModel):
    text: str


class CleanResponse(BaseModel):
    cleaned: str


# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Analyze a conversation for Sycophantic Agreement (SyA).
    Returns one result per assistant turn.
    Supports incremental analysis via previous_stands and skip_turns.
    """
    if not request.conversation:
        raise HTTPException(status_code=400, detail="conversation must not be empty")

    conversation_dicts = [m.model_dump() for m in request.conversation]
    provider_dict = request.provider.model_dump()

    try:
        turns = await analyze_conversation(
            conversation_dicts,
            provider_dict,
            previous_stands=request.previous_stands,
            skip_turns=request.skip_turns,
        )
    except Exception as e:
        print(f"[main] /analyze error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return AnalyzeResponse(turns=turns)


@app.post("/clean", response_model=CleanResponse)
async def clean(request: CleanRequest):
    # Strip sycophantic openers (SYPR) from a text string.
    if not request.text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    cleaned = strip_sypr(request.text)
    return CleanResponse(cleaned=cleaned)
