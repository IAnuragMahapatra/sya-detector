# SYA Detector

Detect sycophantic agreement (SYA) in LLM conversations and strip hollow openers (SYPR).

## Structure

```
backend/       FastAPI + Ollama two-model pipeline
extension/     Chrome MV3 extension for ChatGPT
```

## Quick Start

### Backend
```bash
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```

### Extension
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

> Requires Ollama running locally with `qwen2.5:7b` pulled.
