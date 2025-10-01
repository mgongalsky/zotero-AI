// src/ui/chatNoteComposer.ts
import { appendChatExchange } from "../modules/chatNoteActions";
import { warn, log } from "../utils/logger";

// Глобальный Zotero приходит из окружения Zotero
declare const Zotero: any;

let composerEl: HTMLDivElement | null = null;
let textareaEl: HTMLTextAreaElement | null = null;
let insertBtnEl: HTMLButtonElement | null = null;
let noteTitleEl: HTMLSpanElement | null = null;
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

    // Левая колонка: название активной заметки + Hide
    const leftCol = doc.createElement("div");
    leftCol.setAttribute("style", "display:flex;flex-direction:column;gap:6px;min-width:220px;");

    const titleRow = doc.createElement("div");
    titleRow.setAttribute("style", "display:flex;align-items:center;gap:8px;");

    const titleLbl = doc.createElement("strong");
    titleLbl.textContent = "Chat Note:";

    noteTitleEl = doc.createElement("span");
    noteTitleEl.textContent = "— none —";

    hideBtnEl = doc.createElement("button");
    hideBtnEl.textContent = "Hide";
    hideBtnEl.addEventListener("click", () => {
      if (!composerEl) return;
      composerEl.style.display = composerEl.style.display === "none" ? "flex" : "none";
    });

    titleRow.appendChild(titleLbl);
    titleRow.appendChild(noteTitleEl);
    titleRow.appendChild(hideBtnEl);
    leftCol.appendChild(titleRow);

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

    // Правая колонка: кнопки
    const btnCol = doc.createElement("div");
    btnCol.setAttribute("style", "display:flex;flex-direction:column;gap:6px;");

    insertBtnEl = doc.createElement("button");
    insertBtnEl.textContent = "Insert to note";
    // Не оставляем «висящий» промис — явно игнорируем результат
    insertBtnEl.addEventListener("click", () => {
      void onInsertClick();
    });

    const clearBtn = doc.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      if (textareaEl) textareaEl.value = "";
    });

    btnCol.appendChild(insertBtnEl);
    btnCol.appendChild(clearBtn);

    composerEl.appendChild(leftCol);
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

/** Устанавливает активную chat-note, в которую пишет композер. */
export function setActiveChatNote(note: any | null) {
  activeNote = note || null;
  try {
    if (noteTitleEl) {
      if (!note) {
        noteTitleEl.textContent = "— none —";
      } else {
        const t = safeTitleFromNote(note);
        noteTitleEl.textContent = t ? `“${t}”` : `(note ${note.id})`;
      }
    }
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

function safeTitleFromNote(note: any): string {
  try {
    // У note нет getField('title'), достаём из <h2>…</h2> первой строки
    const html: string = note.getNote?.() ?? "";
    const m = html.match(/<h2[^>]*>AI Chat\s+—\s+<em>(.*?)<\/em><\/h2>/i);
    if (m) return decodeHTMLEntities(m[1]);
  } catch (e) {
    warn("ChatNoteComposer.safeTitleFromNote.error", { message: String(e) });
  }
  return "";
}

function decodeHTMLEntities(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
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
