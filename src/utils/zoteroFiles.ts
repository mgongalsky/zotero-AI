// src/utils/zoteroFiles.ts
import { log, warn, error } from "./logger";

/**
 * Тип файла для Responses API (совместим с openai.ts)
 */
export type InputFile = {
  file_data: string;     // base64 (без префикса data:)
  filename: string;
  //mime_type: string;     // например, "application/pdf"
};

// В среде плагина доступен глобал Zotero.
declare const Zotero: any;

/** Быстрая проверка: это PDF? */
export function isPdfMime(mime?: string | null): boolean {
  return (mime || "").toLowerCase() === "application/pdf";
}

/** Безопасное извлечение булевых/числовых значений */
const b = (v: any) => !!v;
const n = (v: any) => (typeof v === "number" ? v : null);

/** Короткое описание item-а для логов (без async) */
function describeItem(it: any) {
  if (!it) return { exists: false };
  const isAtt = it.isAttachment?.();
  const isTop = it.isTopLevelItem?.() ?? false;
  const top = it.getTopLevelItem?.() || (isTop ? it : null);
  return {
    exists: true,
    id: n(it?.id),
    key: it?.key || null,
    itemType: it?.itemType || null,
    isAttachment: b(isAtt),
    isTopLevel: b(isTop),
    topKey: top?.key || null,
    parentID: n(it?.parentID),
    mime: it?.attachmentContentType || null,
    filename: it?.attachmentFilename || it?.getFilename?.() || null,
    linkMode: n(it?.attachmentLinkMode), // 0—stored, 1—linked (обычно)
  };
}

/** Конвертация ArrayBuffer → base64 без Node Buffer */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** --- BASE64 УТИЛИТЫ --- */

/** Удалить все пробелы/переводы строк, поправить паддинг до кратности 4 */
function normalizeBase64(raw: string): string {
  const s = String(raw || "").replace(/\s+/g, "");
  const pad = s.length % 4;
  return pad ? s + "=".repeat(4 - pad) : s;
}

/** Извлечь base64 из data:URI и нормализовать */
function extractBase64FromDataURI(uri: string): { mime: string; base64: string } {
  if (!uri) throw new Error("Empty data URI");
  const m = uri.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("Invalid data URI format");
  const base64 = normalizeBase64(m[2]);
  return { mime: m[1], base64 };
}

/** Бросает исключение, если base64 некорректен (объясняя причину) */
function assertAndExplainBase64(b64: string): void {
  if (typeof b64 !== "string") throw new Error("base64 is not a string");
  const s = normalizeBase64(b64);
  // только стандартный алфавит base64 (не base64url)
  if (/[^A-Za-z0-9+/=]/.test(s)) {
    throw new Error("base64 contains invalid characters");
  }
  // atob бросит исключение при некорректном паддинге/длине
  atob(s);
}

/** Быстрая проверка на PDF по магической сигнатуре (%PDF- → 'JVBER' в base64) */
function looksLikePdfBase64(b64: string): boolean {
  return normalizeBase64(b64).startsWith("JVBER");
}

/**
 * Прочитать файл и вернуть base64 с диска.
 * Используется как фолбэк, если dataURI недоступен.
 */
export async function readFileAsBase64(filePath: string): Promise<string> {
  if (!filePath) {
    throw new Error("readFileAsBase64: empty filePath");
  }

  log("zoteroFiles.readFile.begin", { filePath });

  // 1) Node.js (Electron)
  try {
    const fs = await import("fs/promises");
    const buf = await (fs as any).readFile(filePath);
    const b64 = (buf as any).toString("base64");
    log("zoteroFiles.readFile.node", { size: (buf as any)?.length ?? -1 });
    return normalizeBase64(b64);
  } catch (e) {
    warn("zoteroFiles.readFile.nodeFallback", { message: String(e) });
  }

  // 2) Zotero API
  if (Zotero?.File?.getBinaryContentsAsync) {
    log("zoteroFiles.readFile.viaZoteroApi", {});
    const ab: ArrayBuffer = await Zotero.File.getBinaryContentsAsync(filePath, {
      byteArray: true,
    });
    return normalizeBase64(arrayBufferToBase64(ab));
  }

  error("zoteroFiles.readFile.noApi", { filePath });
  throw new Error("No available file API to read file contents");
}

