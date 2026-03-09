/**
 * content_script.js
 * - Watches ChatGPT's DOM for completed assistant turns
 * - Extracts the full conversation
 * - Sends to service worker for SYA analysis
 * - Applies red warning badge and SYPR-cleaned text to assistant messages
 * - In dev mode: renders a collapsible panel per turn showing LLM reasoning
 */

const BACKEND_ANALYZE_DELAY_MS = 1200;
const PROCESSED_ATTR = "data-sya-processed";
const BADGE_CLASS = "sya-warning-badge";
const DEV_PANEL_CLASS = "sya-dev-panel";

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
    console.debug("[SYA] extracted text preview:", text.slice(0, 120));
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

// ── Badge ─────────────────────────────────────────────────────────────────────

function applyBadge(assistantEl) {
    if (assistantEl.querySelector(`.${BADGE_CLASS}`)) return;
    const badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.textContent = "⚠ SYA Detected — position changed without new evidence";
    assistantEl.insertBefore(badge, assistantEl.firstChild);
}

// ── SYPR text replacement ─────────────────────────────────────────────────────

function applyCleanedText(assistantEl, cleanedMessage) {
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

    const assistantEls = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
    );

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

    const devmode = await isDevMode();
    const conversation = buildConversation();
    if (!conversation.length) return;

    chrome.runtime.sendMessage(
        { type: "ANALYZE_CONVERSATION", conversation },
        (response) => {
            if (chrome.runtime.lastError) {
                console.warn("[SYA] runtime error:", chrome.runtime.lastError.message);
                return;
            }
            if (!response?.ok) {
                if (response?.error === "backend_offline") return; // silent
                console.warn("[SYA] unexpected response:", response);
                return;
            }
            applyResults(response.data, devmode);
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
    debounceTimer = setTimeout(runAnalysis, BACKEND_ANALYZE_DELAY_MS);
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

// ── Init ──────────────────────────────────────────────────────────────────────

injectStyles();
startObserver();
