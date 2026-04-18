/**
 * content_script.js
 * - Watches ChatGPT's DOM for completed assistant turns
 * - Waits for streaming to actually finish before triggering analysis
 * - Uses incremental analysis — only sends new turns to the backend
 * - Shows loading / error badges so the user knows what's happening
 * - Detects chat navigation (SPA URL changes) and resets state
 * - Runs initial analysis on page load for existing messages
 * - Applies red warning badge and SYPR-cleaned text to assistant messages
 * - In dev mode: renders a collapsible panel per turn showing LLM reasoning
 */

const PROCESSED_ATTR = "data-sya-processed";
const BADGE_CLASS = "sya-warning-badge";
const DEV_PANEL_CLASS = "sya-dev-panel";
const LOADING_CLASS = "sya-loading-badge";
const ERROR_CLASS = "sya-error-badge";

// ── Incremental analysis state ────────────────────────────────────────────────

let _analyzedAssistantCount = 0;
let _previousStands = [];
let _cachedResults = [];
let _conversationId = null;
let _isAnalyzing = false;

// Stores the last full analysis result so dev panels can be rebuilt on toggle
let _lastTurns = [];
let _lastAssistantEls = [];

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById("sya-styles")) return;
    const style = document.createElement("style");
    style.id = "sya-styles";
    style.textContent = `
    .${BADGE_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #dc2626;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 8px;
      letter-spacing: 0.02em;
    }

    .sya-cleaned-text {
      opacity: 0.88;
    }

    .${LOADING_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1e1b4b;
      color: #a5b4fc;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 8px;
      animation: sya-pulse 1.5s ease-in-out infinite;
    }

    @keyframes sya-pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }

    .${ERROR_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #44403c;
      color: #fdba74;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 8px;
    }

    /* ── Dev panel ── */
    .${DEV_PANEL_CLASS} {
      margin-top: 10px;
      border: 1px solid #3b3b4f;
      border-radius: 8px;
      background: #12121a;
      font-size: 12px;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
      overflow: hidden;
    }

    .sya-dev-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      background: #1c1c2e;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid #3b3b4f;
    }

    .sya-dev-header:hover {
      background: #22223a;
    }

    .sya-dev-title {
      font-size: 11px;
      font-weight: 700;
      color: #7c3aed;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .sya-dev-chevron {
      font-size: 10px;
      color: #555;
      transition: transform 0.2s;
    }

    .sya-dev-chevron.open {
      transform: rotate(180deg);
    }

    .sya-dev-body {
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sya-dev-body.collapsed {
      display: none;
    }

    .sya-dev-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      margin-bottom: 4px;
    }

    .sya-dev-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .sya-dev-pill.clean  { background: #052e16; color: #4ade80; }
    .sya-dev-pill.flagged { background: #450a0a; color: #f87171; }
    .sya-dev-pill.yes    { background: #1e3a5f; color: #60a5fa; }
    .sya-dev-pill.no     { background: #1f1f1f; color: #6b7280; }

    .sya-dev-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .sya-dev-list li {
      color: #a5b4fc;
      padding-left: 10px;
      position: relative;
      line-height: 1.5;
    }

    .sya-dev-list li::before {
      content: "·";
      position: absolute;
      left: 0;
      color: #4b4b6e;
    }

    .sya-dev-list.changed li { color: #fbbf24; }
    .sya-dev-list.empty  li { color: #4b4b6e; font-style: italic; }

    .sya-dev-reason {
      color: #d1d5db;
      line-height: 1.6;
      border-left: 2px solid #3b3b4f;
      padding-left: 8px;
    }

    .sya-sypr-diff {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .sya-sypr-removed {
      color: #f87171;
      text-decoration: line-through;
      opacity: 0.75;
    }

    .sya-sypr-kept {
      color: #4ade80;
    }

    .sya-sypr-none {
      color: #4b4b6e;
      font-style: italic;
    }
  `;
    document.head.appendChild(style);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getAssistantElements() {
    return Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
    );
}

function extractTextContent(el) {
    // ChatGPT renders message prose inside a div with class "markdown" / "prose".
    // Targeting it avoids grabbing button labels, copy icons, timestamps, etc.
    const proseEl =
        el.querySelector(".markdown.prose") ||
        el.querySelector('[class*="markdown"]') ||
        el.querySelector('[class*="prose"]') ||
        el; // fallback: full container

    const clone = proseEl.cloneNode(true);
    // Remove code blocks so they don't pollute stand extraction
    clone.querySelectorAll("pre, code").forEach((c) => c.remove());
    const text = clone.textContent.trim();
    return text;
}

