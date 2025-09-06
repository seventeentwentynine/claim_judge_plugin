const SYSTEM_PROMPT = `
You are a rigorous annotator for harmful information taxonomy. Read one sentence and the claim's metadata that includes date, place, and the speaker's name. Decide which label is appropriate and provide concise reasoning with credible citations.

Labeling (mutually exclusive):
- true: The sentence is factually correct as stated.
- uncertain: The sentence is too vague, satirical, or lacks enough context to determine its truth value, i.e., true or false.
- false: The sentence is factually incorrect.

Use web search when the claim might depend on current facts, specific statistics, or named entities. Prefer primary or authoritative sources. Include citations with URLs in reasoning.

Return only the fields "label" and "reasoning".
`.trim();

const SYSTEM_PROMPT_GEMINI = `
You are a rigorous annotator for harmful information taxonomy. Read one sentence and the claim's metadata that includes date, place, and the speaker's name. Decide which label is appropriate and provide concise reasoning with credible citations.

Labeling (mutually exclusive):
- true: The sentence is factually correct as stated.
- uncertain: The sentence is too vague, satirical, or lacks enough context to determine its truth value, i.e., true or false.
- false: The sentence is factually incorrect.

Use web search when the claim might depend on current facts, specific statistics, or named entities. Prefer primary or authoritative sources. Include citations with URLs in reasoning.

Return only the fields "label" and "reasoning" by formatting your response as JSON: {"label": "...", "reasoning": "..."}.
`.trim();

// Client tool we already had (model will emit this for the final structured result)
const TOOLS_CLIENT = [{
  name: "emit_judgment",
  description: "Return a single classification object for the input sentence.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string", enum: ["true", "uncertain", "false"] },
      reasoning: { type: "string" }
    },
    required: ["label", "reasoning"],
    additionalProperties: false
  }
}];


const ANTHROPIC_SERVER_TOOLS = [{
  type: "web_search_20250305", // Anthropic's built-in web search tool
  name: "web_search",
  max_uses: 3,
  // Optional localization (adjust if you prefer)
  user_location: {
    type: "approximate",
    timezone: "America/Vancouver"
  }
}];

// Store last selected text when used via context menu
let lastSelection = "";

// Context menu: right-click → “Judge selection…”
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "judge-selection",
    title: "Judge selection…",
    contexts: ["selection"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "judge-selection" && info.selectionText) {
    lastSelection = info.selectionText.trim();
    // Tell the user to click the toolbar button (popup); popup will prefill with this.
    browser.notifications.create({
      type: "basic",
      title: "Claim Judge",
      message: "Selection captured. Click the extension button to analyze."
    });
  }
});

// Helper: unify the per-provider request builder
function buildUserPrompt(sentence, speaker, context) {
  const fmt = (n, v) => `${n}: ${v && String(v).trim() ? String(v).trim() : "n/a"}`;
  const meta = [fmt("speaker", speaker), fmt("context", context)].join("\n");
  return `Classify the sentence per the system instructions.

sentence: "${sentence}"

metadata:
${meta}

Reply with JSON: {"label": "...", "reasoning": "..."}
`;
}

