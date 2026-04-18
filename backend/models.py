"""
Provider-agnostic LLM call layer.
Dispatches to Anthropic or OpenAI-compatible APIs using official SDKs.
"""

import json
import re

import anthropic
import openai


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from a model response.
    Models often wrap output in markdown fences or add preamble text.
    """
    text = text.strip()

    # 1. Direct parse (clean response)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
    fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    fenced = re.sub(r"\s*```$", "", fenced, flags=re.MULTILINE).strip()
    try:
        return json.loads(fenced)
    except json.JSONDecodeError:
        pass

    # 3. Pull out the first {...} block (handles preamble/postamble text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No valid JSON object found in model response:\n{text[:500]}")


# ── Provider dispatch ──────────────────────────────────────────────────────────


def _call_openai_compatible(prompt: str, config: dict) -> str:
    """
    Call an OpenAI-compatible API (OpenAI, Ollama, or any compatible endpoint).
    Uses the official openai SDK with a custom base_url.
    """
    client = openai.OpenAI(
        base_url=config.get("base_url"),
        api_key=config.get("api_key", ""),
    )

    response = client.chat.completions.create(
        model=config["model"],
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    return response.choices[0].message.content or ""


def _call_anthropic(prompt: str, config: dict) -> str:
    """
    Call the Anthropic Messages API using the official anthropic SDK.
    """
    client = anthropic.Anthropic(
        api_key=config.get("api_key", ""),
    )

    response = client.messages.create(
        model=config["model"],
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    # Anthropic returns a list of content blocks
    return "".join(block.text for block in response.content if block.type == "text")


_LAST_CONFIG = None

def _log_config_change(config: dict):
    global _LAST_CONFIG
    current = (config.get("model"), config.get("base_url"))
    if _LAST_CONFIG != current:
        base_url = config.get("base_url") or "default"
        print(f"\n[Config] Model: {current[0]} | Base URL: {base_url}\n")
        _LAST_CONFIG = current

def _call_provider(prompt: str, config: dict) -> str:
    """
    Dispatch a prompt to the configured provider.

    Args:
        prompt: The prompt string to send.
        config: Provider config dict with keys: type, base_url, api_key, model.

    Returns:
        Raw text response from the model.
    """
    provider_type = config.get("type", "openai")

    _log_config_change(config)

    if provider_type == "anthropic":
        raw = _call_anthropic(prompt, config)
    elif provider_type == "openai":
        raw = _call_openai_compatible(prompt, config)
    else:
        raise ValueError(f"Unknown provider type: {provider_type!r}")

    return raw


# ── Public API (used by pipeline.py) ───────────────────────────────────────────


def call_stand_extractor(prompt: str, provider_config: dict) -> dict:
    """Call the Stand Extractor / New Info Detector. Parses JSON robustly from the response."""
    raw = _call_provider(prompt, provider_config)
    result = _extract_json(raw)
    
    if "stands" in result:
        print(f"  └─ [Stand Extractor] Found {len(result['stands'])} stands")
    elif "new_info_introduced" in result:
        print(f"  └─ [Stand Extractor] New Info: {result['new_info_introduced']}")
    else:
        print("  └─ [Stand Extractor] Done")
        
    return result


def call_sya_judge(prompt: str, provider_config: dict) -> dict:
    """Call the SYA Judge. Parses JSON robustly from the response."""
    raw = _call_provider(prompt, provider_config)
    result = _extract_json(raw)
    
    sya_status = result.get('sya_detected', False)
    print(f"  └─ [SYA Judge] SYA Detected: {sya_status}")
    
    return result
