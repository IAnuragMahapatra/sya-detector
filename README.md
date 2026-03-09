# SYA Detector ⚠

> *Because "Great question! You're absolutely right!" isn't an answer — it's a surrender.*

LLMs are trained to be agreeable. That's mostly fine, until it isn't. Push back on something a model just told you, and there's a decent chance it quietly folds — not because you gave it a better argument, but because you disagreed. It'll reframe its previous answer, add softening caveats, or outright reverse course, all while sounding perfectly confident. No acknowledgement. No reasoning. Just... compliance.

This tool catches that. It watches your ChatGPT conversations in real-time, flags the moments a model capitulates without cause, and quietly strips the hollow opener fluff (*"Absolutely! That's a great point..."*) that pads every response before the actual answer begins.

It's a PoC. It's opinionated. It runs entirely on your machine.

---

## What It Catches

There are two distinct behaviors worth separating:

**SYPR — Sycophantic Preamble Response** is the easy one. These are the reflexive affirmations LLMs fire before answering anything — *"Great question!"*, *"Certainly!"*, *"That's a really insightful observation."* Pure RLHF residue. They carry zero information. The SYPR stripper kills them with a regex pass, no model needed, and the cleaned text renders slightly muted so you know a cut was made.

**SYA — Sycophantic Agreement** is the harder, more important one. This is when a model reverses or softens a previously stated position simply because you pushed back — not because you introduced new evidence or a better argument, just because you expressed disagreement. The pipeline tracks the model's stance across turns and flags it when that happens. If you *did* provide new information, the position change is treated as legitimate and ignored. The goal is to catch capitulation, not correct reasoning.

---

## How It Works

The backend uses a two-model pipeline running locally via Ollama. Both models are the same `qwen2.5:7b` — just different system prompts and jobs.

**Model B (Extractor)** runs twice per assistant turn. First on the assistant message, pulling out every explicit position as a short atomic statement. Then on the preceding user message, checking whether any new factual information was introduced. It outputs strict JSON both times.

**Model A (Judge)** runs once. It gets the previous turn's stands, the current stands, and the `new_info_introduced` flag. If the stands shifted and the user brought nothing new to the table — that's a flag.

The reason for splitting the task is simple: asking a single 7B model to read a full conversation and reason about stance drift across turns is too much at once. It loses the thread. Giving each model one focused job — extract, then judge — keeps each task well within what a small model handles reliably.

---

## Features

- **SYA Detection** — Flags unjustified position flips across conversation turns with a one-sentence explanation of what changed and why it's a flag.
- **SYPR Stripper** — Rule-based, zero-latency removal of hollow openers. No model call, no delay.
- **Developer Mode** — A collapsible inspection panel under every assistant message showing the full pipeline trace: extracted stands, what changed, whether new info was present, what was stripped.
- **Non-destructive** — Only prose is touched. Code blocks and formatting are left exactly as-is.
- **Fully local** — Nothing leaves your machine. No API keys, no external services.

---

## Structure

```text
sya-detector/
├── backend/
│   ├── main.py          # FastAPI routes
│   ├── pipeline.py      # Two-model SYA detection loop
│   ├── prompts.py       # All prompt templates
│   ├── cleaner.py       # SYPR stripping (rule-based)
│   └── models.py        # Ollama HTTP wrappers
├── extension/
│   ├── manifest.json    # MV3
│   ├── content_script.js
│   ├── service_worker.js
│   └── popup/
│       ├── popup.html
│       └── popup.js
└── pyproject.toml
```

---

## Prerequisites

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) for dependency management
- [Ollama](https://ollama.com) running locally with the model pulled:
  ```bash
  ollama pull qwen2.5:7b
  ```
- Google Chrome

---

## Quick Start

### 1. Start the backend

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

> Currently tuned for `deepseek-v3.2:cloud` but works with any standard chat model. Swap it out in `backend/models.py`.

### 2. Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the ⚠ SYA Detector extension to your toolbar

Then just use ChatGPT normally. The extension handles the rest.

---

## Usage

Head to [chatgpt.com](https://chatgpt.com) with the backend running. The extension watches the DOM via `MutationObserver` and fires after each assistant turn finishes streaming.

- If SYA is detected → a red `⚠ SYA Detected` badge appears above the message with a reason
- All responses → hollow openers are stripped, cleaned text renders slightly muted

Use the popup toggle to turn detection on or off at any time.

### Developer Mode

Flip on **Developer Mode** in the popup and a collapsible dark panel will appear under every assistant message with the full pipeline trace:

- Judge's verdict and one-sentence reason
- Which stands changed between turns
- Full extracted stands for the current turn
- Whether the preceding user message introduced new information
- A diff of exactly what SYPR text was stripped

---

## API

### `POST /analyze`

Runs the full pipeline. Returns per-turn SYA results and SYPR-cleaned text for every assistant message.

**Request:**
```json
{
  "conversation": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response:**
```json
{
  "turns": [
    {
      "turn_index": 2,
      "assistant_message": "...",
      "sya_detected": true,
      "changed_stands": ["previously said X, now says Y"],
      "reason": "Model reversed position after user pushback with no new evidence.",
      "cleaned_message": "..."
    }
  ]
}
```

### `POST /clean`

SYPR stripping only — rule-based, no model call, near-instant.

**Request:** `{ "text": "..." }`
**Response:** `{ "cleaned": "..." }`

---

## Roadmap

- [ ] Claude and Grok shared link parsing (website mode)
- [ ] Per-platform DOM adapters (Claude.ai, Grok)
- [ ] Confidence scores on SYA flags
- [ ] Stronger judge model option for production use
- [ ] Export flagged conversations as annotated reports

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

## Acknowledgments

Built alongside **Antigravity** (Google DeepMind), with contributions down the line from **Claude Opus 4.6** and **Gemini 3.1 Pro**.

---

## Contact

Built by **Anurag Mahapatra** — reach out at anurag2005om@gmail.com
