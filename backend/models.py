"""
Ollama HTTP call wrappers.
Talks directly to the Ollama REST API — no SDK used.
"""

import json
import re

import httpx

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "deepseek-v3.2:cloud"


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from a model response.
    Models often wrap their output in markdown fences or add preamble text,
    so we search for the first {...} block rather than blindly calling json.loads.
    """
    text = text.strip()

    # 1. Try a direct parse first (clean response)
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
    Send a prompt to Ollama and return the raw text response.
    Uses stream=False so the full response comes back in one shot.
    We do NOT pass format=json because grammar-constrained generation
    causes some models to emit the simplest valid JSON (e.g. {}) instead
    of following the prompt's schema. Instead we parse with _extract_json.
    """
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
    }
    response = httpx.post(OLLAMA_URL, json=payload, timeout=120.0)
    response.raise_for_status()
    data = response.json()
    raw = data["response"]
    print(f"[ollama] raw response ({len(raw)} chars): {raw[:300]}")
    return raw


def call_model_b(prompt: str) -> dict:
    """
    Call Model B (Extractor). Parses JSON robustly from the response.
    """
    raw = _call_ollama(prompt)
    result = _extract_json(raw)
    print(f"[model_b] parsed: {result}")
    return result


def call_model_a(prompt: str) -> dict:
    """
    Call Model A (Judge). Parses JSON robustly from the response.
    """
    raw = _call_ollama(prompt)
    result = _extract_json(raw)
    print(f"[model_a] parsed: {result}")
    return result