// ---- Anthropic (thinking + server-side web search) ----
async function callAnthropic({ apiKey, model, sentence, speaker, context }) {
  const url = "https://api.anthropic.com/v1/messages";

  const body = {
    // Updated default model (Claude Sonnet 4)
    model: model || "claude-sonnet-4-20250514",
    // model: model || "claude-3-7-sonnet-20250219",
    // Max must exceed thinking budget (thinking tokens count toward max_tokens)
    max_tokens: 2048,

    system: SYSTEM_PROMPT,

    // Enable Extended Thinking (budget >= 1024)
    thinking: { type: "enabled", budget_tokens: 1024 }, // docs show 'thinking' block with budget_tokens

    // Let Claude decide when to call tools (emit_judgment + web_search)
    tool_choice: { type: "auto" },

    // Client tool + Anthropic's server web search tool
    tools: [...TOOLS_CLIENT, ...ANTHROPIC_SERVER_TOOLS],

    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildUserPrompt(sentence, speaker, context) }]
      }
    ]
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      // Required when calling from browsers/extensions:
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${resp.status}: ${t}`);
  }

  const data = await resp.json();

  // Prefer tool_use named "emit_judgment"
  for (const block of data?.content ?? []) {
    if (block.type === "tool_use" && block.name === "emit_judgment") {
      const inp = block.input || {};
      if (inp.label && inp.reasoning) {
        return { label: String(inp.label), reasoning: String(inp.reasoning) };
      }
    }
  }

  // Fallback: plain-text JSON in assistant output
  const textParts = (data?.content || [])
    .filter(p => p.type === "text" && typeof p.text === "string")
    .map(p => p.text);
  for (const t of textParts) {
    try {
      const parsed = JSON.parse(t);
      if (parsed && parsed.label && parsed.reasoning) {
        return { label: String(parsed.label), reasoning: String(parsed.reasoning) };
      }
    } catch (_) { /* ignore */ }
  }

  throw new Error("Anthropic: No structured result found.");
}

// ---- Gemini (thinking + Google Search grounding) ----
async function callGemini({ apiKey, model, sentence, speaker, context }) {
  // Reasoning-forward default; you can switch to 2.5 Flash for latency
  const mdl = model || "gemini-2.5-pro";
  // const mdl = model || "gemini-2.5-flash"; // This might not send structured JSON back
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },

    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(sentence, speaker, context) }]
      }
    ],

    // Turn on thinking and Google Search grounding
    generationConfig: {
      // Thinking config (budget tokens). Set to -1 for dynamic, 0 to disable.
      thinkingConfig: {
        thinkingBudget: 1024
        // includeThoughts: false  // (omit to avoid returning thought summaries)
      },
      temperature: 0.3,
      topP: 1.0,
      maxOutputTokens: 2048
    },

    // Enable Google Search tool for grounding + citations
    tools: [
      { google_search: {} }
    ]
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status}: ${t}`);
  }

  const data = await resp.json();
  console.log("Gemini response:", data);
  // Try to parse {"label": "...", "reasoning": "..."} from the top candidate text
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const t = p?.text;
    if (typeof t === "string") {
      try {
        const parsed = JSON.parse(t);
        if (parsed && parsed.label && parsed.reasoning) {
          return { label: String(parsed.label), reasoning: String(parsed.reasoning) };
        }
      } catch (_) { /* continue */ }
    }
  }

  throw new Error("Gemini: No structured result found.");
}



// ---- Hugging Face (pipeline): labels only, no web search/thinking
async function callHuggingFace({ modelRepo, sentence }) {
 try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.1');
    const classifier = await pipeline('text-classification', modelRepo);
    const result = await classifier(sentence);
    console.log(result);
    const raw = result[0].label.toLowerCase();
    console.log("Label:", raw);

    let label = 'uncertain';
    if (raw.includes('label_0') || raw === 'false' || raw.includes('negative')) label = 'false';
    else if (raw.includes('label_1') || raw === 'true' || raw.includes('positive')) label = 'true';

  return { label, reasoning: "" }; // this provider doesn't return reasoning
}catch (err) {
  throw new Error(`HuggingFace error: ${err.message || err}`);
  }
}


browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type === "getLastSelection") {
    return { selection: lastSelection || "" };
  }

  if (msg?.type === "analyzeSelection") {
    const { provider, model, sentence, speaker, context } = msg;
    const keys = await browser.storage.local.get([
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "HUGGINGFACE_API_KEY",
      "HF_MODEL_ID"
    ]);

    try {
      if (provider === "anthropic") {
        if (!keys.ANTHROPIC_API_KEY) throw new Error("Missing Anthropic API key. Set it in Options.");
        const out = await callAnthropic({ apiKey: keys.ANTHROPIC_API_KEY, model, sentence, speaker, context });
        return { ok: true, ...out };

      } else if (provider === "gemini") {
        if (!keys.GEMINI_API_KEY) throw new Error("Missing Gemini API key. Set it in Options.");
        const out = await callGemini({ apiKey: keys.GEMINI_API_KEY, model, sentence, speaker, context });
        return { ok: true, ...out };

      } else if (provider === "huggingface") {
        const repo = (model && model.trim()) || keys.HF_MODEL_ID || "maskitplugin/finetuned_roberta";
        const out = await callHuggingFace({ modelRepo: repo, sentence });
        return { ok: true, ...out };

      }else {
        throw new Error("Unknown provider.");
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }
});