function buildConversation() {
    const allMessages = Array.from(
        document.querySelectorAll(
            '[data-message-author-role="user"], [data-message-author-role="assistant"]'
        )
    );
    return allMessages.map((el) => ({
        role: el.getAttribute("data-message-author-role"),
        content: extractTextContent(el),
    }));
}

// ── Chat change detection ─────────────────────────────────────────────────────

function getConversationId() {
    // ChatGPT URLs: chatgpt.com/c/<id> or chatgpt.com (new chat)
    const match = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
    return match ? match[1] : "__new__";
}

function resetAnalysisCache() {
    console.debug("[SYA] Resetting analysis cache");
    _analyzedAssistantCount = 0;
    _previousStands = [];
    _cachedResults = [];
    _lastTurns = [];
    _lastAssistantEls = [];
    _isAnalyzing = false;

    // Remove all SYA UI elements from the page
    document.querySelectorAll(
        `.${BADGE_CLASS}, .${DEV_PANEL_CLASS}, .${LOADING_CLASS}, .${ERROR_CLASS}`
    ).forEach((el) => el.remove());
}

// ── Streaming detection ───────────────────────────────────────────────────────
// Instead of a fixed debounce, we poll the last assistant message's text
// until it stabilizes. This handles variable streaming speeds gracefully.

function waitForStreamingComplete() {
    return new Promise((resolve) => {
        const assistantEls = getAssistantElements();
        if (!assistantEls.length) { resolve(); return; }

        const lastEl = assistantEls[assistantEls.length - 1];
        let lastText = "";
        let stableCount = 0;
        const STABLE_THRESHOLD = 3;   // 3 consecutive checks with no change
        const CHECK_MS = 500;
        const MAX_WAIT_MS = 30_000;   // 30s max wait, then proceed anyway
        let elapsed = 0;

        const check = () => {
            const currentText = lastEl.textContent || "";
            if (currentText === lastText && currentText.length > 0) {
                stableCount++;
                if (stableCount >= STABLE_THRESHOLD) {
                    console.debug("[SYA] Streaming complete (text stabilized)");
                    resolve();
                    return;
                }
            } else {
                stableCount = 0;
                lastText = currentText;
            }

            elapsed += CHECK_MS;
            if (elapsed >= MAX_WAIT_MS) {
                console.debug("[SYA] Streaming wait timed out, proceeding");
                resolve();
                return;
            }

            setTimeout(check, CHECK_MS);
        };

        setTimeout(check, CHECK_MS);
    });
}

// ── Loading / Error badges ────────────────────────────────────────────────────

function showLoadingBadge() {
    const assistantEls = getAssistantElements();
    if (!assistantEls.length) return;
    const lastEl = assistantEls[assistantEls.length - 1];

    if (lastEl.querySelector(`.${LOADING_CLASS}`)) return;

    const badge = document.createElement("div");
    badge.className = LOADING_CLASS;
    badge.textContent = "⏳ Analyzing for sycophancy…";
    lastEl.insertBefore(badge, lastEl.firstChild);
}

function clearLoadingBadges() {
    document.querySelectorAll(`.${LOADING_CLASS}`).forEach((el) => el.remove());
}

function showErrorBadge(message) {
    clearLoadingBadges();
    const assistantEls = getAssistantElements();
    if (!assistantEls.length) return;
    const lastEl = assistantEls[assistantEls.length - 1];

    if (lastEl.querySelector(`.${ERROR_CLASS}`)) return;

    const badge = document.createElement("div");
    badge.className = ERROR_CLASS;
    badge.textContent = `⚠ ${message}`;
    lastEl.insertBefore(badge, lastEl.firstChild);

    // Auto-remove after 10s
    setTimeout(() => badge.remove(), 10_000);
}

// ── SYA Warning Badge ─────────────────────────────────────────────────────────

function applyBadge(assistantEl) {
    if (assistantEl.querySelector(`.${BADGE_CLASS}`)) return;
    const badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.textContent = "⚠ SYA Detected — position changed without new evidence";
    assistantEl.insertBefore(badge, assistantEl.firstChild);
}

// ── SYPR text replacement ─────────────────────────────────────────────────────

function applyCleanedText(assistantEl, cleanedMessage) {
    // Skip if already cleaned (idempotent)
    if (assistantEl.querySelector(".sya-cleaned-text")) return;

    const codeBlocks = Array.from(assistantEl.querySelectorAll("pre"));
    const devPanel = assistantEl.querySelector(`.${DEV_PANEL_CLASS}`);

    const wrapper = document.createElement("div");
    wrapper.className = "sya-cleaned-text";
    wrapper.textContent = cleanedMessage;

    while (assistantEl.firstChild) assistantEl.removeChild(assistantEl.firstChild);

    assistantEl.appendChild(wrapper);
    codeBlocks.forEach((cb) => assistantEl.appendChild(cb));
    if (devPanel) assistantEl.appendChild(devPanel);
}

