const PROMPT_READY_EVENT = 'lanzo-pwa-ready';

let installedWindow = null;
let removeListeners = null;

export function stopAdminInstallPromptCapture() {
  removeListeners?.();
  removeListeners = null;
  installedWindow = null;
}

export function startAdminInstallPromptCapture(windowRef = window) {
  if (installedWindow === windowRef && removeListeners) return removeListeners;

  stopAdminInstallPromptCapture();
  installedWindow = windowRef;
  windowRef.deferredPwaPrompt = null;

  const handleBeforeInstallPrompt = (event) => {
    event.preventDefault();
    windowRef.deferredPwaPrompt = event;
    windowRef.dispatchEvent(new Event(PROMPT_READY_EVENT));
  };

  const handleAppInstalled = () => {
    windowRef.deferredPwaPrompt = null;
  };

  windowRef.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  windowRef.addEventListener('appinstalled', handleAppInstalled);

  removeListeners = () => {
    windowRef.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    windowRef.removeEventListener('appinstalled', handleAppInstalled);
  };

  return removeListeners;
}
