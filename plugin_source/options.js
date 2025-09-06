
(async function () {
  const $ = (id) => document.getElementById(id);
  const toast = (msg, cls = "") => {
    const t = $("toast");
    t.textContent = msg || "";
    t.className = cls;
    if (msg) setTimeout(() => { if (t.textContent === msg) t.textContent = ""; }, 2500);
  };

  // Lightweight client-side format checks (non-authoritative)
  function checkAnthropic(key) {
    if (!key) return { cls: "warn", msg: "Empty (will disable Anthropic)." };
    const ok = /^sk-ant-/.test(key.trim());
    return ok ? { cls: "ok", msg: "Looks valid (prefix)." }
              : { cls: "warn", msg: "Unusual format — Anthropic keys typically start with sk-ant-." };
  }
  function checkGemini(key) {
    if (!key) return { cls: "warn", msg: "Empty (will disable Gemini)." };
    const ok = /^AIza/.test(key.trim());
    return ok ? { cls: "ok", msg: "Looks valid (prefix)." }
              : { cls: "warn", msg: "Unusual format — many Google API keys start with AIza." };
  }
  function checkHFToken(key) {
    if (!key) return { cls: "warn", msg: "Optional — requests may work on public models." };
    const ok = /^hf_/.test(key.trim());
    return ok ? { cls: "ok", msg: "Looks valid (prefix)." }
              : { cls: "warn", msg: "Unusual format — HF tokens typically start with hf_." };
  }
  function checkHFModel(id) {
    if (!id) return { cls: "err", msg: "Required — e.g., maskitplugin/finetuned_roberta." };
    const ok = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(id.trim());
    return ok ? { cls: "ok", msg: "Model id looks well-formed." }
              : { cls: "warn", msg: "Model id should look like org-or-user/model-name." };
  }

  // Toggle password visibility
  function wireToggle(btnAttr) {
    const btns = document.querySelectorAll(`[data-toggle]`);
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-toggle");
        const el = $(id);
        if (!el) return;
        el.type = (el.type === "password") ? "text" : "password";
        btn.textContent = (el.type === "password") ? "Show" : "Hide";
        el.focus();
      });
    });
  }

  // Render status helper
  function renderStatus(elId, res) {
    const el = $(elId);
    if (!el) return;
    el.className = `status ${res.cls}`;
    el.textContent = res.msg;
  }

  // Load existing values
  const stored = await browser.storage.local.get([
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "HUGGINGFACE_API_KEY",
    "HF_MODEL_ID"
  ]);

  $("anthropic").value = stored.ANTHROPIC_API_KEY || "";
  $("gemini").value    = stored.GEMINI_API_KEY || "";
  $("hfKey").value     = stored.HUGGINGFACE_API_KEY || "";
  $("hfModel").value   = stored.HF_MODEL_ID || "maskitplugin/finetuned_roberta";

  // Initial statuses
  renderStatus("anthropicStatus", checkAnthropic($("anthropic").value));
  renderStatus("geminiStatus",    checkGemini($("gemini").value));
  renderStatus("hfKeyStatus",     checkHFToken($("hfKey").value));
  renderStatus("hfModelStatus",   checkHFModel($("hfModel").value));

  // Live validation
  $("anthropic").addEventListener("input", e => renderStatus("anthropicStatus", checkAnthropic(e.target.value)));
  $("gemini").addEventListener("input",    e => renderStatus("geminiStatus",    checkGemini(e.target.value)));
  $("hfKey").addEventListener("input",     e => renderStatus("hfKeyStatus",     checkHFToken(e.target.value)));
  $("hfModel").addEventListener("input",   e => renderStatus("hfModelStatus",   checkHFModel(e.target.value)));

  // Toggle show/hide
  wireToggle();

  // Clear individual fields
  $("clearAnthropic").addEventListener("click", () => {
    $("anthropic").value = "";
    renderStatus("anthropicStatus", checkAnthropic(""));
  });
  $("clearGemini").addEventListener("click", () => {
    $("gemini").value = "";
    renderStatus("geminiStatus", checkGemini(""));
  });
  $("clearHFKey").addEventListener("click", () => {
    $("hfKey").value = "";
    renderStatus("hfKeyStatus", checkHFToken(""));
  });
  $("clearHFModel").addEventListener("click", () => {
    $("hfModel").value = "maskitplugin/finetuned_roberta";
    renderStatus("hfModelStatus", checkHFModel($("hfModel").value));
  });

  // Save all
  $("save").addEventListener("click", async () => {
    const a = $("anthropic").value.trim();
    const g = $("gemini").value.trim();
    const hf = $("hfKey").value.trim();
    const model = $("hfModel").value.trim();

    await browser.storage.local.set({
      ANTHROPIC_API_KEY: a || null,
      GEMINI_API_KEY: g || null,
      HUGGINGFACE_API_KEY: hf || null,
      HF_MODEL_ID: model || "maskitplugin/finetuned_roberta"
    });

    // Re-render statuses (in case normalization changed anything)
    renderStatus("anthropicStatus", checkAnthropic(a));
    renderStatus("geminiStatus",    checkGemini(g));
    renderStatus("hfKeyStatus",     checkHFToken(hf));
    renderStatus("hfModelStatus",   checkHFModel(model));

    toast("Saved.");
  });

  // Clear all
  $("clearAll").addEventListener("click", async () => {
    $("anthropic").value = "";
    $("gemini").value = "";
    $("hfKey").value = "";
    $("hfModel").value = "maskitplugin/finetuned_roberta";

    await browser.storage.local.set({
      ANTHROPIC_API_KEY: null,
      GEMINI_API_KEY: null,
      HUGGINGFACE_API_KEY: null,
      HF_MODEL_ID: "maskitplugin/finetuned_roberta"
    });

    renderStatus("anthropicStatus", checkAnthropic(""));
    renderStatus("geminiStatus",    checkGemini(""));
    renderStatus("hfKeyStatus",     checkHFToken(""));
    renderStatus("hfModelStatus",   checkHFModel($("hfModel").value));

    toast("All fields cleared.");
  });
})();
