// src/utils/chatNoteUi.ts
import { warn } from "./logger";

const ICON_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.8L5 14.5V11H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="currentColor"/>
    </svg>`
  );

type BtnSpec = {
  id: string;
  label: string;
  tooltip?: string;
  onCommand: () => void;
  iconDataUri?: string;
};

declare const Zotero: any;

function getToolbarElement(doc: Document | undefined): Element | null {
  if (!doc) return null;
  const candidates = ["zotero-toolbar", "zotero-items-toolbar", "zotero-collections-toolbar"];
  for (const id of candidates) {
    const el = doc.getElementById(id);
    if (el) return el;
  }
  return null;
}

export async function addToolbarButton(spec: BtnSpec) {
  const win = Zotero?.getMainWindow?.();
  const doc: Document | undefined = win?.document;
  const toolbar = getToolbarElement(doc);
  if (!doc || !toolbar) {
    warn("chatNoteUi.noToolbarFound");
    return;
  }
  if (doc.getElementById(spec.id)) return;

  const isXUL = !!(doc as any).createXULElement;
  const btn = isXUL ? (doc as any).createXULElement("toolbarbutton") : doc.createElement("toolbarbutton");

  btn.id = spec.id;
  btn.classList.add("toolbarbutton-1");
  btn.setAttribute("type", "button");
  btn.setAttribute("label", spec.label);
  btn.setAttribute("image", spec.iconDataUri || ICON_DATA_URI);
  if (spec.tooltip) btn.setAttribute("tooltiptext", spec.tooltip);

  const handler = () => spec.onCommand();
  // ВАЖНО: подписываемся только на одно событие, чтобы не было двойных срабатываний
  if (isXUL) {
    btn.addEventListener("command", handler);
  } else {
    btn.addEventListener("click", handler);
  }

  toolbar.appendChild(btn);
}

export async function removeToolbarButton(id: string) {
  const win = Zotero?.getMainWindow?.();
  const doc: Document | undefined = win?.document;
  const btn = doc?.getElementById(id);
  if (btn && btn.parentElement) btn.parentElement.removeChild(btn);
}

export function getActiveParentItem(): any | null {
  const win = Zotero?.getMainWindow?.();
  const ZoteroPane = win?.ZoteroPane;
  const selected: any[] = ZoteroPane?.getSelectedItems?.() ?? [];
  if (!selected?.length) return null;

  let it = selected[0];
  try {
    if (it.isAttachment?.()) it = it.parentItem;
    if (it.isNote?.()) it = it.parentItem;
  } catch {;}
  if (!it || it.isAttachment?.() || it.isNote?.()) return null;
  return it;
}
