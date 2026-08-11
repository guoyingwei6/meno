import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PwaInstallContextValue {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  showIOSPrompt: boolean;
  install: () => Promise<boolean>;
  dismissIOSPrompt: () => void;
}

const IOS_DISMISSED_KEY = 'meno:pwa-ios-dismissed';

const defaultContext: PwaInstallContextValue = {
  isInstallable: false,
  isInstalled: false,
  isIOS: false,
  showIOSPrompt: false,
  install: async () => false,
  dismissIOSPrompt: () => {},
};

const PwaInstallContext = createContext<PwaInstallContextValue>(defaultContext);

const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
};

const isIOSDevice = () =>
  typeof window !== 'undefined' &&
  /iPad|iPhone|iPod/.test(window.navigator.userAgent) &&
  !(window as Window & { MSStream?: unknown }).MSStream;

export const PwaInstallProvider = ({ children }: { children: ReactNode }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosPromptVisible, setIosPromptVisible] = useState(false);

  useEffect(() => {
    const standalone = isStandalone();
    setInstalled(standalone);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (isIOSDevice() && !standalone) {
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(IOS_DISMISSED_KEY) === 'true';
      } catch {
        // Storage can be unavailable in restricted browsing modes.
      }
      if (!dismissed) setIosPromptVisible(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('Meno PWA 安装失败', error);
      return false;
    }
  };

  const dismissIOSPrompt = () => {
    setIosPromptVisible(false);
    try {
      window.localStorage.setItem(IOS_DISMISSED_KEY, 'true');
    } catch {
      // Storage can be unavailable in restricted browsing modes.
    }
  };

  return (
    <PwaInstallContext.Provider
      value={{
        isInstallable: deferredPrompt !== null,
        isInstalled: installed,
        isIOS: isIOSDevice(),
        showIOSPrompt: iosPromptVisible,
        install,
        dismissIOSPrompt,
      }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
};

export const usePwaInstall = () => useContext(PwaInstallContext);
