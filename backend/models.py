"""
Ollama HTTP call wrappers.
Talks directly to the Ollama REST API — no SDK used.
"""

import json
import httpx

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "qwen2.5:7b"


def _call_ollama(prompt: str) -> str:
    """
    Send a prompt to Ollama and return the raw text response.
    Uses stream=False so the full response comes back in one shot.
    """
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }
    response = httpx.post(OLLAMA_URL, json=payload, timeout=120.0)
    response.raise_for_status()
    data = response.json()
    return data["response"]


def call_model_b(prompt: str) -> dict:
    """
    Call Model B (Extractor). Expects the model to return strict JSON.
    Parses and returns the JSON dict.
    """
    raw = _call_ollama(prompt)
    return json.loads(raw)


def call_model_a(prompt: str) -> dict:
    """
    Call Model A (Judge). Expects the model to return strict JSON.
    Parses and returns the JSON dict.
    """
    raw = _call_ollama(prompt)
    return json.loads(raw)
