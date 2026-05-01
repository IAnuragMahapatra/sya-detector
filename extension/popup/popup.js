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
    statusText.textContent = enabled ? "ONLINE" : "OFFLINE";
    if (enabled) {
        statusText.classList.add("active");
    } else {
        statusText.classList.remove("active");
    }
}

function updateDevmodeText(enabled) {
    devmodeStatusText.textContent = enabled ? "VISIBLE" : "HIDDEN";
    if (enabled) {
        devmodeStatusText.classList.add("dev-active");
    } else {
        devmodeStatusText.classList.remove("dev-active");
    }
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

    // Tell the active tab's content script to show/hide existing dev panels.
    // The callback suppresses "Could not establish connection" when the
    // content script isn't loaded (e.g., user is on a non-ChatGPT tab).
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: "DEVMODE_CHANGED",
                devmode,
            }, () => void chrome.runtime.lastError);
        }
    });
});

// ── Provider Settings ────────────────────────────────────────────────────────

const providerSelect = document.getElementById("provider-select");
const providerType = document.getElementById("provider-type");
const providerUrl = document.getElementById("provider-url");
const providerKey = document.getElementById("provider-key");
const providerModel = document.getElementById("provider-model");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

const groupType = document.getElementById("group-type");
const groupUrl = document.getElementById("group-url");

const PROVIDER_DEFAULTS = {
    anthropic: {
        type: "anthropic",
        base_url: "https://api.anthropic.com/",
        api_key: "",
        model: "claude-3-5-sonnet-20241022",
    },
    openai: {
        type: "openai",
        base_url: "https://api.openai.com/v1/",
        api_key: "",
        model: "gpt-4o",
    },
    ollama: {
        type: "openai", // Ollama uses OpenAI sdk compatibility
        base_url: "http://localhost:11434/v1/",
        api_key: "ollama",
        model: "llama3",
    },
    custom: {
        type: "openai",
        base_url: "",
        api_key: "",
        model: "",
    },
};

function updateUiForProvider(providerId) {
    if (providerId === "custom") {
        groupType.classList.remove("hidden");
        groupUrl.classList.remove("hidden");
    } else {
        groupType.classList.add("hidden");
        groupUrl.classList.add("hidden");
    }
}

function loadProviderConfig() {
    chrome.storage.local.get(["sya_provider"], (result) => {
        const config = result.sya_provider || Object.assign({ id: "anthropic" }, PROVIDER_DEFAULTS.anthropic);

        providerSelect.value = config.id || "anthropic";
        providerType.value = config.type || "anthropic";
        providerUrl.value = config.base_url || "";
        providerKey.value = config.api_key || "";
        providerModel.value = config.model || "";

        updateUiForProvider(config.id);
    });
}

providerSelect.addEventListener("change", (e) => {
    const id = e.target.value;
    updateUiForProvider(id);

    // Auto-fill defaults for known providers (except custom)
    if (id !== "custom") {
        const def = PROVIDER_DEFAULTS[id];
        providerType.value = def.type;
        providerUrl.value = def.base_url;
        providerKey.value = def.api_key;
        providerModel.value = def.model;
    }
});

btnSave.addEventListener("click", () => {
    const id = providerSelect.value;
    const isCustom = id === "custom";

    // For non-custom, force the correct system type and URL regardless of hidden inputs
    const def = isCustom ? null : PROVIDER_DEFAULTS[id];

    const config = {
        id: id,
        type: isCustom ? providerType.value : def.type,
        base_url: isCustom ? providerUrl.value : def.base_url,
        api_key: providerKey.value.trim(),
        model: providerModel.value.trim(),
    };

    // Basic validation
    if (!config.model) {
        saveStatus.textContent = "Model name is required.";
        saveStatus.style.color = "var(--ref-dev-base)";
        return;
    }
    if (isCustom && !config.base_url) {
        saveStatus.textContent = "Base URL is required for custom.";
        saveStatus.style.color = "var(--ref-dev-base)";
        return;
    }

    btnSave.textContent = "Saving...";
    chrome.storage.local.set({ sya_provider: config }, () => {
        setTimeout(() => {
            btnSave.textContent = "Save Settings";
            saveStatus.textContent = "✓ Settings saved!";
            saveStatus.style.color = "var(--ref-accent-base)";

            setTimeout(() => {
                saveStatus.textContent = "";
            }, 2500);
        }, 300);
    });
});

// Initialize form
loadProviderConfig();
