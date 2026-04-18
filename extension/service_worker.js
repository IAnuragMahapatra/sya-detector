/**
 * service_worker.js
 * Receives conversation data from the content script,
 * POSTs to the backend /analyze endpoint, and returns the result.
 * Includes a fetch timeout and passes incremental analysis params.
 */

const BACKEND_URL = "http://localhost:8000/analyze";
const FETCH_TIMEOUT_MS = 180_000; // 3 minute timeout for the full request

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "ANALYZE_CONVERSATION") return false;

  analyzeConversation(
    message.conversation,
    message.previous_stands || [],
    message.skip_turns || 0
  )
    .then((result) => {
      try { sendResponse({ ok: true, data: result }); } catch { /* port closed */ }
    })
    .catch((err) => {
      console.error("[SYA service_worker] fetch failed:", err.message || err.name || String(err));
      const errorType = err.name === "AbortError" ? "timeout" : "backend_offline";
      try { sendResponse({ ok: false, error: errorType }); } catch { /* port closed */ }
    });

  // Return true to keep the message channel open for async sendResponse
  return true;
});

async function analyzeConversation(conversation, previousStands, skipTurns) {
  // Read provider config from storage, fallback to anthropic defaults if none saved
  const storage = await chrome.storage.local.get(["sya_provider"]);
  const providerConfig = storage.sya_provider || {
    type: "anthropic",
    base_url: "https://api.anthropic.com/",
    api_key: "",
    model: "claude-3-5-sonnet-20241022",
  };

  // Strip the 'id' field which isn't part of the backend ProviderConfig model
  const { id, ...cleanProviderConfig } = providerConfig;

  // Abort controller: kills the fetch if the backend takes too long
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        conversation,
        provider: cleanProviderConfig,
        previous_stands: previousStands,
        skip_turns: skipTurns,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
