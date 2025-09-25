// Minimal logger that plays nice with Zotero
const TAG = "[Zotero-AI]";

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (typeof val === "string") {
        // redact OpenAI-style keys and bearer tokens
        if (val.startsWith("sk-")) return "sk-***REDACTED***";
        if (/^Bearer\s+sk-/.test(val)) return "Bearer sk-***REDACTED***";
      }
      return val;
    }, 2);
  } catch {
    return String(v);
  }
}

export function log(message: string, data?: unknown) {
  // Prefer Zotero.debug when available; fall back to console
  const line = data !== undefined ? `${TAG} ${message} ${safeStringify(data)}` : `${TAG} ${message}`;
  // @ts-ignore
  if (typeof Zotero !== "undefined" && Zotero.debug) Zotero.debug(line);
  else console.log(line);
}

export function warn(message: string, data?: unknown) {
  const line = data !== undefined ? `${TAG} [WARN] ${message} ${safeStringify(data)}` : `${TAG} [WARN] ${message}`;
  // @ts-ignore
  if (typeof Zotero !== "undefined" && Zotero.debug) Zotero.debug(line);
  else console.warn(line);
}

export function error(message: string, data?: unknown) {
  const line = data !== undefined ? `${TAG} [ERROR] ${message} ${safeStringify(data)}` : `${TAG} [ERROR] ${message}`;
  // @ts-ignore
  if (typeof Zotero !== "undefined" && Zotero.debug) Zotero.debug(line);
  else console.error(line);
}
