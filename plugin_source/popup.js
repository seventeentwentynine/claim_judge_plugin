

const $ = (id) => document.getElementById(id);

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function hasScriptingAPI() {
  return !!(browser.scripting && typeof browser.scripting.executeScript === "function");
}

async function getSelectionFromPage() {
  const tabId = await getActiveTabId();
  if (!tabId) return "";

  // Prefer MV3 scripting API, fall back to MV2 tabs.executeScript
  if (hasScriptingAPI()) {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection?.toString().trim() ?? "")
    });
    return results?.[0]?.result || "";
  } else {
    const results = await browser.tabs.executeScript(tabId, {
      code: '(window.getSelection ? window.getSelection().toString().trim() : "")'
    });
    return (results && results[0]) || "";
  }
}

function renderOutput(payload) {
  const out = $("output");
  out.hidden = false;

  if (!payload?.ok) {
    out.innerHTML = `<span class="error">Error:</span> ${payload?.error || "Unknown error"}`;
    return;
  }

  const badgeClass = (payload.label || "uncertain").toLowerCase();
  const safeReason = String(payload.reasoning || "").trim();

  out.innerHTML = `
    <div class="badge ${badgeClass}">${(payload.label || "").toUpperCase()}</div>
    <div style="margin-top:8px">${safeReason || "(no reasoning provided)"}</div>
  `;
}

async function analyze() {
  const provider = $("provider").value;
  const model = $("model").value.trim() || undefined;
  const sentence = $("text").value.trim();
  const speaker = $("speaker").value.trim();
  const context = $("context").value.trim();

  if (!sentence) {
    renderOutput({ ok: false, error: "Please provide some text to analyze." });
    return;
  }

  const resp = await browser.runtime.sendMessage({
    type: "analyzeSelection",
    provider,
    model,
    sentence,
    speaker,
    context
  });

  renderOutput(resp);
}

async function useCurrentSelection() {
  $("text").value = await getSelectionFromPage();
}

async function prefillFromBackgroundSelection() {
  try {
    const { selection } = await browser.runtime.sendMessage({ type: "getLastSelection" });
    if (selection && !$("text").value.trim()) $("text").value = selection;
  } catch { /* ignore */ }
}

document.addEventListener("DOMContentLoaded", async () => {
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });

  $("analyze").addEventListener("click", analyze);
  $("useSelection").addEventListener("click", useCurrentSelection);

  await prefillFromBackgroundSelection();

  if (!$("text").value.trim()) {
    const liveSel = await getSelectionFromPage();
    if (liveSel) $("text").value = liveSel;
  }
});
