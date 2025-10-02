// src/ui/chatNoteComposer.ts
import { appendChatExchange } from "../modules/chatNoteActions";
import { getSelectedChatNote } from "../utils/chatNoteUi";
import { warn, log } from "../utils/logger";
import { callOpenAI, callOpenAIWithFiles } from "../utils/openai";
import { normalizeLLMResponse } from "../utils/llmResponse";
import { getPref } from "../utils/prefs"; // имя адаптируйте под свой prefs.ts
import { loadSelectedPdfFiles } from "../utils/zoteroFiles";



declare const Zotero: any;

let composerEl: HTMLDivElement | null = null;
let textareaEl: HTMLTextAreaElement | null = null;
let insertBtnEl: HTMLButtonElement | null = null;
let clearBtnEl: HTMLButtonElement | null = null;
let hideBtnEl: HTMLButtonElement | null = null;

let activeNote: any | null = null; // только для UI-индикации; источником истины служит текущее выделение
let isInserting = false;

function dbgNote(n: any) {
  if (!n) return null;
  return { id: n.id, key: n.key, title: (n.getNoteTitle?.() || n.getNote?.()?.slice(0, 80) || "").toString() };
}



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
    insertBtnEl.disabled = false; // всегда активна — проверка цели выполняется в момент клика
    insertBtnEl.addEventListener("click", () => { void onInsertClick(); });

    clearBtnEl = doc.createElement("button");
    clearBtnEl.textContent = "Clear";
    clearBtnEl.addEventListener("click", () => {
      if (textareaEl) textareaEl.value = "";
      log("ChatNoteComposer.clear");
    });

    hideBtnEl = doc.createElement("button");
    hideBtnEl.textContent = "Hide";
    hideBtnEl.addEventListener("click", () => {
      if (!composerEl) return;
      composerEl.style.display = "none";
      log("ChatNoteComposer.hide");
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

/** Активирует/деактивирует композер для конкретной chat-note (используется только для UI). */
export function setActiveChatNote(note: any | null) {
  activeNote = note || null;
  // Кнопку намеренно не блокируем — цель проверяется при клике
  log("ChatNoteComposer.active.set", { note: dbgNote(activeNote) });
}
// --- helpers: host & pdfs -------------------------------------------------
type InputFileForApi = { filename: string; file_data: string };

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

function extractCandidateTitleFromNote(note: any): string {
  try {
    const raw = String(note?.getNoteTitle?.() || note?.getNote?.() || "").trim();
    // ваши чат-заметки называются вида "AI Chat — <Title>"
    const m = raw.match(/AI\s*Chat\s*[-—]\s*(.+)$/i);
    return (m ? m[1] : raw).trim();
  } catch {
    return "";
  }
}

function getItemTitle(it: any): string {
  try {
    return String(it?.getDisplayTitle?.() || it?.getField?.("title") || "").trim();
  } catch {
    return "";
  }
}

async function findHostItemForChatNote(note: any): Promise<any | null> {
  // 1) если заметка — ребёнок статьи/записи
  const viaSource = typeof note?.getSource === "function" ? note.getSource() : null;
  if (viaSource && viaSource.id) return viaSource;

  // 2) эвристика по названию внутри тех же коллекций
  const wantTitle = extractCandidateTitleFromNote(note).toLowerCase();
  const colIds: number[] = (typeof note?.getCollections === "function" ? note.getCollections() : []) || [];
  if (!colIds.length) return null;

  let best: any | null = null;
  let bestScore = -1;

  for (const cid of colIds) {
    const coll = (Zotero as any)?.Collections?.get?.(cid);
    const children: any[] = coll?.getChildItems?.() || [];
    for (const it of children) {
      if (!it?.isRegularItem?.() || typeof it.getAttachments !== "function") continue;

      const t = getItemTitle(it).toLowerCase();
      const atts: number[] = it.getAttachments?.() || [];
      if (!atts.length) continue; // интересуют только записи с вложениями

      // простая метрика близости по заголовку
      let score = 0;
      if (wantTitle) {
        if (t === wantTitle) score += 5;
        if (t.includes(wantTitle)) score += 3;
        // частичное совпадение по первым 40 символам
        const head = wantTitle.slice(0, Math.min(40, wantTitle.length));
        if (head && t.includes(head)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
  }
  return best;
}

async function loadPdfFilesForChatNote(note: any): Promise<InputFileForApi[]> {
  const pane = (Zotero as any)?.getActiveZoteroPane?.();
  const prevSel: any[] =
    (pane && typeof pane.getSelectedItems === "function")
      ? (pane.getSelectedItems() || [])
      : [];

  try {
    // --- host строго из parentItem, без поисков и эвристик ---
    let host: any = (note as any)?.parentItem || null;

    if (typeof host === "number") {
      host = (Zotero as any).Items?.get?.(host) || null; // parentItem как itemID
    } else if (typeof host === "string") {
      // parentItem как itemKey
      host =
        (Zotero as any).Items?.getByLibraryAndKey?.(note.libraryID, host) ||
        (Zotero as any).Items?.getByKey?.(host) ||
        null;
    }

    if (!host || !host.id) {
      log("ChatNoteComposer.host.notFound.parentItem", {
        noteID: note?.id,
        type: typeof (note as any)?.parentItem,
        parentItem: (note as any)?.parentItem ?? null,
      });
      return [];
    }

    log("ChatNoteComposer.host.found", {
      hostID: host.id,
      hostTitle: (host.getDisplayTitle?.() || host.getField?.("title") || "").toString(),
      via: "parentItem",
    });

    // Выделяем родителя в текущем списке, чтобы переиспользовать loadSelectedPdfFiles()
    if (pane?.selectItems) {
      pane.selectItems([host.id]);
    } else if (pane?.itemsView?.selectItems) {
      pane.itemsView.selectItems([host.id]);
    } else if (pane?.selectItem) {
      pane.selectItem(host.id);
    }

    // дать UI обновиться
    await sleep(30);

    // Читаем PDF-вложения у выделенного item
    const files = await loadSelectedPdfFiles(); // [{ filename, file_data (base64 без data:) }, ...]
    if (!Array.isArray(files) || !files.length) {
      log("ChatNoteComposer.pdf.noneForHost", { hostID: host.id });
      return [];
    }

    // Приводим к формату OpenAI (добавляем data: префикс)
    const filesForApi: InputFileForApi[] = files.map((f: any) => {
      const raw = String(f?.file_data || "");
      const prefixed = raw.startsWith("data:")
        ? raw
        : `data:application/pdf;base64,${raw}`;
      return {
        filename: String(f?.filename || "attachment.pdf"),
        file_data: prefixed,
      };
    });

    log("ChatNoteComposer.pdf.found", {
      count: filesForApi.length,
      first: filesForApi[0]?.filename,
    });

    return filesForApi;
  } catch (e) {
    warn("ChatNoteComposer.loadPdfFilesForChatNote.error", { message: String(e) });
    return [];
  } finally {
    // восстановить предыдущий выбор, чтобы не ломать UX
    try {
      if (pane && prevSel && prevSel.length) {
        const ids = prevSel.map((x: any) => x.id).filter(Boolean);
        if (ids.length && pane.selectItems) pane.selectItems(ids);
        else if (ids.length && pane.itemsView?.selectItems) pane.itemsView.selectItems(ids);
      }
    } catch { /* ignore */ }
  }
}

async function onInsertClick(): Promise<void> {
  if (isInserting) return;
  isInserting = true;
  const restoreBtn = () => {
    if (insertBtnEl) {
      insertBtnEl.disabled = false;
      insertBtnEl.textContent = "Insert to note";
    }
  };

  // локальный helper, как в aiChat.ts
  const redactKey = (k: string) => (!k ? "" : (k.startsWith("sk-") ? "sk-***REDACTED***" : "***REDACTED***"));

  try {
    if (!textareaEl) {
      warn("ChatNoteComposer.insert.noTextarea");
      return;
    }

    const selectedNow = safeGetSelectedChatNote();
    let targetNote = selectedNow ?? activeNote ?? null;

    if (selectedNow && (!activeNote || selectedNow.id !== activeNote.id)) {
      setActiveChatNote(selectedNow);
      targetNote = selectedNow;
    }
    if (!targetNote) {
      notify("Select a chat note first.");
      log("ChatNoteComposer.insert.noTarget");
      return;
    }

    const userText = textareaEl.value.trim();
    if (!userText) {
      notify("Prompt is empty.");
      return;
    }

    // UI: блокируем кнопку на время запроса
    if (insertBtnEl) {
      insertBtnEl.disabled = true;
      insertBtnEl.textContent = "Sending…";
    }

    log("ChatNoteComposer.insert.begin", {
      prev: dbgNote(activeNote),
      selected: dbgNote(selectedNow),
      target: dbgNote(targetNote),
      len: userText.length,
    });

// ----- ЧТЕНИЕ ПРЕФОВ (как в aiChat.ts) -----
    const pref = getPref as unknown as (k: string) => any;
    const savedKey = String(pref("llmKey") ?? "").trim();
    const fallbackKey = String(pref("openaiApiKey") ?? "").trim();
    const apiKey = savedKey || fallbackKey;

    const redactKey = (k: string) => (!k ? "" : (k.startsWith("sk-") ? "sk-***REDACTED***" : "***REDACTED***"));
    log("ChatNoteComposer.llm.keyMeta", { hasKey: !!apiKey, keyPreview: redactKey(apiKey) });

    if (!apiKey) {
      notify("OpenAI API key is missing. Set it in Preferences.");
      warn("ChatNoteComposer.insert.noApiKey");
      return;
    }

    const modelPref = String(pref("openaiModel") ?? pref("llmModel") ?? "").trim();
    const maxTokensPref = Number(pref("openaiMaxTokens") ?? 2048);
    const topPPref = Number(pref("openaiTopP") ?? 1);
    const systemPromptPref =
      String(pref("openaiSystemPrompt") ?? pref("llmSystemPrompt") ?? "").trim()
      || "You are a helpful scientific literature assistant. Reply concisely, format lists when helpful.";

// ----- ПОДГОТОВКА PDF из «родительской» статьи -----
    let filesForApi: { filename: string; file_data: string }[] = [];
    try {
      filesForApi = await loadPdfFilesForChatNote(targetNote);
      log("ChatNoteComposer.pdf.found", {
        count: filesForApi.length,
        first: filesForApi[0]?.filename,
      });
    } catch (e: any) {
      warn("ChatNoteComposer.pdf.load.error", { message: String(e) });
    }

// ----- ВЫЗОВ LLM (с PDF если есть) -----
    let assistantText = "";
    try {
      const raw = await callOpenAIWithFiles(
        userText,
        filesForApi, // ← если массив пуст, просто пойдёт текст-only
        apiKey,
        {
          model: modelPref || undefined,
          systemPrompt: systemPromptPref,
          max_output_tokens: Number.isFinite(maxTokensPref) ? maxTokensPref : 2048,
          top_p: Number.isFinite(topPPref) ? topPPref : 1,
          store: false,
        }
      );
      const norm = normalizeLLMResponse(raw);
      assistantText = (norm.text || "").trim();
      log("ChatNoteComposer.llm.ok", {
        source: norm.source,
        answerLen: assistantText.length,
        withPdf: filesForApi.length > 0,
      });
    } catch (llmErr: any) {
      warn("ChatNoteComposer.llm.error", { message: String(llmErr) });
      assistantText = `⚠️ OpenAI error: ${String(llmErr?.message || llmErr)}`;
    }

    // Сохраняем в заметку одним вызовом: User + Assistant (обновлённая сигнатура)
    await appendChatExchange(targetNote, userText, new Date(), assistantText);

    log("ChatNoteComposer.append.saved", {
      noteID: targetNote.id,
      userLen: userText.length,
      assistantLen: assistantText.length,
    });

    notify("Inserted to note.");
    textareaEl.value = "";
    log("ChatNoteComposer.insert.done", { note: dbgNote(targetNote) });
  } catch (e) {
    warn("ChatNoteComposer.insert.error", { message: String(e) });
    notify("Failed to insert (see logs).");
  } finally {
    restoreBtn();
    isInserting = false;
  }
}




function safeGetSelectedChatNote(): any | null {
  try {
    // Берём активный pane ровно в момент клика
    const pane = Zotero?.getActiveZoteroPane?.();
    if (!pane) return getSelectedChatNote(); // запасной путь
    return getSelectedChatNote();
  } catch {
    return null;
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
