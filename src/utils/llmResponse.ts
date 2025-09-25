// src/utils/llmResponse.ts
// Normalize various OpenAI shapes to plain text for the UI.

export type Normalized = {
  text: string;
  source:
    | "responses.output_text"
    | "responses.output_text[]"
    | "responses.output.assistant.content.text"
    | "responses.output.content.text"
    | "chat.choices.message"
    | "chat.choices.text"
    | "string"
    | "json-stringify"
    | "unknown";
};

/**
 * Универсальный сборщик текста из content-массивов Responses API.
 * Поддерживает блоки вида:
 *  - { type: "text" | "output_text", text: string }
 *  - { type: "tool_result", content: [...] } (рекурсивно)
 *  - { value: string } (редкие провайдеры)
 */
function joinTextParts(parts: any[]): string {
  const out: string[] = [];

  const pushMaybe = (s: unknown) => {
    if (typeof s === "string" && s.trim()) out.push(s);
  };

  const visit = (node: any) => {
    if (!node) return;

    // Прямой текст
    if (typeof node.text === "string") {
      pushMaybe(node.text);
      return;
    }
    // Нестандартное поле value
    if (typeof node.value === "string") {
      pushMaybe(node.value);
      return;
    }
    // Вложенные tool_result / или иные контейнеры с content[]
    if (Array.isArray(node.content)) {
      for (const c of node.content) visit(c);
      return;
    }
    // Прямо строка
    if (typeof node === "string") {
      pushMaybe(node);
      return;
    }
  };

  for (const p of parts) visit(p);

  return out.join("");
}

/** Находим последнее сообщение ассистента в output[] (Responses API) */
function findLastAssistantMessage(outputArr: any[]): any | null {
  if (!Array.isArray(outputArr) || !outputArr.length) return null;
  // Ищем с конца role === "assistant", иначе берём последний элемент
  for (let i = outputArr.length - 1; i >= 0; i--) {
    const msg = outputArr[i];
    if (msg && typeof msg === "object" && msg.role === "assistant") return msg;
  }
  return outputArr[outputArr.length - 1] ?? null;
}

export function normalizeLLMResponse(raw: unknown): Normalized {
  // Если пришла строка — возможно это JSON как строка
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
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

    // 1) OpenAI Responses API (предпочтительно)

    // a) direct `output_text`
    if (typeof obj.output_text === "string" && obj.output_text.trim()) {
      return { text: obj.output_text, source: "responses.output_text" };
    }
    // b) `output_text` как массив строк
    if (Array.isArray(obj.output_text) && obj.output_text.length) {
      const joined = obj.output_text
        .map((s: any) => (typeof s === "string" ? s : ""))
        .filter(Boolean)
        .join("\n\n");
      if (joined.trim()) {
        return { text: joined, source: "responses.output_text[]" };
      }
    }

    // c) `output[]` -> находим последнее сообщение ассистента -> content[]
    if (Array.isArray(obj.output) && obj.output.length) {
      const lastAssistant = findLastAssistantMessage(obj.output);
      const content = lastAssistant?.content;
      if (Array.isArray(content) && content.length) {
        const text = joinTextParts(content);
        if (text && text.trim()) {
          return { text, source: "responses.output.assistant.content.text" };
        }
      }
      // Фолбэк: если ассистента не нашли/нет role, используем первый подходящий content[]
      const first = obj.output[0];
      const firstContent = first?.content;
      if (Array.isArray(firstContent) && firstContent.length) {
        const text = joinTextParts(firstContent);
        if (text && text.trim()) {
          return { text, source: "responses.output.content.text" };
        }
      }
    }

    // 2) Chat Completions (fallback совместимость)
    const choice0 = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
    if (choice0?.message?.content) {
      return { text: String(choice0.message.content), source: "chat.choices.message" };
    }
    if (choice0?.text) {
      return { text: String(choice0.text), source: "chat.choices.text" };
    }

    // Ничего не распознали — покажем JSON
    return { text: JSON.stringify(obj, null, 2), source: "json-stringify" };
  }

  return { text: String(raw ?? ""), source: "unknown" };
}
