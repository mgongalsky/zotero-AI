// src/modules/chatNoteToolbar.ts
import { addToolbarButton, removeToolbarButton, getActiveParentItem } from "../utils/chatNoteUi";
import { log, warn } from "../utils/logger";

declare const Zotero: any;

const BUTTON_ID = "zai-chatnote-btn";

export async function registerChatNoteToolbarButton() {
  try {
    await addToolbarButton({
      id: BUTTON_ID,
      label: "AI Chat Note",
      tooltip: "Открыть чат-заметку (Step 1: UI only)",
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
  const parent = getActiveParentItem();
  if (!parent) {
    notify("Select a parent item first");
    warn("ChatNoteToolbarButton.noParentItem");
    return;
  }

  let title = "(item)";
  try {
    title = parent.getField ? parent.getField("title") : String(parent?.key ?? "(item)");
  } catch (e) {
    warn("ChatNoteToolbarButton.readTitle.error", { message: String(e) });
  }

  notify(`AI Chat Note: selected parent “${title}”`);
  log("ChatNoteToolbarButton.click", { parentKey: parent?.key ?? null, title });
  // Step 1: только UI. Дальше — создание/открытие child note.
}
