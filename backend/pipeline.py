"""
Core two-model SYA detection pipeline.
Processes a full conversation and returns per-turn analysis results.
"""

from cleaner import strip_sypr
from models import call_model_a, call_model_b
from prompts import (
    prompt_detect_new_info,
    prompt_extract_stands,
    prompt_judge_sya,
)


def _safe_extract_stands(message: str, provider_config: dict) -> list[str]:
    """Extract stands from an assistant message. Returns [] on parse failure."""
    try:
        result = call_model_b(prompt_extract_stands(message), provider_config)
        stands = result.get("stands", [])
        if isinstance(stands, list):
            return [str(s) for s in stands]
        return []
    except Exception as e:
        print(f"[pipeline] extract_stands failed: {e}")
        return []


def _safe_detect_new_info(user_message: str, provider_config: dict) -> bool:
    """Detect new info in a user message. Defaults to True on failure (safe default)."""
    try:
        result = call_model_b(prompt_detect_new_info(user_message), provider_config)
        return bool(result.get("new_info_introduced", True))
    except Exception as e:
        print(f"[pipeline] detect_new_info failed: {e}")
        return True  # If unsure, assume new info → don't flag SYA


def _safe_judge_sya(
    previous_stands: list[str],
    current_stands: list[str],
    new_info_introduced: bool,
    provider_config: dict,
) -> dict:
    """Judge whether SYA occurred. Returns a safe default dict on failure."""
    default = {"sya_detected": False, "changed_stands": [], "reason": None}
    try:
        result = call_model_a(
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


def analyze_conversation(conversation: list[dict], provider_config: dict) -> list[dict]:
    """
    Analyze a full conversation for SYA per assistant turn.

    Args:
        conversation: List of {"role": "user"|"assistant", "content": "..."} dicts.
        provider_config: Provider configuration dict with keys:
            type, base_url, api_key, model.

    Returns:
        List of turn result dicts, one per assistant message:
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
    turns = []
    previous_stands: list[str] = []

    for idx, message in enumerate(conversation):
        if message["role"] != "assistant":
            continue

        assistant_text = message["content"]

        # Step 1 — Extract stands from this assistant message (Model B)
        current_stands = _safe_extract_stands(assistant_text, provider_config)
        print(f"[pipeline] turn {idx}: extracted {len(current_stands)} stands")

        # Step 2 — Detect new info in the PRECEDING user message (Model B)
        new_info_introduced = False
        if idx > 0 and conversation[idx - 1]["role"] == "user":
            preceding_user_msg = conversation[idx - 1]["content"]
            new_info_introduced = _safe_detect_new_info(
                preceding_user_msg, provider_config
            )
            print(f"[pipeline] turn {idx}: new_info={new_info_introduced}")

        # Step 3 — Judge SYA (Model A), only if we have prior stands to compare
        if previous_stands:
            judgment = _safe_judge_sya(
                previous_stands, current_stands, new_info_introduced, provider_config
            )
        else:
            # First assistant turn — nothing to compare against
            judgment = {"sya_detected": False, "changed_stands": [], "reason": None}

        # Step 4 — Strip SYPR openers (rule-based, no LLM)
        cleaned_message = strip_sypr(assistant_text)

        turns.append(
            {
                "turn_index": idx,
                "assistant_message": assistant_text,
                "sya_detected": judgment["sya_detected"],
                "changed_stands": judgment["changed_stands"],
                "reason": judgment["reason"],
                "cleaned_message": cleaned_message,
                "current_stands": current_stands,
                "new_info_introduced": new_info_introduced,
            }
        )

        # Update previous stands for next iteration
        previous_stands = current_stands

    return turns
