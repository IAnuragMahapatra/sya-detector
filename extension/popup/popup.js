/**
 * popup.js
 * Manages the UI state, toggles, and multi-step config for providers.
 */

// ── Views ──────────────────────────────────────────────────────────────────
const viewHome = document.getElementById("view-home");
const viewConfig = document.getElementById("view-config");
const btnGoConfig = document.getElementById("btn-go-config");
const btnGoHome = document.getElementById("btn-go-home");

btnGoConfig.addEventListener("click", () => {
    viewHome.classList.remove("active");
    viewConfig.classList.add("active");
});

btnGoHome.addEventListener("click", () => {
    viewConfig.classList.remove("active");
    viewHome.classList.add("active");
});


// ── Toggles ────────────────────────────────────────────────────────────────
const toggle = document.getElementById("toggle");
const statusText = document.getElementById("status-text");

const devmodeToggle = document.getElementById("devmode-toggle");
const devmodeStatusText = document.getElementById("devmode-status-text");

const syprToggle = document.getElementById("sypr-toggle");
const syprStatusText = document.getElementById("sypr-status-text");

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

function updateSyprText(enabled) {
    syprStatusText.textContent = enabled ? "STRIP PRAISE" : "PRAISE KEPT";
    if (enabled) {
        syprStatusText.classList.add("sypr-active");
    } else {
        syprStatusText.classList.remove("sypr-active");
    }
}

// Load saved state on popup open
chrome.storage.local.get(["sya_enabled", "sya_devmode", "sya_sypr_enabled"], (result) => {
    const enabled = result.sya_enabled !== false; // default: on
    const devmode = result.sya_devmode === true;  // default: off
    const sypr = result.sya_sypr_enabled !== false; // default: on

    toggle.checked = enabled;
    updateStatusText(enabled);

    devmodeToggle.checked = devmode;
    updateDevmodeText(devmode);

    syprToggle.checked = sypr;
    updateSyprText(sypr);
});

// Save detection state on change
toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ sya_enabled: enabled });
    updateStatusText(enabled);
});

// Save dev mode state on change
devmodeToggle.addEventListener("change", () => {
    const devmode = devmodeToggle.checked;
    chrome.storage.local.set({ sya_devmode: devmode });
    updateDevmodeText(devmode);

    // Notify content script immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: "DEVMODE_CHANGED",
                devmode,
            }, () => void chrome.runtime.lastError);
        }
    });
});

// Save SYPR state on change
syprToggle.addEventListener("change", () => {
    const sypr = syprToggle.checked;
    chrome.storage.local.set({ sya_sypr_enabled: sypr });
    updateSyprText(sypr);

    // Notify content script immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: "SYPR_CHANGED",
                sypr,
            }, () => void chrome.runtime.lastError);
        }
    });
});


// ── Provider Config ────────────────────────────────────────────────────────
const providerSelect = document.getElementById("provider-select");
const providerType = document.getElementById("provider-type");
const providerUrl = document.getElementById("provider-url");
const providerKey = document.getElementById("provider-key");

const groupType = document.getElementById("group-type");
const groupUrl = document.getElementById("group-url");
const groupKey = document.getElementById("group-key");

const btnSaveProvider = document.getElementById("btn-save-provider");
const providerStatus = document.getElementById("provider-status");

const modelSection = document.getElementById("model-section");
const providerModelSelect = document.getElementById("provider-model");
const providerModelFallback = document.getElementById("provider-model-fallback");
const btnSaveModel = document.getElementById("btn-save-model");
const modelStatus = document.getElementById("model-status");

let fetchedModels = [];

