// src/hooks.ts
import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { registerChatNoteToolbarButton, unregisterChatNoteToolbarButton } from "./modules/chatNoteToolbar";
import { registerAIPanelButton, unregisterAIPanelButton } from "./modules/aiButton";
import { initChatNoteComposer } from "./ui/chatNoteComposer";

type MainWin = _ZoteroTypes.MainWindow;

declare const Zotero: any;
declare const addon: any;
declare const ztoolkit: any;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // наши кнопки
  await registerChatNoteToolbarButton();

  await Promise.all(Zotero.getMainWindows().map((win: MainWin) => onMainWindowLoad(win)));

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: MainWin): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);

  // вернуть старую AI кнопку (ChatGPT icon)
  registerAIPanelButton(win);


  // наш нижний композер
  initChatNoteComposer(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll?.();
  unregisterAIPanelButton(win);
  addon.data.dialog?.window?.close?.();
}

async function onShutdown() {
  ztoolkit.unregisterAll?.();
  await unregisterChatNoteToolbarButton();
  addon.data.dialog?.window?.close?.();

  addon.data.alive = false;
  // было: // @ts-expect-error
  delete (Zotero as any)[addon.data.config.addonInstance];
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) { /* no-op */ }

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      // если эта функция async — добавьте await
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(_type: string) { /* no-op */ }
function onDialogEvents(_type: string) { /* no-op */ }

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