// ── Dev panel ─────────────────────────────────────────────────────────────────

function buildDevPanel(turn) {
    const panel = document.createElement("div");
    panel.className = DEV_PANEL_CLASS;

    // ── Header (click to expand/collapse)
    const header = document.createElement("div");
    header.className = "sya-dev-header";

    const title = document.createElement("span");
    title.className = "sya-dev-title";
    title.textContent = "🛠 SYA Dev Panel";

    const chevron = document.createElement("span");
    chevron.className = "sya-dev-chevron";
    chevron.textContent = "▾";

    header.appendChild(title);
    header.appendChild(chevron);

    // ── Body
    const body = document.createElement("div");
    body.className = "sya-dev-body collapsed"; // collapsed by default

    header.addEventListener("click", () => {
        const isCollapsed = body.classList.toggle("collapsed");
        chevron.classList.toggle("open", !isCollapsed);
    });

    // Section: SYA Verdict
    body.appendChild(buildSection("Verdict", () => {
        const pill = document.createElement("span");
        pill.className = `sya-dev-pill ${turn.sya_detected ? "flagged" : "clean"}`;
        pill.textContent = turn.sya_detected ? "⚠ SYA Detected" : "✓ Clean";
        return pill;
    }));

    // Section: Reason
    if (turn.reason) {
        body.appendChild(buildSection("Model A Reason", () => {
            const p = document.createElement("div");
            p.className = "sya-dev-reason";
            p.textContent = turn.reason;
            return p;
        }));
    }

    // Section: Changed stands
    if (turn.changed_stands?.length) {
        body.appendChild(buildSection("Changed Stands", () =>
            buildList(turn.changed_stands, "changed")
        ));
    }

    // Section: Extracted stands (Model B output)
    body.appendChild(buildSection("Extracted Stands (Model B)", () => {
        if (!turn.current_stands?.length) {
            return buildList(["(none extracted)"], "empty");
        }
        return buildList(turn.current_stands);
    }));

    // Section: New info from preceding user message
    body.appendChild(buildSection("New Info From User", () => {
        const pill = document.createElement("span");
        pill.className = `sya-dev-pill ${turn.new_info_introduced ? "yes" : "no"}`;
        pill.textContent = turn.new_info_introduced ? "Yes — position change allowed" : "No — change would be sycophantic";
        return pill;
    }));

    // Section: SYPR diff
    body.appendChild(buildSection("SYPR Opener Strip", () => {
        const container = document.createElement("div");
        container.className = "sya-sypr-diff";

        const original = turn.assistant_message || "";
        const cleaned = turn.cleaned_message || "";

        if (original === cleaned) {
            const none = document.createElement("span");
            none.className = "sya-sypr-none";
            none.textContent = "(no opener stripped)";
            container.appendChild(none);
        } else {
            // Show what was removed (the opener prefix)
            const strippedPart = original.slice(0, original.length - cleaned.length).trim();
            if (strippedPart) {
                const removed = document.createElement("div");
                removed.className = "sya-sypr-removed";
                removed.textContent = `− ${strippedPart}`;
                container.appendChild(removed);
            }
            const kept = document.createElement("div");
            kept.className = "sya-sypr-kept";
            kept.textContent = `+ ${cleaned.slice(0, 120)}${cleaned.length > 120 ? "…" : ""}`;
            container.appendChild(kept);
        }
        return container;
    }));

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
}

function buildSection(label, contentFn) {
    const section = document.createElement("div");
    const title = document.createElement("div");
    title.className = "sya-dev-section-title";
    title.textContent = label;
    section.appendChild(title);
    section.appendChild(contentFn());
    return section;
}

function buildList(items, extraClass = "") {
    const ul = document.createElement("ul");
    ul.className = `sya-dev-list ${extraClass}`;
    items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
    });
    return ul;
}

// ── Apply full analysis results ───────────────────────────────────────────────

async function isEnabled() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["sya_enabled"], (r) => resolve(r.sya_enabled !== false));
    });
}

async function isDevMode() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["sya_devmode"], (r) => resolve(r.sya_devmode === true));
    });
}

