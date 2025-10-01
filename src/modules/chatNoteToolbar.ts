// src/modules/chatNoteToolbar.ts
import { addToolbarButton, removeToolbarButton, getActiveParentItem } from "../utils/chatNoteUi";
import { createChatNoteForParent, openNotePreferTab } from "./chatNoteActions";
import { log, warn } from "../utils/logger";

declare const Zotero: any;

const BUTTON_ID = "zai-chatnote-btn";
// простая защита от повторного входа
let isRunning = false;

export async function registerChatNoteToolbarButton() {
  try {
    await addToolbarButton({
      id: BUTTON_ID,
      label: "AI Chat Note",
      tooltip: "Создать/открыть чат-заметку",
      onCommand: onChatNoteButtonClick,
    });
    log("ChatNoteToolbarButton.registered");
  } catch (e) {
    warn("ChatNoteToolbarButton.register.error", { message: String(e) });
  }
}

export async function unregisterChatNoteToolbarButton() {
  try {
    await removeToolbarButton(BUTTON_ID);
    log("ChatNoteToolbarButton.unregistered");
  } catch (e) {
    warn("ChatNoteToolbarButton.unregister.error", { message: String(e) });
  }
}

function notify(message: string) {
  try {
    const pane = Zotero?.getMainWindow?.()?.ZoteroPane;
    if (pane?.showNotification) pane.showNotification(message);
  } catch (e) {
    warn("ChatNoteToolbarButton.notify.error", { message: String(e) });
  }
  log("ChatNoteToolbarButton.notify", { message });
}

async function onChatNoteButtonClick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const parent = getActiveParentItem();
    if (!parent) {
      notify("Select a parent item first");
      warn("ChatNoteToolbarButton.noParentItem");
      return;
    }

    let note: any;
    try {
      note = await createChatNoteForParent(parent);
    } catch (e) {
      warn("ChatNoteToolbarButton.createNote.error", { message: String(e) });
      notify("Failed to create chat note (see logs)");
      return;
    }

    notify("Chat note created — opening…");
    try {
      await openNotePreferTab(note);
    } catch (e) {
      warn("ChatNoteToolbarButton.openNote.error", { message: String(e) });
    }
  } finally {
    isRunning = false;
  }
}
