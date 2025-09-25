import { log, warn, error } from "./logger";

/**
 * Call OpenAI Responses API and return the **raw provider payload** (object when possible).
 * Falls back to returning raw text if JSON parsing fails.
 */
export async function callOpenAI(userText: string, apiKey: string): Promise<any> {
  const t0 = Date.now();
  const promptLen = (userText ?? "").length;
  log("callOpenAI.enter", { promptLen });

  if (!apiKey) {
    const e = new Error("Missing OpenAI API key");
    error("callOpenAI.missingKey", { message: e.message });
    throw e;
  }

  const textToSend = String(userText ?? "").trim();
  if (!textToSend) {
    const e = new Error("Prompt is empty");
    error("callOpenAI.emptyPrompt");
    throw e;
  }

  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: "gpt-5-chat-latest",
    // Keep using Responses API "input" array
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are scientific literature assistant. Summarize the given abstract for a general audience.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: textToSend }],
      },
    ],
    text: {},
    reasoning: {},
    tools: [],
    temperature: 1,
    max_output_tokens: 2048,
    top_p: 1,
    store: false,
  };

  log("callOpenAI.request", {
    url,
    model: body.model,
    promptFirst80: textToSend.slice(0, 80),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // redact happens in logger; still avoid logging the raw value anywhere
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    error("callOpenAI.fetch.throw", { message: String(netErr) });
    throw netErr;
  }

  // Read as text first so we can always log a safe peek
  const rawText = await res.text().catch(() => "");
  const bytesHeader = Number(res.headers.get("content-length") || "0") || undefined;

  log("callOpenAI.responseMeta", {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    bytesHeader,
    textLen: rawText.length,
  });
  log("callOpenAI.bodyPeek", {
    first1000: rawText.slice(0, 1000),
  });

  if (!res.ok) {
    // Try to surface structured OpenAI error message
    try {
      const errJson = rawText ? JSON.parse(rawText) : {};
      const msg =
        errJson?.error?.message ??
        errJson?.message ??
        `HTTP ${res.status} ${res.statusText}`;
      error("callOpenAI.response.notOk", { status: res.status, message: msg, rawPeek: rawText.slice(0, 300) });
      throw new Error(msg);
    } catch {
      error("callOpenAI.response.notOk.unparsed", {
        status: res.status,
        statusText: res.statusText,
        rawPeek: rawText.slice(0, 300),
      });
      throw new Error(`OpenAI HTTP ${res.status}: ${res.statusText} :: ${rawText.slice(0, 500)}`);
    }
  }

  // Try JSON.parse; if it fails, we return the raw text
  try {
    const json = rawText ? JSON.parse(rawText) : {};
    const topKeys = json && typeof json === "object" ? Object.keys(json).slice(0, 20) : [];
    log("callOpenAI.parsed.ok", { topKeys });
    log("callOpenAI.exit", { ms: Date.now() - t0, returnedType: typeof json });
    return json; // IMPORTANT: return OBJECT (not coerced to string)
  } catch (parseErr: any) {
    warn("callOpenAI.json.parseError", {
      message: parseErr?.message || String(parseErr),
      rawSnippet: rawText.slice(0, 300),
    });
    log("callOpenAI.exit", { ms: Date.now() - t0, returnedType: "string" });
    return rawText; // Fallback so normalizeLLMResponse can still try
  }
}
