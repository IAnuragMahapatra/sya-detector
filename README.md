# Drift: Real-time stance shift detection for LLMs

> A local pipeline to detect and mitigate distinct sycophantic behaviors in LLMs.

Large Language Models (LLMs) frequently exhibit sycophancy, generally defined as excessive agreement with or flattery of a user. Recent research ([Chen et al., 2025](https://arxiv.org/pdf/2509.21305)) demonstrates that sycophancy is not a single construct. Instead, behaviors like "sycophantic agreement" and "sycophantic praise" are encoded along distinct linear directions in a model's latent space and must be handled independently.

This tool applies that principle to ChatGPT interactions in real time. By separating the behaviors, it flags unjustified stance changes (Sycophantic Agreement) while structurally removing flattery (Sycophantic Praise) to ensure objective outputs.

---

## What it catches

The primary focus of this tool is identifying **SyA (Sycophantic Agreement)**.

**SyA (Opinion Sycophancy)** occurs when a model echoes a user's claim or reverses its previous position simply because the user pushed back, without any new factual evidence being introduced. The tool tracks the model's stance across the conversation and flags these unjustified changes. If new information is provided by the user, the change is treated as legitimate agreement. The objective is to catch when a model abandons logic to avoid conflict.

**SyPr (Sycophantic Praise)** is a secondary, operational feature targeting flattery. These are the reflexive, praising phrases like "Great question!" or "You are absolutely right!" that models use before providing a response. Because research shows this praise operates independently of factual agreement, the tool removes it using rule-based parsing. This keeps the conversation focused without requiring additional model inference.

---

## Architecture

The system uses a provider-agnostic backend with a two-model pipeline designed for reliability and performance.

### 1. Two-Model Pipeline

The detection logic is split into two specialized tasks to keep processing within the capabilities of smaller local models while maintaining high accuracy.

- **Model B: Extractor / New Info Detector**
  Runs twice per assistant turn. First, it analyzes the assistant's message to extract explicit positions as a list of atomic "stands". Second, it analyzes the preceding user message to determine if any new factual information was introduced that might justify a change in the model's stance.
- **Model A: Judge**
  Runs once per turn. It compares the extracted stands from the current turn with those of the previous turn. If a shift is detected and Model B indicates no new information was introduced, Model A flags the turn as Sycophantic Agreement.

### 2. Provider Independence

The backend is built to work with any provider supporting OpenAI or Anthropic compatible endpoints. This includes:

- **Local Models**: Ollama, vLLM, or any local inference server.
- **Cloud Providers**: OpenRouter, Gemini, DeepSeek, Anthropic, or OpenAI.

The system uses connection-pooled client caches to reuse TCP sockets across calls, significantly reducing latency for parallel LLM requests.

### 3. Telemetry Mode

Formerly Developer Mode, **Telemetry Mode** provides a real-time inspection panel under every assistant message. It displays the full internal trace of the pipeline:

- Extracted stands for the current turn.
- Detected shifts from the previous turn.
- New info detection results.
- The Judge's final verdict and reasoning.
- A diff showing exactly what SyPr text was removed.

---

## Project Structure

```text
drift/
├── backend/
│   ├── main.py          # FastAPI routes and configuration
│   ├── pipeline.py      # Two-model SyA detection loop
│   ├── prompts.py       # Prompt templates for Extractor and Judge
│   ├── cleaner.py       # SyPr (Sycophantic Praise) stripping
│   └── models.py        # Connection-pooled LLM client layer
├── extension/
│   ├── manifest.json    # Chrome MV3 manifest
│   ├── content_script.js# DOM observer and UI injection
│   ├── service_worker.js# Backend communication relay
│   └── popup/
│       ├── popup.html
│       └── popup.js
└── pyproject.toml
```

---

## Prerequisites

- Python 3.11 or higher
- [uv](https://github.com/astral-sh/uv) for managing dependencies
- Any LLM provider supporting OpenAI or Anthropic compatible APIs.
- Google Chrome

---

## Quick Start

### 1. Start the backend server

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

### 2. Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** at the top right
3. Click **Load unpacked** and select the `extension/` folder
4. Pin the Drift extension to your toolbar

Configure your provider (Anthropic, OpenAI, or a custom URL for local models like Ollama) in the extension popup. Now you can use ChatGPT as usual; the extension handles the detection in the background.

---

## Usage

Open [chatgpt.com](https://chatgpt.com) while the backend is running. The extension watches the page and triggers after each assistant response finishes.

- **SyA Flags**: If Sycophantic Agreement is found, a red `Drift Detected` badge appears above the message with the judge's reasoning.
- **SyPr Removal**: Reflexive openers are removed automatically and the cleaned text appears slightly muted.
- **Telemetry Mode Toggle**: Use the popup toggle to enable the detailed inspection panel.

---

## API

### `POST /analyze`

Runs the full pipeline. Supports incremental analysis to avoid re-processing old turns.

**Request:**

```json
{
  "provider": {
    "type": "openai",
    "base_url": "http://localhost:11434/v1",
    "model": "qwen2.5:7b"
  },
  "conversation": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

### `POST /clean`

SyPr stripping only: rule-based, zero-latency.

**Request:** `{ "text": "..." }`
**Response:** `{ "cleaned": "..." }`

---

## Roadmap

- [ ] Support for Claude.ai and Grok web adapters
- [ ] Confidence scores for SyA flags
- [ ] Export flagged conversations as annotated reports

---

## License

MIT (see the [LICENSE](./LICENSE) file for details).

---

## Acknowledgments

This project was built alongside **Antigravity** (Google DeepMind). It also includes contributions from **Claude Opus 4.6** and **Gemini 3.1 Pro**.

---

## Contact

Built by **Anurag Mahapatra**. You can reach out at <anurag2005om@gmail.com>.
