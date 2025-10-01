// src/modules/chatNoteToolbar.ts
import { addToolbarButton, removeToolbarButton, getActiveParentItem } from "../utils/chatNoteUi";
import { setActiveChatNote } from "../ui/chatNoteComposer";
import { createChatNoteForParent, openNotePreferTab, findRecentEmptyChatNote } from "./chatNoteActions";
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
    if (!parent) { /* notify... */ return; }

    let note = await findRecentEmptyChatNote(parent, 3000);
    if (!note) note = await createChatNoteForParent(parent);

    setActiveChatNote(note);                 // <-- сообщаем композеру
    notify("Chat note ready — opening…");
    await openNotePreferTab(note);
  } catch (e) {
    warn("ChatNoteToolbarButton.click.error", { message: String(e) });
  } finally {
    isRunning = false;
  }
}