/** Диагностика доступных панелей/окон */
function dumpPanesOverview(tag = "zoteroFiles.panes") {
  try {
    const mainWin = Zotero.getMainWindow?.();
    const activePane = Zotero.getActiveZoteroPane?.();
    const mainPane = mainWin?.ZoteroPane;

    log(`${tag}.overview`, {
      hasMainWindow: !!mainWin,
      hasActivePane: !!activePane,
      hasMainPane: !!mainPane,
      activeEqMain: activePane === mainPane,
      activeHasGetSelectedItems: !!activePane?.getSelectedItems,
      mainHasGetSelectedItems: !!mainPane?.getSelectedItems,
    });

    // Reader-вкладка (если открыта)
    const tab = mainWin?.Zotero_Tabs?.getSelected?.();
    log(`${tag}.tab`, {
      hasTabMgr: !!mainWin?.Zotero_Tabs,
      tabType: tab?.type || null,
      readerItemID: tab?.data?.itemID || null,
    });
  } catch (e) {
    warn(`${tag}.fail`, { message: String(e) });
  }
}

/** Получить активную панель Zotero (совместимо с Zotero 7/диалогами) */
function getActivePane(): any | null {
  try {
    const pane = Zotero.getActiveZoteroPane?.();
    if (pane?.getSelectedItems) {
      log("zoteroFiles.getActivePane.active", { source: "getActiveZoteroPane" });
      return pane;
    }

    const zWin = Zotero.getMainWindow?.();
    const fallbackPane = zWin?.ZoteroPane;
    if (fallbackPane?.getSelectedItems) {
      log("zoteroFiles.getActivePane.fallback", { source: "mainWindow.ZoteroPane" });
      return fallbackPane;
    }
  } catch (e) {
    warn("zoteroFiles.getActivePane.fail", { message: String(e) });
  }
  log("zoteroFiles.getActivePane.none", {});
  return null;
}

/**
 * Вернуть выбранные элементы (в виде объектов); если ничего не выбрано,
 * пытаемся взять элемент из активной вкладки Reader.
 */
async function getSelectedItemsOrReaderItem(): Promise<any[]> {
  dumpPanesOverview();

  const pane = getActivePane();
  let items: any[] = [];

  try {
    // Без аргумента → вернёт объекты (не ID)
    const maybeItemsOrIDs: any[] = pane?.getSelectedItems?.() || [];

    if (maybeItemsOrIDs.length && typeof maybeItemsOrIDs[0] === "number") {
      const ids = maybeItemsOrIDs as number[];
      items = ids.length ? await Zotero.Items.getAsync(ids) : [];
    } else {
      items = maybeItemsOrIDs;
    }

    log("zoteroFiles.getSelectedItems", {
      count: items.length,
      kinds: items.map(describeItem),
    });
  } catch (e) {
    error("zoteroFiles.getSelectedItems.fail", { message: String(e) });
  }

  if (items.length) return items;

  // Фолбэк: открытый PDF в Reader
  try {
    const zWin = Zotero.getMainWindow?.();
    const tab = zWin?.Zotero_Tabs?.getSelected?.();
    log("zoteroFiles.readerTab.inspect", {
      hasTabMgr: !!zWin?.Zotero_Tabs,
      tabType: tab?.type || null,
      tabData: !!tab?.data,
      readerItemID: tab?.data?.itemID || null,
    });
    if (tab?.type === "reader" && tab?.data?.itemID) {
      const readerItem = await Zotero.Items.getAsync(tab.data.itemID);
      if (readerItem) {
        log("zoteroFiles.readerTab.item", describeItem(readerItem));
        return [readerItem];
      }
    }
  } catch (e) {
    error("zoteroFiles.readerTab.fail", { message: String(e) });
  }

  log("zoteroFiles.getSelectedItems.empty", {});
  return [];
}

