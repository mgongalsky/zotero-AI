// src/modules/aiChat.ts
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { createZToolkit } from "../utils/ztoolkit";
import { getPref, setPref } from "../utils/prefs";
import { callOpenAI } from "../utils/openai";
import { log, warn, error } from "../utils/logger";

type DialogData = {
  key: string;
  prompt: string;
  output: string;
  _lastButtonId?: string;
};

const GLOBAL_HOOK_FLAG = "__zotero_ai_hooks_installed__";

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
    // ignore
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

export async function openAIChatDialog(_win: Window) {
  attachGlobalHooks(_win);

  const tk = createZToolkit();
  log("ai.dialog.open.start", {
    zoteroVersion: (typeof Zotero !== "undefined" && (Zotero as any).version) || "unknown",
  });

  // ВАЖНО: тот же объект отдаём биндеру, чтобы изменения из UI были видны здесь.
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
          id: keyId, // id для прямого чтения
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

          // читаем ключ максимально надёжно
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
            const text = await callOpenAI(userText, key);
            const dt = Date.now() - t0;
            (data as DialogData).output = text;
            if (areas.outputEl) areas.outputEl.value = text;
            log("ai.dialog.send.done", { ms: dt, outputLen: text?.length ?? 0 });

            // сразу сохраняем рабочий ключ
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

    // ВАЖНО: биндим ИМЕННО data
    dlg.setDialogData(data);

    log("ai.dialog.built");
    dlg.open(getString("ai-dialog-title" as any) || "Zotero AI");
    log("ai.dialog.opened", { prefilledKey: !!(data as DialogData).key, keyPreview: redactKey((data as DialogData).key) });
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
