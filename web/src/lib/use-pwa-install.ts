/**
 * PWA 安装 Hook
 *
 * 监听 beforeinstallprompt 事件，在浏览器支持安装时暴露 install() 方法。
 * - canInstall: 浏览器是否已触发安装提示（用户尚未安装/拒绝）
 * - install(): 触发安装弹窗，返回用户是否同意安装
 * - installed: 是否已安装（standalone 模式或 appinstalled 事件）
 *
 * 使用场景：设置对话框中的"安装为应用"按钮
 */

import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !installed,
    installed,
    install,
  };
}