/** Вспомогательная диагностика для конкретного элемента: дети/вложения */
async function dumpItemDiagnostics(item: any, tag = "zoteroFiles.itemDiag") {
  try {
    const top = item?.isTopLevelItem?.() ? item : item?.getTopLevelItem?.();
    log(`${tag}.basic`, { item: describeItem(item), top: describeItem(top) });

    // Не трогаем getAttachments()/getChildren() у вложений
    if (!top || top.isAttachment?.()) {
      log(`${tag}.skip.attachmentsForAttachment`, { reason: "top is attachment or null" });
      return;
    }

    // Вложения
    const attIDs: number[] | undefined = await top.getAttachments?.();
    log(`${tag}.attachments.ids`, { count: attIDs?.length ?? 0 });

    if (attIDs?.length) {
      const atts = await Zotero.Items.getAsync(attIDs);
      log(`${tag}.attachments.meta`, { list: atts.map(describeItem) });
    }

    // Дети (на случай если getAttachments пуст)
    const childIDs: number[] | undefined = await top.getChildren?.();
    log(`${tag}.children.ids`, { count: childIDs?.length ?? 0 });

    if (childIDs?.length) {
      const children = await Zotero.Items.getAsync(childIDs);
      const attachments = children.filter((c: any) => c.isAttachment?.());
      log(`${tag}.children.meta`, {
        children: children.map(describeItem),
        attachments: attachments.map(describeItem),
      });
    }
  } catch (e) {
    warn(`${tag}.fail`, { message: String(e) });
  }
}

/** Найти первое PDF-вложение у элемента (или вернуть сам элемент, если это PDF-вложение) */
export async function findFirstPdfAttachment(item: any): Promise<any | null> {
  if (!item) return null;

  try {
    const isAtt = item.isAttachment?.();
    const mime = item.attachmentContentType;
    log("zoteroFiles.findFirstPdfAttachment.inspect", { item: describeItem(item) });

    if (isAtt && isPdfMime(mime)) {
      log("zoteroFiles.findFirstPdfAttachment.foundSelf", { itemKey: item?.key });
      return item;
    }

    // Берём верхний элемент и ищем его вложения
    const top = item.isTopLevelItem?.() ? item : item.getTopLevelItem?.();
    const topKey = top?.key || item?.key;

    // Если top — это вложение, дальше искать негде
    if (!top || top.isAttachment?.()) {
      warn("zoteroFiles.findFirstPdfAttachment.noTopOrIsAttachment", { itemKey: topKey });
      return null;
    }

    // 1) Через getAttachments()
    const attIDs: number[] | undefined = await top.getAttachments?.();
    log("zoteroFiles.findFirstPdfAttachment.attachments", {
      itemKey: topKey,
      attCount: attIDs?.length || 0,
      via: "getAttachments",
    });

    if (attIDs?.length) {
      const atts = await Zotero.Items.getAsync(attIDs);
      log("zoteroFiles.findFirstPdfAttachment.attMeta", { list: atts.map(describeItem) });
      const pdf1 = atts.find((a: any) => isPdfMime(a.attachmentContentType));
      if (pdf1) {
        log("zoteroFiles.findFirstPdfAttachment.pick", describeItem(pdf1));
        return pdf1;
      }
    }

    // 2) Фолбэк — через getChildren()
    const childIDs: number[] | undefined = await top.getChildren?.();
    log("zoteroFiles.findFirstPdfAttachment.children", {
      itemKey: topKey,
      childCount: childIDs?.length || 0,
      via: "getChildren",
    });

    if (childIDs?.length) {
      const children: any[] = await Zotero.Items.getAsync(childIDs);
      const attachments = children.filter((c: any) => c.isAttachment?.());
      log("zoteroFiles.findFirstPdfAttachment.childrenMeta", {
        attachments: attachments.map(describeItem),
      });
      const pdf2 = attachments.find((a: any) => isPdfMime(a.attachmentContentType));
      if (pdf2) {
        log("zoteroFiles.findFirstPdfAttachment.pickChild", describeItem(pdf2));
        return pdf2;
      }
    }

    warn("zoteroFiles.findFirstPdfAttachment.noPdfAmongAttachments", { itemKey: topKey });
    return null;
  } catch (e) {
    error("zoteroFiles.findFirstPdfAttachment.fail", {
      itemKey: item?.key,
      message: String(e),
    });
    return null;
  }
}

