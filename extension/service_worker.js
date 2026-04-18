/**
 * service_worker.js
 * Receives conversation data from the content script,
 * POSTs to the backend /analyze endpoint, and returns the result.
 * Includes a fetch timeout and passes incremental analysis params.
 */

const BACKEND_URL = "http://localhost:8000/analyze";
// No client-side fetch timeout. The backend enforces its own per-call timeout
// (180s), and Chrome's MV3 service worker lifetime (5 min) acts as a natural
// upper bound. Using AbortController here caused spurious "signal is aborted"
// errors because Chrome kills the service worker before the timeout fires.

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
      // Chrome killing the worker mid-fetch surfaces as AbortError
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

  const response = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
}
