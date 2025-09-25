import { log, warn, error } from "./logger";

/** ---- Types ---- */

type InputFile = {
  /** Base64 string (no data: prefix), already prepared by caller */
  file_data: string;
  filename: string;
  //mime_type: string; // e.g., "application/pdf"
};

type CallOptions = {
  model?: string;
  systemPrompt?: string;
  max_output_tokens?: number;
  top_p?: number;
  store?: boolean;
  reasoning?: Record<string, unknown>;
  text?: Record<string, unknown>;
  tools?: any[];
};

/** ---- Internals ---- */

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_SYSTEM_PROMPT =
  "You are a scientific literature assistant. When answering, cite exact page numbers in parentheses (e.g., p. 3) whenever you rely on the PDF content.";

/**
 * Low-level sender to OpenAI Responses API.
 * Returns parsed JSON when possible; raw text otherwise.
 */
async function sendResponsesRequest(
  body: any,
  apiKey: string,
  meta: Record<string, unknown>
): Promise<any> {
  const t0 = Date.now();

  log("openai.send.enter", {
    model: body?.model,
    ...meta,
  });

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`, // logger must never dump this
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    error("openai.fetch.throw", { message: String(netErr) });
    throw netErr;
  }

  const rawText = await res.text().catch(() => "");
  const bytesHeader =
    Number(res.headers.get("content-length") || "0") || undefined;

  log("openai.responseMeta", {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    bytesHeader,
    textLen: rawText.length,
  });
  log("openai.body.peek", { first1000: rawText.slice(0, 1000) });

  if (!res.ok) {
    // Try to surface structured OpenAI error message
    try {
      const errJson = rawText ? JSON.parse(rawText) : {};
      const msg =
        errJson?.error?.message ??
        errJson?.message ??
        `HTTP ${res.status} ${res.statusText}`;
      error("openai.response.notOk", {
        status: res.status,
        message: msg,
        rawPeek: rawText.slice(0, 300),
      });
      throw new Error(msg);
    } catch {
      error("openai.response.notOk.unparsed", {
        status: res.status,
        statusText: res.statusText,
        rawPeek: rawText.slice(0, 300),
      });
      throw new Error(
        `OpenAI HTTP ${res.status}: ${res.statusText} :: ${rawText.slice(
          0,
          500
        )}`
      );
    }
  }

  try {
    const json = rawText ? JSON.parse(rawText) : {};
    const topKeys =
      json && typeof json === "object" ? Object.keys(json).slice(0, 20) : [];
    log("openai.parsed.ok", { topKeys, ms: Date.now() - t0 });
    return json;
  } catch (parseErr: any) {
    warn("openai.json.parseError", {
      message: parseErr?.message || String(parseErr),
      rawSnippet: rawText.slice(0, 300),
    });
    log("openai.parsed.fallback", { ms: Date.now() - t0 });
    return rawText;
  }
}

/** Build Responses API input with optional system + user text + files */
function buildInput(
  userText: string,
  systemText?: string,
  files?: InputFile[]
) {
  const contentBlocks: any[] = [{ type: "input_text", text: userText }];

  if (Array.isArray(files) && files.length) {
    for (const f of files) {
      if (!f?.file_data || !f?.filename) {
        warn("openai.inputFile.skipped.invalid", {
          hasData: !!f?.file_data,
          filename: f?.filename,
          //mime: f?.mime_type,
        });
        continue;
      }
      contentBlocks.push({
        type: "input_file",
        filename: f.filename,
        //mime_type: f.mime_type,
        file_data: f.file_data, // base64 (no data: prefix)
      });
    }
  }

  const input: any[] = [];

  if (systemText && systemText.trim()) {
    input.push({
      role: "system",
      content: [{ type: "input_text", text: systemText }],
    });
  }

  input.push({
    role: "user",
    content: contentBlocks,
  });

  return input;
}

/** ---- Public API: Text-only (kept for backward compatibility) ---- */

/**
 * Call OpenAI Responses API and return the **raw provider payload** (object when possible).
 * Falls back to returning raw text if JSON parsing fails.
 */
export async function callOpenAI(
  userText: string,
  apiKey: string
): Promise<any> {
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

  const body = {
    model: DEFAULT_MODEL,
    input: buildInput(
      textToSend,
      "You are scientific literature assistant. Summarize the given abstract for a general audience."
    ),
    text: {},
    reasoning: {},
    tools: [],
    max_output_tokens: 2048,
    top_p: 1,
    store: false,
  };

  log("callOpenAI.request", {
    url: OPENAI_URL,
    model: body.model,
    promptFirst80: textToSend.slice(0, 80),
  });

  const json = await sendResponsesRequest(body, apiKey, {
    mode: "text-only",
  });
  log("callOpenAI.exit", { ms: Date.now() - t0, returned: typeof json });
  return json;
}

/** ---- Public API: Text + embedded files (PDF, etc.) ---- */

/**
 * Call OpenAI with one or more embedded files (e.g., PDFs) alongside the prompt.
 * `files` must already contain base64 data (without `data:` prefix).
 */
export async function callOpenAIWithFiles(
  userText: string,
  files: InputFile[],
  apiKey: string,
  opts: CallOptions = {}
): Promise<any> {
  const t0 = Date.now();
  const promptLen = (userText ?? "").length;

  log("callOpenAIWithFiles.enter", {
    promptLen,
    filesCount: files?.length || 0,
    model: opts.model || DEFAULT_MODEL,
  });

  if (!apiKey) {
    const e = new Error("Missing OpenAI API key");
    error("callOpenAIWithFiles.missingKey", { message: e.message });
    throw e;
  }

  const textToSend = String(userText ?? "").trim();
  if (!textToSend) {
    const e = new Error("Prompt is empty");
    error("callOpenAIWithFiles.emptyPrompt");
    throw e;
  }

  // Light validation & telemetry on files
  if (!Array.isArray(files) || files.length === 0) {
    warn("callOpenAIWithFiles.noFiles", {});
  } else {
    for (const f of files) {
      log("callOpenAIWithFiles.file", {
        filename: f?.filename,
        //mime: f?.mime_type,
        // DO NOT log base64 content; log only its length
        base64Len: f?.file_data ? f.file_data.length : 0,
      });
    }
  }

  const body = {
    model: opts.model || DEFAULT_MODEL,
    input: buildInput(
      textToSend,
      opts.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      files
    ),
    text: opts.text ?? {},
    reasoning: opts.reasoning ?? {},
    tools: opts.tools ?? [],
    max_output_tokens:
      typeof opts.max_output_tokens === "number" ? opts.max_output_tokens : 2048,
    top_p: typeof opts.top_p === "number" ? opts.top_p : 1,
    store: !!opts.store,
  };

  log("callOpenAIWithFiles.request", {
    url: OPENAI_URL,
    model: body.model,
    promptFirst80: textToSend.slice(0, 80),
    filesCount: files?.length || 0,
  });

  const json = await sendResponsesRequest(body, apiKey, { mode: "files" });
  log("callOpenAIWithFiles.exit", { ms: Date.now() - t0, returned: typeof json });
  return json;
}
