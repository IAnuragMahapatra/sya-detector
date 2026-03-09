/**
 * popup.js
 * Manages the on/off toggle (sya_enabled) and dev mode toggle (sya_devmode).
 * State persisted in chrome.storage.local.
 */

const toggle = document.getElementById("toggle");
const statusText = document.getElementById("status-text");
const devmodeToggle = document.getElementById("devmode-toggle");
const devmodeStatusText = document.getElementById("devmode-status-text");

function updateStatusText(enabled) {
    statusText.textContent = enabled ? "Active on chatgpt.com" : "Paused";
    statusText.style.color = enabled ? "#e53e3e" : "#555";
}

function updateDevmodeText(enabled) {
    devmodeStatusText.textContent = enabled
        ? "Panels visible on page"
        : "Shows LLM reasoning per turn";
    devmodeStatusText.style.color = enabled ? "#7c3aed" : "#555";
}

// Load saved state on popup open
chrome.storage.local.get(["sya_enabled", "sya_devmode"], (result) => {
    const enabled = result.sya_enabled !== false; // default: on
    const devmode = result.sya_devmode === true;  // default: off

    toggle.checked = enabled;
    updateStatusText(enabled);

    devmodeToggle.checked = devmode;
    updateDevmodeText(devmode);
});

// Save detection state on change
toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ sya_enabled: enabled });
    updateStatusText(enabled);
});

// Save dev mode state on change and notify content script immediately
devmodeToggle.addEventListener("change", () => {
    const devmode = devmodeToggle.checked;
    chrome.storage.local.set({ sya_devmode: devmode });
    updateDevmodeText(devmode);

    // Tell the active tab's content script to show/hide existing dev panels
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: "DEVMODE_CHANGED",
                devmode,
            });
        }
    });
});
