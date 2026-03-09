/**
 * content_script.js
 * - Watches ChatGPT's DOM for completed assistant turns
 * - Extracts the full conversation
 * - Sends to service worker for SYA analysis
 * - Applies red warning badge and SYPR-cleaned text to assistant messages
 */

const BACKEND_ANALYZE_DELAY_MS = 1200; // wait for streaming to finish
const PROCESSED_ATTR = "data-sya-processed";
const BADGE_CLASS = "sya-warning-badge";

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
    .${BADGE_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ff3b3b;
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
  `;
    document.head.appendChild(style);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getAssistantElements() {
    return Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
    );
}

function getUserElements() {
    return Array.from(
        document.querySelectorAll('[data-message-author-role="user"]')
    );
}

/**
 * Extract text from a message element, leaving code blocks untouched.
 * We grab the raw textContent of non-code children.
 */
function extractTextContent(el) {
    // Clone to avoid mutating the real DOM
    const clone = el.cloneNode(true);
    // Remove code blocks from the clone so they don't pollute the stand extraction
    clone.querySelectorAll("pre, code").forEach((c) => c.remove());
    return clone.textContent.trim();
}

/**
 * Build the [{role, content}] conversation array from the current DOM.
 */
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

// ── Badge & text replacement ──────────────────────────────────────────────────

function applyBadge(assistantEl) {
    if (assistantEl.querySelector(`.${BADGE_CLASS}`)) return; // already has badge
    const badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.textContent = "⚠ SYA Detected — position changed without new evidence";
    assistantEl.insertBefore(badge, assistantEl.firstChild);
}

/**
 * Replace the visible text of an assistant message with the cleaned version.
 * We target the first prose paragraph-level container inside the message,
 * skipping code blocks.
 */
function applyCleanedText(assistantEl, cleanedMessage) {
    // Find all text-bearing children that are NOT code blocks
    const textNodes = Array.from(assistantEl.childNodes).filter(
        (n) =>
            n.nodeType === Node.TEXT_NODE ||
            (n.nodeType === Node.ELEMENT_NODE &&
                !["PRE", "CODE"].includes(n.tagName))
    );

    if (textNodes.length === 0) return;

    // Wrap the assistant message content in a span for styling
    const wrapper = document.createElement("div");
    wrapper.className = "sya-cleaned-text";
    wrapper.textContent = cleanedMessage;

    // Replace non-code content with the cleaned wrapper
    // Keep code blocks in place
    const codeBlocks = Array.from(
        assistantEl.querySelectorAll("pre")
    );

    // Clear existing non-code content
    while (assistantEl.firstChild) {
        assistantEl.removeChild(assistantEl.firstChild);
    }

    // Re-insert cleaned text first
    assistantEl.appendChild(wrapper);

    // Then re-append any code blocks
    codeBlocks.forEach((cb) => assistantEl.appendChild(cb));
}

// ── Core analysis flow ────────────────────────────────────────────────────────

async function isEnabled() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["sya_enabled"], (result) => {
            // Default to enabled if not set
            resolve(result.sya_enabled !== false);
        });
    });
}

async function runAnalysis() {
    const enabled = await isEnabled();
    if (!enabled) return;

    const conversation = buildConversation();
    if (conversation.length === 0) return;

    chrome.runtime.sendMessage(
        { type: "ANALYZE_CONVERSATION", conversation },
        (response) => {
            if (chrome.runtime.lastError) {
                console.warn("[SYA] runtime error:", chrome.runtime.lastError.message);
                return;
            }
            if (!response || !response.ok) {
                if (response?.error === "backend_offline") {
                    // Silent — backend not running, do nothing
                    return;
                }
                console.warn("[SYA] unexpected response:", response);
                return;
            }

            applyResults(response.data);
        }
    );
}

function applyResults(data) {
    if (!data || !data.turns) return;

    const assistantEls = getAssistantElements();

    data.turns.forEach((turn) => {
        const el = assistantEls[findAssistantIndex(turn.turn_index, data.turns)];
        if (!el) return;

        if (turn.sya_detected) {
            applyBadge(el);
        }

        if (turn.cleaned_message && turn.cleaned_message !== turn.assistant_message) {
            applyCleanedText(el, turn.cleaned_message);
        }

        el.setAttribute(PROCESSED_ATTR, "true");
    });
}

/**
 * Map a turn_index (index in full conversation) to an index into the
 * assistant-only NodeList. We count assistant messages up to turn_index.
 */
function findAssistantIndex(turnIndex, allTurns) {
    // allTurns are already assistant-only, ordered chronologically
    return allTurns.indexOf(allTurns.find((t) => t.turn_index === turnIndex));
}

// ── MutationObserver ──────────────────────────────────────────────────────────

let debounceTimer = null;

function scheduleAnalysis() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        runAnalysis();
    }, BACKEND_ANALYZE_DELAY_MS);
}

function startObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Check if a new assistant message appeared, or content was added inside one
                const isAssistant =
                    node.matches?.('[data-message-author-role="assistant"]') ||
                    node.querySelector?.('[data-message-author-role="assistant"]');

                if (isAssistant) {
                    scheduleAnalysis();
                    return;
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

injectStyles();
startObserver();