function applyResults(data, devmode) {
    if (!data?.turns) return;

    const assistantEls = getAssistantElements();

    _lastTurns = data.turns;
    _lastAssistantEls = assistantEls;

    data.turns.forEach((turn, i) => {
        const el = assistantEls[i];
        if (!el) return;

        if (turn.sya_detected) applyBadge(el);

        if (turn.cleaned_message && turn.cleaned_message !== turn.assistant_message) {
            applyCleanedText(el, turn.cleaned_message);
        }

        // Remove any existing dev panel before re-rendering
        el.querySelector(`.${DEV_PANEL_CLASS}`)?.remove();

        if (devmode) {
            el.appendChild(buildDevPanel(turn));
        }

        el.setAttribute(PROCESSED_ATTR, "true");
    });
}

function toggleDevPanels(devmode) {
    if (!_lastTurns.length) return;

    _lastAssistantEls.forEach((el, i) => {
        const turn = _lastTurns[i];
        if (!turn || !el) return;

        el.querySelector(`.${DEV_PANEL_CLASS}`)?.remove();

        if (devmode) {
            el.appendChild(buildDevPanel(turn));
        }
    });
}

// ── Core analysis flow ────────────────────────────────────────────────────────

async function runAnalysis() {
    const enabled = await isEnabled();
    if (!enabled) return;
    if (_isAnalyzing) return; // Prevent concurrent runs

    // Wait for the assistant to finish streaming before we read the DOM
    await waitForStreamingComplete();

    // Detect chat change via URL
    const currentChatId = getConversationId();
    if (currentChatId !== _conversationId) {
        resetAnalysisCache();
        _conversationId = currentChatId;
    }

    const devmode = await isDevMode();
    const conversation = buildConversation();
    if (!conversation.length) return;

    // Count current assistant messages
    const currentAssistantCount = conversation.filter((m) => m.role === "assistant").length;
    if (currentAssistantCount <= _analyzedAssistantCount) return; // Nothing new

    _isAnalyzing = true;
    showLoadingBadge();

    chrome.runtime.sendMessage(
        {
            type: "ANALYZE_CONVERSATION",
            conversation,
            previous_stands: _previousStands,
            skip_turns: _analyzedAssistantCount,
        },
        (response) => {
            _isAnalyzing = false;
            clearLoadingBadges();

            if (chrome.runtime.lastError) {
                console.warn("[SYA] runtime error:", chrome.runtime.lastError.message);
                showErrorBadge("Extension error — check console");
                return;
            }
            if (!response?.ok) {
                const msg = response?.error === "timeout"
                    ? "Analysis timed out"
                    : response?.error === "backend_offline"
                    ? "Backend offline — is the server running?"
                    : "Analysis failed";
                showErrorBadge(msg);
                return;
            }

            // Merge new results with cached ones
            const newTurns = response.data?.turns || [];
            _cachedResults = [..._cachedResults, ...newTurns];

            // Update incremental state
            if (newTurns.length > 0) {
                const lastNewTurn = newTurns[newTurns.length - 1];
                _previousStands = lastNewTurn.current_stands || [];
            }
            _analyzedAssistantCount = currentAssistantCount;

            // Apply ALL results (cached + new) to the DOM
            applyResults({ turns: _cachedResults }, devmode);
        }
    );
}

// ── Listen for devmode toggle from popup ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DEVMODE_CHANGED") {
        toggleDevPanels(message.devmode);
    }
});

// ── MutationObserver ──────────────────────────────────────────────────────────

let debounceTimer = null;

function scheduleAnalysis() {
    clearTimeout(debounceTimer);
    // Short debounce — streaming detection handles the real waiting
    debounceTimer = setTimeout(runAnalysis, 800);
}

function startObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const isAssistant =
                    node.matches?.('[data-message-author-role="assistant"]') ||
                    node.querySelector?.('[data-message-author-role="assistant"]');
                if (isAssistant) { scheduleAnalysis(); return; }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ── URL change detection (SPA navigation) ─────────────────────────────────────
// ChatGPT is a SPA — clicking to a different chat changes the URL without
// a full page reload. We need to detect this and reset analysis state.

function watchUrlChanges() {
    let lastUrl = location.href;
    const check = () => {
        if (location.href !== lastUrl) {
            console.debug("[SYA] Chat navigation detected:", location.href);
            lastUrl = location.href;
            resetAnalysisCache();
            _conversationId = getConversationId();
            // Delay to let the new chat's DOM populate
            setTimeout(runAnalysis, 2500);
        }
    };
    window.addEventListener("popstate", check);
    setInterval(check, 1000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

injectStyles();
startObserver();
watchUrlChanges();

// Initial analysis for messages already in the DOM (page load / direct URL)
_conversationId = getConversationId();
setTimeout(runAnalysis, 2500);
