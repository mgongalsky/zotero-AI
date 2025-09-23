import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { createZToolkit } from "../utils/ztoolkit";

const state = new WeakMap<Window, { button?: XUL.Element }>();

export function registerAIPanelButton(win: _ZoteroTypes.MainWindow) {
  const tk = createZToolkit();
  const doc = win.document;

  // 1) Находим toolbar (несколько вариантов id на разных версиях/темах)
  const toolbar =
    (doc.getElementById("zotero-toolbar") as XUL.Element | null) ||
    (doc.getElementById("zotero-toolbar-main") as XUL.Element | null) ||
    (doc.querySelector('toolbar[id^="zotero-toolbar"]') as XUL.Element | null);

  if (!toolbar) {
    tk.log("AI Button: toolbar not found, skip");
    return;
  }

  // 2) Находим сам search (id тоже плавающий)
  const searchEl =
    (doc.getElementById("zotero-tb-search") as XUL.Element | null) ||
    (doc.querySelector('[id^="zotero-tb-"][id*="search"]') as XUL.Element | null) ||
    (doc.querySelector('search-textbox') as XUL.Element | null);

  // 3) Создаём кнопку
  const btn = tk.UI.createElement(doc, "toolbarbutton", {
    namespace: "xul",
    id: `${config.addonRef}-ai-button`,
    attributes: {
      class: "zotero-button",
      // для tooltip и label — и Fluent, и явный текст, чтоб что-то точно показалось
      "data-l10n-id": getLocaleID("ai-button-label"),
    },
    properties: {
      label: getString("ai-button-label"),
      tooltipText: getString("ai-button-label"),
      // если нет иконки — можно убрать image
      image: `chrome://${config.addonRef}/content/icons/ai.svg`,
      type: "button",
    },
    listeners: [
      {
        type: "command",
        listener: () => {
          new tk.ProgressWindow(getString("ai-popup-title"))
            .createLine({
              text: getString("ai-popup-body"),
              type: "default",
              progress: 100,
            })
            .startCloseTimer(4000)
            .show();
        },
      },
    ],
    styles: { marginInlineStart: "6px" },
  }) as XUL.Element;

  // 4) Вставляем: после поиска, либо в конец тулбара
  if (searchEl && searchEl.parentElement) {
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
