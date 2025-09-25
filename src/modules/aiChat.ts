// src/modules/aiChat.ts
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { createZToolkit } from "../utils/ztoolkit";
import { getPref, setPref } from "../utils/prefs";
import { callOpenAI } from "../utils/openai";
import { log, warn, error } from "../utils/logger";
import { normalizeLLMResponse } from "../utils/llmResponse";

type DialogData = {
  key: string;
  prompt: string;
  output: string;
  _lastButtonId?: string;
};

const GLOBAL_HOOK_FLAG = "__zotero_ai_hooks_installed__";

/* utils ------------------------------------------------------------------- */

function redactKey(k: string) {
  if (!k) return "";
  if (k.startsWith("sk-")) return "sk-***REDACTED***";
  return "***REDACTED***";
}

function isErrorEvent(ev: unknown): ev is ErrorEvent {
  return !!ev && typeof (ev as any).message === "string";
}
function hasStack(err: unknown): err is { name?: string; message?: string; stack?: string } {
  const e = err as any;
  return !!e && (typeof e.stack === "string" || typeof e.message === "string");
}

/** Write dialog instance into `addon.data.dialog` without ts-comments */
function setAddonDialog(value: unknown) {
  try {
    const g = globalThis as any;
    if (!g.addon) g.addon = {};
    if (!g.addon.data) g.addon.data = {};
    g.addon.data.dialog = value;
  } catch {
    /* ignore */
  }
}

/** Attach verbose global error hooks exactly once per window. */
function attachGlobalHooks(win: Window | undefined | null) {
  if (!win) return;
  const anyWin = win as any;
  if (anyWin[GLOBAL_HOOK_FLAG]) return;

  try {
    win.addEventListener("error", (ev: Event | ErrorEvent) => {
      if (isErrorEvent(ev)) {
        const payload = {
          message: ev.message,
          filename: (ev as any).filename,
          lineno: (ev as any).lineno,
          colno: (ev as any).colno,
          error: hasStack((ev as any).error)
            ? {
              name: (ev as any).error?.name,
              message: (ev as any).error?.message,
              stack: (ev as any).error?.stack,
            }
            : String((ev as any).error ?? ""),
        };
        error("global.error", payload);
      } else {
        error("global.error.unknownEvent", {
          type: (ev as any)?.type,
          toString: String(ev),
        });
      }
    });

    win.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent | Event) => {
      const reason: any = (ev as any)?.reason ?? "undefined";
      error("global.unhandledRejection", {
        kind: typeof reason,
        message: reason?.message ?? String(reason),
        stack: reason?.stack ?? null,
      });
    });

    anyWin[GLOBAL_HOOK_FLAG] = true;
    log("global.hooksInstalled");
  } catch (e: any) {
    error("global.installHooks.fail", { message: e?.message, stack: e?.stack });
  }
}

type BtnCb = () => void | Promise<void>;
function measure<T extends BtnCb>(name: string, fn: T): T {
  const wrapped: BtnCb = async () => {
    const t0 = Date.now();
    log(`${name}.begin`);
    try {
      const rv = await fn();
      log(`${name}.ok`, { ms: Date.now() - t0 });
      return rv;
    } catch (e: any) {
      error(`${name}.fail`, { ms: Date.now() - t0, message: e?.message, stack: e?.stack });
      throw e;
    }
  };
  return wrapped as T;
}

type DialogAreas = {
  keyEl: HTMLInputElement | null;
  promptEl: HTMLTextAreaElement | null;
  outputEl: HTMLTextAreaElement | null;
};

/* --- diagnostic helpers for LLM object shapes ---------------------------- */

function safePreview(val: unknown, n = 200): string {
  try {
    if (val == null) return "null";
    if (typeof val === "string") return val.slice(0, n);
    return JSON.stringify(val, null, 2).slice(0, n);
  } catch {
    return "[unserializable]";
  }
}

function objKeys(o: unknown): string[] {
  try {
    return o && typeof o === "object" ? Object.keys(o as any) : [];
  } catch {
    return [];
  }
}

function hasPath(o: any, path: (string | number)[]): boolean {
  try {
    let cur = o;
    for (const p of path) {
      if (cur == null) return false;
      if (typeof p === "number") {
        if (!Array.isArray(cur) || cur.length <= p) return false;
        cur = cur[p];
      } else {
        if (!(p in cur)) return false;
        cur = cur[p];
      }
    }
    return cur != null;
  } catch {
    return false;
  }
}