/** Получить путь к файлу вложения (совместимо с Zotero 6/7) */
export async function getAttachmentFilePath(attachment: any): Promise<string | null> {
  if (!attachment) return null;

  try {
    if (typeof attachment.getFilePathAsync === "function") {
      const p = await attachment.getFilePathAsync();
      log("zoteroFiles.getAttachmentFilePath.async", { attKey: attachment?.key, path: p });
      return p;
    }
    if (typeof attachment.getFilePath === "function") {
      const p = attachment.getFilePath();
      log("zoteroFiles.getAttachmentFilePath.sync", { attKey: attachment?.key, path: p });
      return p;
    }
    const path = attachment?.attachmentFilename || attachment?.getFilename?.();
    log("zoteroFiles.getAttachmentFilePath.fallbackName", { attKey: attachment?.key, path: path || null });
    return path || null;
  } catch (e) {
    error("zoteroFiles.getAttachmentFilePath.fail", {
      attKey: attachment?.key,
      message: String(e),
    });
    return null;
  }
}

// --- ЛОГИРОВАНИЕ: компактная статистика по base64 ---
function estimateBytesFromBase64Len(len: number, pad: number): number {
  // классическая оценка: floor(len * 3/4) - padding
  return Math.max(0, Math.floor((len * 3) / 4) - (pad || 0));
}

function base64PaddingCount(b64: string): number {
  const m = b64.match(/=+$/);
  return m ? m[0].length : 0;
}

