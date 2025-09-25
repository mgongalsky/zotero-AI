// src/utils/llmResponse.ts
// Normalize various OpenAI shapes to plain text for the UI.

export type Normalized = {
  text: string;
  source:
    | "responses.output_text"
    | "responses.output.content.text"
    | "chat.choices.message"
    | "chat.choices.text"
    | "string"
    | "json-stringify"
    | "unknown";
};

function joinTextParts(parts: any[]): string {
  return parts
    .map((p) => {
      if (!p) return "";
      if (typeof p === "string") return p;
      // Responses API uses { type: "text", text: string }
      if (typeof p.text === "string") return p.text;
      if (typeof p.value === "string") return p.value;
      return "";
    })
    .filter(Boolean)
    .join("");
}

export function normalizeLLMResponse(raw: unknown): Normalized {
  // If caller accidentally passed "[object Object]" as a string,
  // we cannot JSON.parse it. Show something human-readable.
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    // Try to parse if it looks like JSON
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return normalizeLLMResponse(JSON.parse(trimmed));
      } catch {
        /* fall through */
      }
    }
    return { text: trimmed, source: "string" };
  }

  if (raw && typeof raw === "object") {
    const obj: any = raw;

    // 1) OpenAI Responses API (preferred)
    // a) direct `output_text`
    if (typeof obj.output_text === "string" && obj.output_text.trim()) {
      return { text: obj.output_text, source: "responses.output_text" };
    }

    // b) `output` array -> message -> content[] with {type:"text", text}
    if (Array.isArray(obj.output) && obj.output.length) {
      // usually the last message is assistant
      const last = obj.output[obj.output.length - 1];
      const content = last?.content;
      if (Array.isArray(content)) {
        const text = joinTextParts(content);
        if (text) return { text, source: "responses.output.content.text" };
      }
    }

    // 2) Chat Completions fallback
    // a) choices[0].message.content
    const choice0 = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
    if (choice0?.message?.content) {
      return { text: String(choice0.message.content), source: "chat.choices.message" };
    }
    // b) older: choices[0].text
    if (choice0?.text) {
      return { text: String(choice0.text), source: "chat.choices.text" };
    }

    // Nothing matched — stringify the JSON for visibility
    return { text: JSON.stringify(obj, null, 2), source: "json-stringify" };
  }

  return { text: String(raw ?? ""), source: "unknown" };
}