function getPath(o: any, path: (string | number)[]): unknown {
  try {
    let cur = o;
    for (const p of path) {
      if (cur == null) return undefined;
      cur = typeof p === "number" ? cur?.[p] : cur?.[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function probeCommonAnswerShapes(raw: unknown) {
  const r: any = {};
  if (raw && typeof raw === "object") {
    // /v1/responses (new OpenAI Responses API)
    r.responses_output_text_0 = hasPath(raw, ["output_text", 0])
      ? safePreview(getPath(raw, ["output_text", 0]))
      : null;
    r.responses_output_0_content_0_text = hasPath(raw, ["output", 0, "content", 0, "text"])
      ? safePreview(getPath(raw, ["output", 0, "content", 0, "text"]))
      : null;
    r.responses_output_0_text = hasPath(raw, ["output", 0, "text"])
      ? safePreview(getPath(raw, ["output", 0, "text"]))
      : null;

    // /v1/chat/completions style
    r.choices_0_message_content = hasPath(raw, ["choices", 0, "message", "content"])
      ? safePreview(getPath(raw, ["choices", 0, "message", "content"]))
      : null;
    r.choices_0_text = hasPath(raw, ["choices", 0, "text"])
      ? safePreview(getPath(raw, ["choices", 0, "text"]))
      : null;

    // generic content fields
    r.message_content = hasPath(raw, ["message", "content"])
      ? safePreview(getPath(raw, ["message", "content"]))
      : null;
    r.content = hasPath(raw, ["content"]) ? safePreview(getPath(raw, ["content"])) : null;
  }
  return r;
}

/* UI ---------------------------------------------------------------------- */

export async function openAIChatDialog(_win: Window) {
  attachGlobalHooks(_win);

  const tk = createZToolkit();
  log("ai.dialog.open.start", {
    zoteroVersion: (typeof Zotero !== "undefined" && (Zotero as any).version) || "unknown",
  });

  // IMPORTANT: bind THIS object so UI changes are visible here
  const data = {
    key: ((getPref as any)("llmKey") as string) ?? "",
    prompt: "",
    output: "",
  } as DialogData & Record<string, unknown>;

  const keyId = `${config.addonRef}-ai-key`;
  const promptId = `${config.addonRef}-ai-prompt`;
  const outputId = `${config.addonRef}-ai-output`;

  let dlg: InstanceType<typeof tk.Dialog> | undefined;

  try {
    dlg = new tk.Dialog(12, 6)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: getString("ai-dialog-title" as any) },
      })
      .addCell(1, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("ai-key-label" as any) },
      })
      .addCell(
        1,
        1,
        {
          tag: "input",
          namespace: "html",
          id: keyId,
          attributes: {
            type: "password",
            "data-bind": "key",
            "data-prop": "value",
            placeholder: "sk-…",
          },
          styles: { width: "320px" },
        },
        false
      )
      .addCell(2, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("ai-prompt-label" as any) },
      })
      .addCell(
        3,
        0,
        {
          tag: "textarea",
          namespace: "html",
          id: promptId,
          attributes: { "data-bind": "prompt", "data-prop": "value", rows: "6" },
          styles: { width: "480px", height: "140px" },
        },
        false
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        properties: { innerHTML: getString("ai-output-label" as any) },
      })
      .addCell(
        5,
        0,
        {
          tag: "textarea",
          namespace: "html",
          id: outputId,
          attributes: {
            "data-bind": "output",
            "data-prop": "value",
            readonly: "true",
          },
          styles: { width: "480px", height: "180px" },
        },
        false
      )
      .addButton(getString("ai-send" as any) || "Send", "send", {
        noClose: true,
        callback: measure("ai.dialog.send", async () => {
          const doc = dlg!.window!.document;
          const areas: DialogAreas = {
            keyEl: doc.getElementById(keyId) as HTMLInputElement | null,
            promptEl: doc.getElementById(promptId) as HTMLTextAreaElement | null,
            outputEl: doc.getElementById(outputId) as HTMLTextAreaElement | null,
          };

          // read key robustly
          const typedKey = String(areas.keyEl?.value ?? "").trim();
          const boundKey = String((data as DialogData).key ?? "").trim();
          const savedKey = String(((getPref as any)("llmKey") as string) ?? "").trim();
          const key = typedKey || boundKey || savedKey;

          const userText = String(areas.promptEl?.value || "").trim();

          log("ai.dialog.send.clicked", {
            hasKey: Boolean(key),
            keyPreview: redactKey(key),
            promptLen: userText.length,
          });

          if (!key) {
            warn("ai.dialog.send.noKey");
            dlg!.window?.alert("Please enter OpenAI API key first.");
            return;
          }
          if (!userText) {
            warn("ai.dialog.send.emptyPrompt");
            dlg!.window?.alert("Prompt is empty.");
            return;
          }

          if (areas.outputEl) areas.outputEl.value = "⏳ Sending to OpenAI…";

          try {
            const t0 = Date.now();
            const raw: any = await callOpenAI(userText, key); // object or string

            // -------- RAW diagnostics
            const rawIsObj = raw && typeof raw === "object";
            log("ai.dialog.recv.raw.meta", {
              typeofRaw: typeof raw,
              isArray: Array.isArray(raw),
              objTopKeys: rawIsObj ? objKeys(raw) : [],
              stringLen: typeof raw === "string" ? raw.length : undefined,
              stringFirst200: typeof raw === "string" ? raw.slice(0, 200) : undefined,
            });
            if (rawIsObj) {
              log("ai.dialog.recv.raw.probes", probeCommonAnswerShapes(raw));
            }

            // -------- Normalization
            log("ai.dialog.normalize.begin", {});
            const norm = normalizeLLMResponse(raw);
            const normText = (norm?.text ?? "") as string;
            log("ai.dialog.normalize.end", {
              source: norm?.source ?? null,
              textLen: normText.length,
              textFirst200: normText.slice(0, 200),
            });

            // -------- Final text + fallback
            let text = normText.trim();
            if (!text) {
              const why =
                typeof raw === "string"
                  ? "normalize returned empty, raw is a string"
                  : "normalize returned empty, raw is an object";
              warn("ai.dialog.normalize.empty", { why });

              try {
                text =
                  typeof raw === "object"
                    ? JSON.stringify(raw, null, 2)
                    : String(raw ?? "");
              } catch (serr: any) {
                error("ai.dialog.stringify.fail", { message: serr?.message, stack: serr?.stack });
                text = "[unserializable object]";
              }
            }

            const dt = Date.now() - t0;

            (data as DialogData).output = text;
            if (areas.outputEl) {
              areas.outputEl.value = text;
              log("ai.dialog.ui.setOutput", {
                writtenLen: text.length,
                first200: text.slice(0, 200),
              });
            }

            log("ai.dialog.send.done", {
              ms: dt,
              outputLen: text.length,
              parseSource: norm.source,
              rawType: typeof raw,
            });

            // persist a working key immediately
            (setPref as any)("llmKey", key);
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            (data as DialogData).output = `Error: ${msg}`;
            if (areas.outputEl) areas.outputEl.value = `Error: ${msg}`;
            error("ai.dialog.send.error", { message: msg, stack: err?.stack });
          }
        }),
      })
      .addButton(getString("common-cancel" as any) || "Cancel", "cancel")
      .addButton(getString("common-confirm" as any) || "OK", "confirm", {
        callback: measure("ai.dialog.confirm.saveKey", () => {
          const k = (data as DialogData).key ?? "";
          log("ai.dialog.confirm.savingKey", { hasKey: !!k, keyPreview: redactKey(k) });
          (setPref as any)("llmKey", k);
        }),
      });

    // bind THIS exact object so changes flow both ways
    dlg.setDialogData(data);

    log("ai.dialog.built");
    dlg.open(getString("ai-dialog-title" as any) || "Zotero AI");
    log("ai.dialog.opened", {
      prefilledKey: !!(data as DialogData).key,
      keyPreview: redactKey((data as DialogData).key),
    });
  } catch (e: any) {
    error("ai.dialog.buildOrOpen.fail", { message: e?.message, stack: e?.stack });
    throw e;
  }

  setAddonDialog(dlg);

  await new Promise<void>((resolve) => {
    dlg!.window?.addEventListener(
      "unload",
      () => {
        log("ai.dialog.unloaded");
        resolve();
      },
      { once: true }
    );
  });

  setAddonDialog(undefined);
  log("ai.dialog.closed");
}
