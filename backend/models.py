"""
Ollama HTTP call wrappers.
Talks directly to the Ollama REST API — no SDK used.
"""

import json
import re

import httpx

OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "deepseek-v3.2:cloud"


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


def _call_ollama(prompt: str) -> str:
    """
    Send a prompt to Ollama via the /api/chat endpoint.

    Chat-tuned models (e.g. deepseek, qwen-instruct) return an empty
    `response` field on /api/generate because they expect the messages
    array format. /api/chat is the correct endpoint for them.
    """
    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    response = httpx.post(OLLAMA_CHAT_URL, json=payload, timeout=120.0)
    response.raise_for_status()
    data = response.json()
    # Log the full structure so we can diagnose unexpected response shapes
    print(f"[ollama] response keys: {list(data.keys())}")
    print(f"[ollama] raw data: {str(data)[:600]}")
    # Try to extract the content from whatever shape Ollama returns.
    # DeepSeek V3 (reasoning model) puts JSON-only answers in message["thinking"]
    # and leaves message["content"] empty. Priority order:
    #   1. message["content"]   — standard chat response
    #   2. message["thinking"]  — DeepSeek / reasoning models
    #   3. data["response"]     — generate endpoint fallback
    #   4. first non-empty string value in top-level dict
    raw = ""
    if isinstance(data.get("message"), dict):
        raw = data["message"].get("content", "").strip()
        if not raw:
            raw = data["message"].get("thinking", "").strip()
    if not raw:
        raw = data.get("response", "").strip()
    if not raw:
        for v in data.values():
            if isinstance(v, str) and v.strip():
                raw = v
                break

    print(f"[ollama] extracted content ({len(raw)} chars): {raw[:300]}")
    return raw


def call_model_b(prompt: str) -> dict:
    """Call Model B (Extractor). Parses JSON robustly from the response."""
    raw = _call_ollama(prompt)
    result = _extract_json(raw)
    print(f"[model_b] parsed: {result}")
    return result


def call_model_a(prompt: str) -> dict:
    """Call Model A (Judge). Parses JSON robustly from the response."""
    raw = _call_ollama(prompt)
    result = _extract_json(raw)
    print(f"[model_a] parsed: {result}")
    return result
