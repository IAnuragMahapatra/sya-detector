/**
 * popup.js
 * Manages the on/off toggle for SYA detection.
 * State persisted in chrome.storage.local.
 */

const toggle = document.getElementById("toggle");
const statusText = document.getElementById("status-text");

function updateStatusText(enabled) {
    statusText.textContent = enabled ? "Active on chatgpt.com" : "Paused";
    statusText.style.color = enabled ? "#e53e3e" : "#555";
}

// Load saved state on popup open
chrome.storage.local.get(["sya_enabled"], (result) => {
    const enabled = result.sya_enabled !== false; // default: on
    toggle.checked = enabled;
    updateStatusText(enabled);
});

// Save state on toggle change
toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ sya_enabled: enabled });
    updateStatusText(enabled);
});
