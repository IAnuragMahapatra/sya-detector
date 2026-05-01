"""
Core two-model SyA detection pipeline.
Processes a full conversation and returns per-turn analysis results.
Async with parallel LLM calls and incremental analysis support.
"""

import asyncio

from .cleaner import strip_sypr
from .models import call_stand_extractor, call_sya_judge
from .prompts import (
    prompt_detect_new_info,
    prompt_extract_stands,
    prompt_judge_sya,
)


async def _safe_extract_stands(message: str, provider_config: dict) -> list[str]:
    """Extract stands from an assistant message. Returns [] on parse failure."""
    try:
        result = await call_stand_extractor(
            prompt_extract_stands(message), provider_config
        )
        stands = result.get("stands", [])
        if isinstance(stands, list):
            return [str(s) for s in stands]
        return []
    except Exception as e:
        print(f"[pipeline] extract_stands failed: {e}")
        return []


async def _safe_detect_new_info(user_message: str, provider_config: dict) -> bool:
    """Detect new info in a user message. Defaults to True on failure (safe default)."""
    try:
        result = await call_stand_extractor(
            prompt_detect_new_info(user_message), provider_config
        )
        return bool(result.get("new_info_introduced", True))
    except Exception as e:
        print(f"[pipeline] detect_new_info failed: {e}")
        return True  # If unsure, assume new info → don't flag SyA


async def _safe_judge_sya(
    previous_stands: list[str],
    current_stands: list[str],
    new_info_introduced: bool,
    provider_config: dict,
) -> dict:
    """Judge whether SyA occurred. Returns a safe default dict on failure."""
    default = {"sya_detected": False, "changed_stands": [], "reason": None}
    try:
        result = await call_sya_judge(
            prompt_judge_sya(previous_stands, current_stands, new_info_introduced),
            provider_config,
        )
        return {
            "sya_detected": bool(result.get("sya_detected", False)),
            "changed_stands": result.get("changed_stands", []),
            "reason": result.get("reason", None),
        }
    except Exception as e:
        print(f"[pipeline] judge_sya failed: {e}")
        return default


async def analyze_conversation(
    conversation: list[dict],
    provider_config: dict,
    previous_stands: list[str] | None = None,
    skip_turns: int = 0,
) -> list[dict]:
    """
    Analyze a full conversation for SyA per assistant turn.

    Args:
        conversation: List of {"role": "user"|"assistant", "content": "..."} dicts.
        provider_config: Provider configuration dict with keys:
            type, base_url, api_key, model.
        previous_stands: Stands from the last analyzed assistant turn.
            Used for incremental analysis to avoid re-processing old turns.
        skip_turns: Number of assistant turns to skip (already analyzed).

    Returns:
        List of turn result dicts, one per NEW assistant message:
        {
            "turn_index": int,           # index in the conversation list
            "assistant_message": str,
            "sya_detected": bool,
            "changed_stands": list[str],
            "reason": str | None,
            "cleaned_message": str,
            "current_stands": list[str], # extracted by Model B
            "new_info_introduced": bool, # detected by Model B on preceding user msg
        }
    """
    assistant_turns = []
    assistant_count = 0

    extract_tasks = []
    new_info_tasks = []

    async def _dummy_false():
        return False

    for idx, message in enumerate(conversation):
        if message["role"] != "assistant":
            continue

        assistant_count += 1

        # Skip already-analyzed turns
        if assistant_count <= skip_turns:
            continue

        assistant_text = message["content"]
        preceding_user_msg = None
        if idx > 0 and conversation[idx - 1]["role"] == "user":
            preceding_user_msg = conversation[idx - 1]["content"]

        assistant_turns.append(
            {
                "idx": idx,
                "assistant_count": assistant_count,
                "assistant_text": assistant_text,
                "preceding_user_msg": preceding_user_msg,
            }
        )

        extract_tasks.append(_safe_extract_stands(assistant_text, provider_config))
        if preceding_user_msg:
            new_info_tasks.append(
                _safe_detect_new_info(preceding_user_msg, provider_config)
            )
        else:
            new_info_tasks.append(_dummy_false())

    if not assistant_turns:
        return []

    print(f"\n[Pipeline] Parallel processing {len(assistant_turns)} turns...")

    # Phase 1: Extract stands and detect new info in parallel for all ALL turns
    results = await asyncio.gather(
        asyncio.gather(*extract_tasks), asyncio.gather(*new_info_tasks)
    )
    all_current_stands = results[0]
    all_new_info = results[1]

    # Phase 2: Judge SyA in parallel for all turns
    judge_tasks = []

    async def _dummy_judgment():
        return {"sya_detected": False, "changed_stands": [], "reason": None}

    for i in range(len(assistant_turns)):
        curr_stands = all_current_stands[i]
        new_info = all_new_info[i]

        if i == 0:
            prev_stands = previous_stands if previous_stands is not None else []
        else:
            prev_stands = all_current_stands[i - 1]

        if prev_stands:
            judge_tasks.append(
                _safe_judge_sya(prev_stands, curr_stands, new_info, provider_config)
            )
        else:
            # First assistant turn (or first after skip) with no prior stands
            judge_tasks.append(_dummy_judgment())

    all_judgments = await asyncio.gather(*judge_tasks)

    # Phase 3: Assemble results
    turns = []
    for i, turn in enumerate(assistant_turns):
        idx = turn["idx"]
        assistant_text = turn["assistant_text"]
        judgment = all_judgments[i]

        cleaned_message = strip_sypr(assistant_text)

        turns.append(
            {
                "turn_index": idx,
                "assistant_message": assistant_text,
                "sya_detected": judgment["sya_detected"],
                "changed_stands": judgment["changed_stands"],
                "reason": judgment["reason"],
                "cleaned_message": cleaned_message,
                "current_stands": all_current_stands[i],
                "new_info_introduced": all_new_info[i],
            }
        )

    return turns
