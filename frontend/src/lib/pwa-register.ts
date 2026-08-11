import { registerSW } from 'virtual:pwa-register';

export const PWA_UPDATE_EVENT = 'meno:pwa-update';
export const PWA_OFFLINE_READY_EVENT = 'meno:pwa-offline-ready';

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

export const registerMenoServiceWorker = () => {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event(PWA_OFFLINE_READY_EVENT));
    },
    onRegisterError(error) {
      console.warn('Meno PWA Service Worker 注册失败', error);
    },
  });
};

export const reloadForUpdate = () => {
  void updateSW?.(true);
  window.location.reload();
};
