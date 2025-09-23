// src/modules/aiChat.ts
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { createZToolkit } from "../utils/ztoolkit";
import { getPref, setPref } from "../utils/prefs";

type DialogData = {
  key: string;
  prompt: string;
  output: string;
  _lastButtonId?: string;
  // unloadLock добавит ztoolkit.Dialog сам
};

export async function openAIChatDialog(win: Window) {
  const tk = createZToolkit();

  const data: DialogData = {
    key: (getPref("llmKey") as string) ?? "",
    prompt: "",
    output: "",
  };

  const promptId = `${config.addonRef}-ai-prompt`;
  const outputId = `${config.addonRef}-ai-output`;

  const dlg = new tk.Dialog(12, 6)
    .addCell(0, 0, { tag: "h1", properties: { innerHTML: getString("ai-dialog-title") } })
    // LLM Key
    .addCell(1, 0, { tag: "label", namespace: "html", properties: { innerHTML: getString("ai-key-label") } })
    .addCell(
      1,
      1,
      {
        tag: "input",
        namespace: "html",
        attributes: { type: "password", "data-bind": "key", "data-prop": "value", placeholder: "sk-…" },
        styles: { width: "320px" },
      },
      false
    )
    // Prompt
    .addCell(2, 0, { tag: "label", namespace: "html", properties: { innerHTML: getString("ai-prompt-label") } })
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
    // Output
    .addCell(4, 0, { tag: "label", namespace: "html", properties: { innerHTML: getString("ai-output-label") } })
    .addCell(
      5,
      0,
      {
        tag: "textarea",
        namespace: "html",
        id: outputId,
        attributes: { "data-bind": "output", "data-prop": "value", readonly: "true" },
        styles: { width: "480px", height: "180px" },
      },
      false
    )
    // Buttons
    .addButton(getString("ai-send"), "send", {
      noClose: true,
      callback: () => {
        const doc = dlg.window!.document;
        const promptEl = doc.getElementById(promptId) as HTMLTextAreaElement | null;
        const outputEl = doc.getElementById(outputId) as HTMLTextAreaElement | null;
        const text = promptEl?.value ?? "";
        if (outputEl) outputEl.value = text; // визуально
        (data as any).output = text; // синхронизация модели
      },
    })
    .addButton(getString("common-cancel") ?? "Cancel", "cancel")
    .addButton(getString("common-confirm") ?? "OK", "confirm", {
      callback: () => setPref("llmKey", (data as any).key ?? ""),
    })
    .setDialogData(data)
    .open(getString("ai-dialog-title"));

  addon.data.dialog = dlg;

  // ждём закрытия окна
  const lock = (data as any).unloadLock;
  if (lock?.promise) {
    await lock.promise;
  } else {
    await new Promise<void>((resolve) => dlg.window?.addEventListener("unload", () => resolve(), { once: true }));
  }

  addon.data.dialog = undefined;
}
