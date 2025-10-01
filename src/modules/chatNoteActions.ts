// src/modules/chatNoteActions.ts
import { log, warn } from "../utils/logger";

declare const Zotero: any;

export async function createChatNoteForParent(parent: any) {
  const title = safeTitle(parent);
  const noteHTML = initialNoteHTML(title, parent);

  const note = new Zotero.Item("note");
  note.libraryID = parent.libraryID;

  // Привязка к родителю (поддержим оба варианта на всякий случай)
  try { note.parentItem = parent; } catch {}
  try { note.parentID = parent.id; } catch {}

  // Теги (через setTags — наиболее совместимый путь)
  try {
    note.setTags([
      { tag: "ai:chat" },
      { tag: `ai:parent:${parent.key ?? ""}` },
      { tag: "ai:model:fake" }, // пока заглушка
    ]);
  } catch (e) {
    warn("createChatNoteForParent.tags.error", { message: String(e) });
  }

  note.setNote(noteHTML);

  // saveTx в Zotero 7; если недоступно — save
  try {
    if (note.saveTx) await note.saveTx();
    else await note.save();
  } catch (e) {
    warn("createChatNoteForParent.save.error", { message: String(e) });
    throw e;
  }

  log("createChatNoteForParent.done", { noteID: note.id, parentKey: parent.key });
  return note;
}

export async function openNotePreferTab(note: any) {
  const win = Zotero?.getMainWindow?.();
  const ZoteroPane = win?.ZoteroPane;

  // 1) Попробуем таб-менеджер (если доступен)
  try {
    const Tabs = (win as any)?.Zotero_Tabs;
    if (Tabs?.add) {
      // Форматы отличаются между версиями; пробуем безопасный вариант
      Tabs.add({ type: "note", data: { id: note.id } });
      log("openNotePreferTab.tabs.add", { noteID: note.id });
      return;
    }
  } catch (e) {
    warn("openNotePreferTab.tabs.error", { message: String(e) });
  }

  // 2) Выделим заметку в списке (гарантированный способ показать её)
  try {
    ZoteroPane?.selectItem?.(note.id, true);
    log("openNotePreferTab.selectItem", { noteID: note.id });
    return;
  } catch (e) {
    warn("openNotePreferTab.selectItem.error", { message: String(e) });
  }

  // 3) Последняя соломинка — открыть “как есть”
  try {
    ZoteroPane?.viewItem?.(note.id);
    log("openNotePreferTab.viewItem", { noteID: note.id });
  } catch (e) {
    warn("openNotePreferTab.viewItem.error", { message: String(e) });
  }
}

function safeTitle(parent: any): string {
  try {
    return parent?.getField?.("title") || String(parent?.key || "Item");
  } catch {
    return "Item";
  }
}

function initialNoteHTML(itemTitle: string, parent: any): string {
  const now = new Date();
  const when = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const parentKey = parent?.key ?? "";
  return [
    `<h2>AI Chat — <em>${escapeHtml(itemTitle)}</em></h2>`,
    `<p><small>created: ${when} • parent: ${escapeHtml(parentKey)}</small></p>`,
    `<hr>`,
    `<p>Готово. Это чат-заметка (child note). Используйте нижнюю панель (prompt composer), чтобы вставлять сообщения.</p>`
  ].join("\n");
}

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
