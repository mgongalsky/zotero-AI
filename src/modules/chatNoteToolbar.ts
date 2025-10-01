// src/modules/chatNoteToolbar.ts
import { log, warn } from "../utils/logger";
import {
  addToolbarButton,
  removeToolbarButton,
  getActiveParentItem,
  getSelectedChatNote,    // ⬅ добавили
} from "../utils/chatNoteUi";

import {
  createChatNoteForParent,
  openNotePreferTab,
  findRecentEmptyChatNote,
} from "./chatNoteActions";

import {
  setActiveChatNote,
  ensureComposerVisible,   // ⬅ добавили
} from "../ui/chatNoteComposer";

declare const Zotero: any;

const BUTTON_ID = "zai-chatnote-btn";
// простая защита от повторного входа
let isRunning = false;
let lastClickTs = 0;
const CLICK_DEBOUNCE_MS = 300;

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
  const now = Date.now();
  if (now - lastClickTs < CLICK_DEBOUNCE_MS) return;
  lastClickTs = now;
  if (isRunning) return;
  isRunning = true;

  try {
    // 1) Всегда показать нижнюю панель, если была скрыта
    ensureComposerVisible();

    // 2) Если выделена уже существующая chat-note — просто привязать композер
    const selectedChat = getSelectedChatNote();
    if (selectedChat) {
      setActiveChatNote(selectedChat);
      notify("Composer is active for the selected chat note.");
      return;
    }

    // 3) Иначе — логика parent→note (создать/переиспользовать)
    const parent: any = getActiveParentItem();
    if (!parent) {
      notify("Select a parent item first");
      warn("ChatNoteToolbarButton.noParentItem");
      return;
    }

    let note: any = await findRecentEmptyChatNote(parent, 3000);
    if (!note) note = await createChatNoteForParent(parent);

    setActiveChatNote(note);
    notify("Chat note ready — opening…");
    await openNotePreferTab(note);
  } catch (e) {
    warn("ChatNoteToolbarButton.click.error", { message: String(e) });
  } finally {
    isRunning = false;
  }
}
