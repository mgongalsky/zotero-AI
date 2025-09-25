import { log, warn, error } from "./logger";

/**
 * Call OpenAI Responses API and return plain text.
 */
export async function callOpenAI(userText: string, apiKey: string): Promise<string> {
  const t0 = Date.now();
  log("callOpenAI.enter", { promptLen: (userText ?? "").length });

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

  log("callOpenAI.request", { url, model: body.model, promptFirst80: textToSend.slice(0, 80) });

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

  const rawText = await res.clone().text().catch(() => "");
  log("callOpenAI.responseMeta", {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    bytes: rawText.length,
  });

  if (!res.ok) {
    error("callOpenAI.response.notOk", {
      status: res.status,
      errSnippet: rawText.slice(0, 300),
    });
    throw new Error(`OpenAI HTTP ${res.status}: ${res.statusText} :: ${rawText.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch (parseErr) {
    error("callOpenAI.json.parseError", { parseErr: String(parseErr), rawSnippet: rawText.slice(0, 300) });
    throw parseErr;
  }

  const candidates = [
    json.output_text,
    json.text,
    json.output?.[0]?.content?.[0]?.text,
    json.choices?.[0]?.message?.content,
  ].filter(Boolean);

  const out = String(candidates[0] ?? "");
  log("callOpenAI.exit", { ms: Date.now() - t0, outLen: out.length });

  return out;
}
