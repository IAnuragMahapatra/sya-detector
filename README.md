# SYA Detector ⚠

A proof-of-concept pipeline and Chrome extension to detect **Sycophantic Agreement (SYA)** in LLM conversations and strip hollow affirmative openers (**SYPR**).

When an LLM changes its stated position without any new evidence or logical arguments from the user (e.g. just because the user disagreed or pushed back), it is exhibiting sycophancy. This tool detects that behavior in real-time on `chatgpt.com`.

## Features

- **SYA Detection**: Uses a two-model pipeline to detect unjustified position flips.
- **SYPR Stripper**: Rule-based regex stripper that removes hollow, sycophantic openers (e.g., *"Absolutely! That's a great point..."*) without needing another LLM call.
- **Developer Mode**: In-page inspection panels revealing exactly what the LLMs extracted and evaluated at every turn.
- **Non-destructive**: Replaces ChatGPT's prose text iteratively while perfectly preserving code blocks and formatting.

---

## The Pipeline

The backend runs locally via FastAPI and talks directly to Ollama.

1. **Model B (Extractor)** instances:
   - Reads the assistant message → extracts specific stances/positions.
   - Reads the preceding user message → flags if *new information* was introduced.
2. **Model A (Judge)**:
   - Reads previous stands + current stands + `new_info` flag.
   - If stands reversed/shifted heavily AND no new info was given → **Flags SYA**.
   - If new info was given → position chance is allowed, does not flag.

---

## Quick Start

### 1. Backend

The backend uses `uv` for dependency management. Requires Ollama running locally.

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

> **Note**: Currently tuned for `deepseek-v3.2:cloud` (reasoning model) but works with standard chat models (e.g., `qwen2.5:7b`).

### 2. Extension

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Pin the ⚠ SYA Detector extension to your toolbar.

---

## Usage & Developer Mode

Browse to ChatGPT. The extension will automatically watch the DOM.
When an assistant finishes streaming a response:
- If SYA is detected, a red ⚠ badge is injected above the message.
- Any sycophantic openers are stripped from the text (the new text renders slightly muted).

**🛠 Developer Mode**
Open the extension popup and toggle on **Developer Mode**. A dark collapsible panel will appear under every assistant message showing the raw pipeline reasoning:
- The Judge's final verdict and one-sentence reason
- The specific stands that changed
- The full list of extracted stands for that turn
- Whether the user provided new info
- A diff showing the exact SYPR prefix that was stripped