function decodeHeadToHex(b64: string, bytes = 8): string {
  try {
    // декодируем первые ~12 base64-символов (даёт до 9 байт); берём bytes
    const headDecoded = atob(b64.slice(0, 16));
    const head = headDecoded.slice(0, bytes);
    return Array.from(head)
      .map(ch => ch.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
  } catch {
    return "";
  }
}

function logBase64Stats(tag: string, src: string, rawB64: string) {
  // rawB64 ожидается уже нормализованным
  const b64 = (rawB64 || "");
  const len = b64.length;
  const pad = base64PaddingCount(b64);
  const approxBytes = estimateBytesFromBase64Len(len, pad);
  const head = b64.slice(0, 16);
  const tail = b64.slice(-16);
  const startsWithJVBER = b64.startsWith("JVBER"); // %PDF-
  const whitespaceCount = ((rawB64 || "").match(/\s/g) || []).length;
  const invalidChars = (b64.match(/[^A-Za-z0-9+/=]/g) || []).length;
  const plusCount = (b64.match(/\+/g) || []).length;
  const spaceCount = ((rawB64 || "").match(/ /g) || []).length;
  const slashCount = (b64.match(/\//g) || []).length;
  const headHex = decodeHeadToHex(b64, 8);

  // Возможный индикатор "сломали base64 url-энкодингом": стало много пробелов, а плюсов мало
  const suspiciousPlusToSpace = spaceCount > 0 && plusCount === 0;

  log(tag, {
    src,                 // "dataURI" | "path" | "final"
    len,
    pad,
    approxBytes,
    head,
    tail,
    headHex,            // для %PDF- ожидаем "25 50 44 46 2d ..." ( "%PDF-" )
    startsWithJVBER,
    whitespaceCount,
    invalidChars,
    plusCount,
    slashCount,
    spaceCount,
    suspiciousPlusToSpace
  });
}

/**
 * Прочитать вложение в base64: сперва через attachmentDataURI, затем фолбэк на путь.
 * Строго нормализуем и валидируем base64, логируем статистику.
 */
async function readAttachmentToBase64(
  attachment: any
): Promise<{ base64: string; mime: string; filename: string } | null> {
  if (!attachment) return null;

  const filename: string =
    attachment.attachmentFilename ||
    attachment.getFilename?.() ||
    "document.pdf";

  const mime: string =
    attachment.attachmentContentType || "application/octet-stream";

  // --- Путь 1: через data URI (часто доступно в диалогах/без Node) ---
  try {
    const uri: string = await (attachment as any).attachmentDataURI;
    if (uri?.startsWith("data:")) {
      const { mime: detectedMime, base64 } = extractBase64FromDataURI(uri);
      assertAndExplainBase64(base64);
      if (isPdfMime(detectedMime) && !looksLikePdfBase64(base64)) {
        warn("zoteroFiles.readAttachment.dataURI.notPdfMagic", {
          attKey: attachment?.key,
          head: base64.slice(0, 10),
        });
      }
      logBase64Stats("zoteroFiles.readAttachment.dataURI.stats", "dataURI", base64);
      log("zoteroFiles.readAttachment.dataURI", {
        attKey: attachment?.key,
        used: true,
        mime: detectedMime,
        len: base64.length,
        base64Ok: true,
      });
      return { base64, mime: detectedMime, filename };
    }
  } catch (e) {
    warn("zoteroFiles.readAttachment.dataURI.fail", { message: String(e) });
  }

  // --- Путь 2: fallback — читаем файл по пути ---
  try {
    const path = await getAttachmentFilePath(attachment);
    if (!path) {
      warn("zoteroFiles.readAttachment.noPath", { attKey: attachment?.key });
      return null;
    }

    const rawB64 = await readFileAsBase64(path);
    const base64 = normalizeBase64(rawB64);

    assertAndExplainBase64(base64);
    if (isPdfMime(mime) && !looksLikePdfBase64(base64)) {
      warn("zoteroFiles.readAttachment.path.notPdfMagic", {
        attKey: attachment?.key,
        head: base64.slice(0, 10),
      });
    }

    logBase64Stats("zoteroFiles.readAttachment.path.stats", "path", base64);
    log("zoteroFiles.readAttachment.path", {
      attKey: attachment?.key,
      len: base64.length,
      base64Ok: true,
    });

    return { base64, mime, filename };
  } catch (e) {
    error("zoteroFiles.readAttachment.path.fail", {
      attKey: attachment?.key,
      message: String(e),
    });
    return null;
  }
}

/**
 * Загрузить PDF-вложение выбранного элемента как InputFile для OpenAI.
 * Возвращает null, если ничего не найдено/прочитано.
 */
export async function loadSelectedPdfAsInputFile(): Promise<InputFile | null> {
  const selected = await getSelectedItemsOrReaderItem();
  log("zoteroFiles.loadSelectedPdf.selectedCount", { count: selected.length });

  if (!selected.length) {
    warn("zoteroFiles.loadSelectedPdf.noSelection", {});
    return null;
  }

  // Берём первый подходящий элемент (включая вложение)
  const item = selected[0];
  log("zoteroFiles.loadSelectedPdf.item", describeItem(item));

  // Глубокая диагностика перед поиском PDF
  await dumpItemDiagnostics(item);

  const pdfAtt = await findFirstPdfAttachment(item);
  if (!pdfAtt) {
    warn("zoteroFiles.loadSelectedPdf.noPdf", { itemKey: item?.key });
    return null;
  }

  // Читаем данные вложения (dataURI → fallback на путь)
  const payload = await readAttachmentToBase64(pdfAtt);
  if (!payload || !payload.base64) {
    warn("zoteroFiles.loadSelectedPdf.emptyPayload", { attKey: pdfAtt?.key });
    return null;
  }

  const inputFile: InputFile = {
    file_data: payload.base64,   // ЧИСТЫЙ base64
    filename: payload.filename,  // пойдёт в `filename` в /v1/responses
  };

  // превью финального вида
  logBase64Stats("zoteroFiles.loadSelectedPdf.preview", "final", inputFile.file_data);

  log("zoteroFiles.loadSelectedPdf.done", {
    filename: inputFile.filename,
    base64Len: inputFile.file_data.length,
  });

  return inputFile;
}

/**
 * Универсальная обёртка: вернуть массив файлов (на будущее — мульти-PDF).
 * Сейчас — максимум один PDF из первого выбранного/открытого item’а.
 */
export async function loadSelectedPdfFiles(): Promise<InputFile[]> {
  const one = await loadSelectedPdfAsInputFile();
  return one ? [one] : [];
}
