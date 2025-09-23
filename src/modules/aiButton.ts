import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { createZToolkit } from "../utils/ztoolkit";
import { openAIChatDialog } from "./aiChat";

const state = new WeakMap<Window, { button?: XUL.Element }>();

export function registerAIPanelButton(win: _ZoteroTypes.MainWindow) {
  const tk = createZToolkit();
  const doc = win.document;

  const id = `${config.addonRef}-ai-button`;
  // Дедупликация: убираем старую кнопку, если есть
  doc.getElementById(id)?.remove();

  // 1) Toolbar (разные ID на версиях/темах)
  const toolbar =
    (doc.getElementById("zotero-toolbar") as XUL.Element | null) ||
    (doc.getElementById("zotero-toolbar-main") as XUL.Element | null) ||
    (doc.querySelector('toolbar[id^="zotero-toolbar"]') as XUL.Element | null);

  if (!toolbar) {
    tk.log("AI Button: toolbar not found, skip");
    return;
  }

  // 2) Search (ID может отличаться)
  const searchEl =
    (doc.getElementById("zotero-tb-search") as XUL.Element | null) ||
    (doc.querySelector('[id^="zotero-tb-"][id*="search"]') as XUL.Element | null) ||
    (doc.querySelector("search-textbox") as XUL.Element | null);

  // 3) Кнопка
  const btn = tk.UI.createElement(doc, "toolbarbutton", {
    namespace: "xul",
    id,
    attributes: {
      class: "zotero-button",
      "data-l10n-id": getLocaleID("ai-button-label"),
    },
    properties: {
      label: getString("ai-button-label"),
      tooltipText: getString("ai-button-label"),
      image: `chrome://${config.addonRef}/content/icons/ai.svg`,
      type: "button",
    },
    listeners: [
      {
        type: "command",
        listener: () => openAIChatDialog(win),
      },
    ],
    styles: { marginInlineStart: "6px" },
  }) as XUL.Element;

  // 4) Вставка
  if (searchEl?.parentElement) {
    searchEl.insertAdjacentElement("afterend", btn);
  } else {
    toolbar.appendChild(btn);
    tk.log("AI Button: search not found, appended to toolbar");
  }

  state.set(win, { button: btn });
}

export function unregisterAIPanelButton(win: Window) {
  const s = state.get(win);
  if (s?.button?.parentElement) s.button.parentElement.removeChild(s.button);
  state.delete(win);
}
