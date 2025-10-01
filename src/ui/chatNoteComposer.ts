// src/ui/chatNoteComposer.ts
import { appendChatExchange } from "../modules/chatNoteActions";
import { warn, log } from "../utils/logger";

declare const Zotero: any;

let composerEl: HTMLDivElement | null = null;
let textareaEl: HTMLTextAreaElement | null = null;
let insertBtnEl: HTMLButtonElement | null = null;
let clearBtnEl: HTMLButtonElement | null = null;
let hideBtnEl: HTMLButtonElement | null = null;

let activeNote: any | null = null;
let isInserting = false;

/** Инициализация нижней панели-композера. Вызывается из hooks.onMainWindowLoad(win). */
export function initChatNoteComposer(win: _ZoteroTypes.MainWindow) {
  try {
    const doc = win.document as Document;

    // уже создано — выходим
    if (doc.getElementById("zai-chatnote-composer")) return;

    const container = doc.body ?? doc.documentElement;
    if (!container) {
      warn("ChatNoteComposer.init.noBody");
      return;
    }

    composerEl = doc.createElement("div");
    composerEl.id = "zai-chatnote-composer";
    composerEl.setAttribute(
      "style",
      [
        "position:fixed",
        "left:0",
        "right:0",
        "bottom:0",
        "z-index:99999",
        "background:var(--zotero-pane-bg,#fff)",
        "border-top:1px solid var(--zotero-separator,#ddd)",
        "padding:8px",
        "display:flex",
        "gap:8px",
        "align-items:flex-start",
        "font:menu",
      ].join(";"),
    );

    // Текстовое поле
    textareaEl = doc.createElement("textarea");
    textareaEl.rows = 3;
    textareaEl.placeholder = "Type your prompt… (Ctrl/⌘+Enter to insert)";
    textareaEl.setAttribute(
      "style",
      [
        "flex:1",
        "width:100%",
        "resize:vertical",
        "padding:6px",
        "border:1px solid var(--zotero-separator,#ccc)",
        "border-radius:4px",
        "font:menu",
      ].join(";"),
    );

    // Правая колонка: кнопки (Insert, Clear, Hide)
    const btnCol = doc.createElement("div");
    btnCol.setAttribute("style", "display:flex;flex-direction:column;gap:6px;");

    insertBtnEl = doc.createElement("button");
    insertBtnEl.textContent = "Insert to note";
    insertBtnEl.disabled = true; // пока нет активной chat-note
    insertBtnEl.addEventListener("click", () => {
      void onInsertClick();
    });

    clearBtnEl = doc.createElement("button");
    clearBtnEl.textContent = "Clear";
    clearBtnEl.addEventListener("click", () => {
      if (textareaEl) textareaEl.value = "";
    });

    hideBtnEl = doc.createElement("button");
    hideBtnEl.textContent = "Hide";
    hideBtnEl.addEventListener("click", () => {
      if (!composerEl) return;
      composerEl.style.display = "none";
    });

    btnCol.appendChild(insertBtnEl);
    btnCol.appendChild(clearBtnEl);
    btnCol.appendChild(hideBtnEl);

    composerEl.appendChild(textareaEl);
    composerEl.appendChild(btnCol);

    container.appendChild(composerEl);

    // Горячая клавиша отправки: Ctrl/⌘ + Enter
    textareaEl.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void onInsertClick();
      }
    });

    log("ChatNoteComposer.init");
  } catch (e) {
    warn("ChatNoteComposer.init.error", { message: String(e) });
  }
}

/** Активирует/деактивирует композер для конкретной chat-note (без показа названия). */
export function setActiveChatNote(note: any | null) {
  activeNote = note || null;
  try {
    if (insertBtnEl) insertBtnEl.disabled = !activeNote;
  } catch (e) {
    warn("ChatNoteComposer.setActive.error", { message: String(e) });
  }
}

async function onInsertClick(): Promise<void> {
  if (isInserting) return;
  isInserting = true;
  try {
    if (!activeNote) {
      notify("No active chat note. Create/open it first.");
      return;
    }
    if (!textareaEl) {
      warn("ChatNoteComposer.insert.noTextarea");
      return;
    }
    const text = textareaEl.value.trim();
    if (!text) {
      notify("Prompt is empty.");
      return;
    }

    await appendChatExchange(activeNote, text, new Date());
    notify("Inserted to note.");
    textareaEl.value = "";
  } catch (e) {
    warn("ChatNoteComposer.insert.error", { message: String(e) });
    notify("Failed to insert (see logs).");
  } finally {
    isInserting = false;
  }
}

/** Текущая видимость панели. */
export function isComposerVisible(): boolean {
  return !!composerEl && composerEl.style.display !== "none";
}

/** Показать панель. */
export function showComposer(): void {
  if (composerEl) composerEl.style.display = "flex";
}

/** Скрыть панель. */
export function hideComposer(): void {
  if (composerEl) composerEl.style.display = "none";
}

/** Гарантированно показать панель, если была скрыта. */
export function ensureComposerVisible(): void {
  if (composerEl && composerEl.style.display === "none") {
    composerEl.style.display = "flex";
  }
}

function notify(message: string) {
  try {
    const pane = Zotero?.getMainWindow?.()?.ZoteroPane;
    if (pane?.showNotification) pane.showNotification(message);
  } catch (e) {
    warn("ChatNoteComposer.notify.error", { message: String(e) });
  }
  log("ChatNoteComposer.notify", { message });
}
