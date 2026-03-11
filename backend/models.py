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
        base_url=config["base_url"],
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

    if provider_type == "anthropic":
        raw = _call_anthropic(prompt, config)
    elif provider_type == "openai":
        raw = _call_openai_compatible(prompt, config)
    else:
        raise ValueError(f"Unknown provider type: {provider_type!r}")

    print(f"[provider:{provider_type}] response ({len(raw)} chars): {raw[:300]}")
    return raw


# ── Public API (used by pipeline.py) ───────────────────────────────────────────


def call_model_b(prompt: str, provider_config: dict) -> dict:
    """Call Model B (Extractor). Parses JSON robustly from the response."""
    raw = _call_provider(prompt, provider_config)
    result = _extract_json(raw)
    print(f"[model_b] parsed: {result}")
    return result


def call_model_a(prompt: str, provider_config: dict) -> dict:
    """Call Model A (Judge). Parses JSON robustly from the response."""
    raw = _call_provider(prompt, provider_config)
    result = _extract_json(raw)
    print(f"[model_a] parsed: {result}")
    return result
