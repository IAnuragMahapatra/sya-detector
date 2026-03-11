/**
 * service_worker.js
 * Receives conversation data from the content script,
 * POSTs to the backend /analyze endpoint, and returns the result.
 */

const BACKEND_URL = "http://localhost:8000/analyze";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "ANALYZE_CONVERSATION") return false;

  analyzeConversation(message.conversation)
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => {
      console.error("[SYA service_worker] fetch failed:", err);
      sendResponse({ ok: false, error: "backend_offline" });
    });

  // Return true to keep the message channel open for async sendResponse
  return true;
});

async function analyzeConversation(conversation) {
  // Read provider config from storage, fallback to anthropic defaults if none saved
  const storage = await chrome.storage.local.get(["sya_provider"]);
  const providerConfig = storage.sya_provider || {
    type: "anthropic",
    base_url: "https://api.anthropic.com",
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
      provider: cleanProviderConfig
    }),
  });

  if (!response.ok) {
    throw new Error(`Backend returned HTTP ${response.status}`);
  }

  return response.json();
}