const PROVIDER_DEFAULTS = {
    anthropic: {
        type: "anthropic",
        base_url: "https://api.anthropic.com/v1/",
        api_key: "",
        model: "claude-3-5-sonnet-20241022",
    },
    openai: {
        type: "openai",
        base_url: "https://api.openai.com/v1/",
        api_key: "",
        model: "gpt-4o",
    },
    gemini: {
        type: "openai",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key: "",
        model: "gemini-1.5-pro",
    },
    ollama: {
        type: "openai",
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

    if (providerId === "ollama") {
        groupKey.classList.add("hidden");
    } else {
        groupKey.classList.remove("hidden");
    }
}

function loadProviderConfig() {
    chrome.storage.local.get(["sya_provider"], (result) => {
        const config = result.sya_provider || Object.assign({ id: "anthropic" }, PROVIDER_DEFAULTS.anthropic);

        providerSelect.value = config.id || "anthropic";
        providerType.value = config.type || "anthropic";
        providerUrl.value = config.base_url || "";
        providerKey.value = config.api_key || "";

        // If config model exists, set it
        updateUiForProvider(config.id);

        if (config.model) {
            // Treat as pre-configured
            enableModelSection(false);
            providerModelFallback.classList.remove("hidden");
            providerModelSelect.classList.add("hidden");
            providerModelFallback.value = config.model;
        }
    });
}

providerSelect.addEventListener("change", (e) => {
    const id = e.target.value;
    updateUiForProvider(id);

    // Auto-fill defaults for known providers
    if (id !== "custom") {
        const def = PROVIDER_DEFAULTS[id];
        providerType.value = def.type;
        providerUrl.value = def.base_url;
        providerKey.value = def.api_key;
    }

    // Reset model section
    modelSection.style.opacity = "0.5";
    modelSection.style.pointerEvents = "none";
    providerModelSelect.innerHTML = '<option value="">Awaiting connection...</option>';
    providerModelSelect.disabled = true;
    btnSaveModel.disabled = true;
});

function enableModelSection(fetchSuccess) {
    modelSection.style.opacity = "1";
    modelSection.style.pointerEvents = "auto";
    btnSaveModel.disabled = false;

    if (fetchSuccess) {
        providerModelSelect.disabled = false;
        providerModelSelect.classList.remove("hidden");
        providerModelFallback.classList.add("hidden");
    } else {
        providerModelSelect.disabled = true;
        providerModelSelect.classList.add("hidden");
        providerModelFallback.classList.remove("hidden");
    }
}

function getUrlAndType() {
    const id = providerSelect.value;
    const isCustom = id === "custom";
    const def = isCustom ? null : PROVIDER_DEFAULTS[id];

    return {
        type: isCustom ? providerType.value : def.type,
        base_url: isCustom ? providerUrl.value : def.base_url,
    };
}

// Connect & Fetch Models
btnSaveProvider.addEventListener("click", async () => {
    const id = providerSelect.value;
    const { type, base_url } = getUrlAndType();
    const apiKey = providerKey.value.trim();

    if (id === "custom" && !base_url) {
        providerStatus.textContent = "Base URL is required";
        providerStatus.style.color = "var(--ref-dev-base)";
        return;
    }

    if (id !== "ollama" && !apiKey) {
        providerStatus.textContent = "Access key required";
        providerStatus.style.color = "var(--ref-dev-base)";
        return;
    }

    providerStatus.textContent = "Connecting...";
    providerStatus.style.color = "var(--ref-text-secondary)";

    let url = base_url.endsWith('/') ? base_url + "models" : base_url + "/models";

    try {
        const headers = {};

        if (type === "anthropic") {
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";
        } else if (id !== "ollama" && apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const res = await fetch(url, { method: "GET", headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        let models = [];
        if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id);
        } else if (Array.isArray(data)) {
            models = data.map(m => m.id || m.name || m);
        } else {
            // Anthropic typically returns { type: 'list', data: [...] }
            if (data.type === 'list' && Array.isArray(data.data)) {
                models = data.data.map(m => m.id);
            } else {
                throw new Error("Unknown model format");
            }
        }

        fetchedModels = models.sort();

        if (fetchedModels.length > 0) {
            providerModelSelect.innerHTML = "";
            fetchedModels.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m;
                opt.textContent = m;
                providerModelSelect.appendChild(opt);
            });
            enableModelSection(true);
            providerStatus.textContent = `✓ Fetched ${fetchedModels.length} models`;
            providerStatus.style.color = "oklch(60% 0.15 150)";
        } else {
            throw new Error("No models returned");
        }

    } catch (err) {
        console.error("[Drift] Fetch models error:", err);
        providerStatus.textContent = "Auto-fetch failed. Enter manually.";
        providerStatus.style.color = "var(--ref-accent-base)";
        enableModelSection(false);
    }
});

// Commit Final Settings
btnSaveModel.addEventListener("click", () => {
    const id = providerSelect.value;
    const { type, base_url } = getUrlAndType();
    const apiKey = providerKey.value.trim();

    let selectedModel = "";
    if (!providerModelSelect.classList.contains("hidden")) {
        selectedModel = providerModelSelect.value;
    } else {
        selectedModel = providerModelFallback.value.trim();
    }

    if (!selectedModel) {
        modelStatus.textContent = "Model designation required.";
        modelStatus.style.color = "var(--ref-dev-base)";
        return;
    }

    const config = {
        id,
        type,
        base_url,
        api_key: (id === "ollama" && !apiKey) ? "ollama" : apiKey,
        model: selectedModel,
    };

    btnSaveModel.textContent = "Committing...";
    chrome.storage.local.set({ sya_provider: config }, () => {
        setTimeout(() => {
            btnSaveModel.textContent = "Commit Settings";
            modelStatus.textContent = "✓ Settings Saved!";
            modelStatus.style.color = "oklch(60% 0.15 150)";

            setTimeout(() => {
                modelStatus.textContent = "";
            }, 2500);
        }, 300);
    });
});

// Initialize form
loadProviderConfig();
