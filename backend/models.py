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
    # /api/chat returns {"message": {"role": "assistant", "content": "..."}}
    raw = data["message"]["content"]
    print(f"[ollama] raw response ({len(raw)} chars): {raw[:300]}")
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
