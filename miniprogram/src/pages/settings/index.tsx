/**
 * 小程序设置页
 *
 * 功能：
 * - 主题切换（浅色 / 暗色 / 跟随系统）—— 仅 H5 生效，weapp 持久化但不切换
 * - 清空缓存 —— 调用 Taro.clearStorageSync() 后跳转解锁页
 * - 导入导出 / 分享管理 / 修改密码 —— 占位提示「该功能即将上线」
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ThemeVars } from '../../components/ThemeVars';
import { useAuthStore, APP_VERSION, getApi } from '../../state/auth';
import { useThemeStore, type Theme } from '../../state/theme';
import { useModeStore } from '../../lib/mode-store';
import { getRepo, resetRepoCache } from '../../lib/get-repo';
import { clearStandaloneMasterKey } from '../../lib/standalone-session';
import { setup2fa, enable2fa, disable2fa, get2faStatus } from '../../lib/totp-client';
import { t, setLanguage, useLanguage, type Language } from '../../lib/i18n';

/** 微信 showModal 的 editable 输入框运行时可用，但 Taro 类型定义未跟上 */
interface EditableModalResult {
  confirm: boolean;
  content?: string;
}
const showEditableModal = (opts: {
  title: string;
  content?: string;
  placeholderText?: string;
  confirmText?: string;
  confirmColor?: string;
}): Promise<EditableModalResult> =>
  (Taro.showModal as unknown as (o: Record<string, unknown>) => Promise<EditableModalResult>)({
    ...opts,
    editable: true,
  });

/** 服务端设备列表项（GET /devices 返回结构） */
interface DeviceItem {  id: string;
  name: string;
  platform: string;
  isCurrent: boolean;
  lastActiveAt: string;
}

/** 项目 GitHub 仓库地址 */
const GITHUB_URL = 'https://github.com/Hermitweb/dustnote';

/** 主题词典 key（文案随语言切换） */
const THEME_KEY: Record<Theme, string> = {
  light: 'settings.theme_light',
  dark: 'settings.theme_dark',
  auto: 'settings.theme_auto',
};

export default function Settings() {
  const lock = useAuthStore((s) => s.lock);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const mode = useModeStore((s) => s.mode);
  const serverUrl = useModeStore((s) => s.serverUrl);
  const resetMode = useModeStore((s) => s.resetMode);
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const onThemeChange = async () => {
    try {
      const res = await Taro.showActionSheet({
        itemList: [t('settings.theme_light'), t('settings.theme_dark'), t('settings.theme_auto')],
      });
      const map: Theme[] = ['light', 'dark', 'auto'];
      const next = map[res.tapIndex];
      setTheme(next);
      useThemeStore.getState().refreshSystemTheme();
      Taro.showToast({
        title: t('settings.theme_switched', { theme: t(THEME_KEY[next]) }),
        icon: 'none',
      });
    } catch {
      /* 用户取消 */
    }
  };

  /** 语言切换：弹出选项（ActionSheet），选中后持久化并全局通知 */
  const onLanguageChange = async () => {
    try {
      const res = await Taro.showActionSheet({ itemList: ['简体中文', 'English'] });
      const next: Language = res.tapIndex === 1 ? 'en' : 'zh-CN';
      if (next !== lang) {
        setLanguage(next);
        Taro.showToast({ title: t('settings.language_switched'), icon: 'none' });
      }
    } catch {
      /* 用户取消 */
    }
  };

  const onClearCache = async () => {
    const confirm = await Taro.showModal({
      title: t('settings.clear_cache_title'),
      content: t('settings.clear_cache_content'),
      confirmText: t('settings.clear_btn'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      // 清空业务数据 + 鉴权数据 + 模式状态
      await getRepo().clearBusinessData();
      // 先锁(清零 masterKey/token)再清存储,防陈旧鉴权穿透到新模式
      lock();
      clearStandaloneMasterKey();
      resetRepoCache();
      resetMode();
      Taro.clearStorageSync();
      Taro.showToast({ title: t('settings.cleared'), icon: 'success' });
      // 重置后回到模式选择页
      setTimeout(() => Taro.reLaunch({ url: '/pages/mode-select/index' }), 600);
    } catch {
      Taro.showToast({ title: t('settings.clear_failed'), icon: 'none' });
    }
  };

  const changePassword = useAuthStore((s) => s.changePassword);

  // ========== 设备管理（联机模式，页面内浮层） ==========
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const openDevices = async () => {
    setDevicesOpen(true);
    setDevicesLoading(true);
    try {
      const r = await getApi().get<{ devices: DeviceItem[] }>('/devices');
      setDevices(r.devices ?? []);
    } catch {
      Taro.showToast({ title: t('settings.load_devices_failed'), icon: 'none' });
      setDevicesOpen(false);
    } finally {
      setDevicesLoading(false);
    }
  };

  const kickDevice = async (device: DeviceItem) => {
    const confirm = await Taro.showModal({
      title: t('settings.kick_title'),
      content: t('settings.kick_content', { name: device.name }),
      confirmText: t('settings.kick'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      await getApi().request('DELETE', `/devices/${device.id}`);
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
      Taro.showToast({ title: t('settings.kicked'), icon: 'success' });
    } catch {
      Taro.showToast({ title: t('settings.kick_failed'), icon: 'none' });
    }
  };

  // ========== 删除账户（联机模式，GDPR Article 17，两步确认） ==========
  const onDeleteAccount = async () => {
    const step1 = await Taro.showModal({
      title: t('settings.delete_account_title'),
      content: t('settings.delete_account_content'),
      confirmText: t('settings.continue_btn'),
      confirmColor: '#E07B6C',
    });
    if (!step1.confirm) return;
    const step2 = await Taro.showModal({
      title: t('settings.final_title'),
      content: t('settings.final_content'),
      confirmText: t('settings.confirm_delete'),
      confirmColor: '#E07B6C',
    });
    if (!step2.confirm) return;
    try {
      await getApi().request('DELETE', '/account', { confirm: true });
      Taro.showToast({ title: t('settings.account_deleted'), icon: 'success' });
      // 清本地数据 + 锁定 → 重新探测（服务端已无账户 → setup 页）
      try {
        await getRepo().clearBusinessData();
      } catch {
        /* 本地清理失败不阻塞 */
      }
      resetRepoCache();
      useAuthStore.getState().lock();
      setTimeout(() => {
        void useAuthStore.getState().init();
        Taro.reLaunch({ url: '/pages/index/index' });
      }, 600);
    } catch {
      Taro.showToast({ title: t('settings.delete_failed'), icon: 'none' });
    }
  };

  // 修改密码弹窗状态
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changing, setChanging] = useState(false);

  /** 打开修改密码弹窗（重置输入） */
  const onPwdOpen = () => {
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdOpen(true);
  };

  /** 提交修改密码：standalone 本地校验旧密码并重包装，online 走 /auth/rewrap */
  const onPwdSubmit = async () => {
    if (changing) return;
    if (!oldPwd) {
      Taro.showToast({ title: t('settings.err_current_pwd'), icon: 'none' });
      return;
    }
    if (newPwd.length < 6) {
      Taro.showToast({ title: t('settings.err_new_pwd_len'), icon: 'none' });
      return;
    }
    if (newPwd !== confirmPwd) {
      Taro.showToast({ title: t('settings.err_pwd_mismatch'), icon: 'none' });
      return;
    }
    setChanging(true);
    try {
      await changePassword(oldPwd, newPwd);
      setPwdOpen(false);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      Taro.showModal({
        title: t('settings.pwd_success_title'),
        content: t('settings.pwd_success_content'),
        showCancel: false,
        confirmText: t('common.ok'),
      });
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : t('settings.pwd_failed'),
        icon: 'none',
        duration: 3000,
      });
    } finally {
      setChanging(false);
    }
  };

  /** 复制 GitHub 仓库地址到剪贴板 */
  const onCopyGithub = () => {
    void Taro.setClipboardData({
      data: GITHUB_URL,
      success: () => Taro.showToast({ title: t('settings.repo_copied'), icon: 'none' }),
    });
  };

  const onExport = async () => {
    try {
      Taro.showLoading({ title: t('settings.exporting') });
      const payload = await getRepo().exportBackup();
      Taro.hideLoading();
      const json = JSON.stringify(payload, null, 2);
      if (process.env.TARO_ENV === 'h5') {
        // H5：触发浏览器文件下载
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dustnote-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Taro.showToast({ title: t('settings.export_ok'), icon: 'success' });
      } else {
        // weapp：复制到剪贴板
        await Taro.setClipboardData({ data: json });
        Taro.showToast({ title: t('settings.backup_copied'), icon: 'success' });
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: t('settings.export_failed'), icon: 'none' });
    }
  };

  const onImport = async () => {
    // H5 下用隐藏文件输入框，weapp 下用 Taro.chooseMessageFile
    if (process.env.TARO_ENV === 'h5') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (!data.notes || !Array.isArray(data.notes)) {
            Taro.showToast({ title: t('settings.invalid_backup'), icon: 'none' });
            return;
          }
          Taro.showLoading({ title: t('settings.importing') });
          await getRepo().importBackup(data);
          Taro.hideLoading();
          Taro.showToast({
            title: t('settings.imported_count', { count: data.notes.length }),
            icon: 'success',
          });
        } catch {
          Taro.hideLoading();
          Taro.showToast({ title: t('settings.parse_failed'), icon: 'none' });
        }
      };
      input.click();
    } else {
      Taro.showToast({ title: t('settings.import_unsupported'), icon: 'none' });
    }
  };

  /** 切换模式：重置模式状态，回到模式选择页 */
  const onSwitchMode = async () => {
    const confirm = await Taro.showModal({
      title: t('settings.switch_title'),
      content: t('settings.switch_content'),
      confirmText: t('common.confirm'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    // 重置 auth store（清零 masterKey/token,authState 回 needs_unlock）:
    // 否则陈旧的 authState/masterKey 穿透到新模式,以旧联机 key 给空库
    // 写入初始内容后设新密码 → 内容永久无法解密
    lock();
    clearStandaloneMasterKey();
    resetRepoCache();
    resetMode();
    Taro.reLaunch({ url: '/pages/mode-select/index' });
  };

  /** 修改服务器地址（联机模式）：showModal editable 输入，保存后立即生效 */
  const onChangeServerUrl = async () => {
    if (mode !== 'online') return;
    const current = useModeStore.getState().serverUrl ?? '';
    const modal = await showEditableModal({
      title: t('settings.server_url_title'),
      content: current,
      placeholderText: 'http(s)://your-server:port',
      confirmText: t('common.confirm'),
    });
    if (!modal.confirm) return;
    const next = (modal.content ?? '').trim().replace(/\/+$/, '');
    if (!next || !/^https?:\/\//i.test(next)) {
      Taro.showToast({ title: t('mode_select.err_server_prefix'), icon: 'none' });
      return;
    }
    useModeStore.getState().setServerUrl(next);
    Taro.showToast({ title: t('settings.server_url_saved'), icon: 'success' });
  };

  /** 自动锁屏：选择后台 N 分钟后锁定（0 = 关闭） */
  const AUTOLOCK_OPTIONS = ['0', '1', '5', '10', '30'];
  const onAutolock = async () => {
    const labels = AUTOLOCK_OPTIONS.map((m) =>
      m === '0' ? t('settings.autolock_off') : t('settings.autolock_minutes', { n: m }),
    );
    const r = await Taro.showActionSheet({ itemList: labels });
    const min = AUTOLOCK_OPTIONS[r.tapIndex] ?? '0';
    Taro.setStorageSync('dustnote_autolock_min', Number(min));
    Taro.showToast({ title: t('settings.autolock_saved'), icon: 'success' });
  };

  /** 两步验证（TOTP）：未开启 → 展示密钥并输入验证码开启；已开启 → 输码关闭 */
  const [totpBusy, setTotpBusy] = useState(false);
  const onTotp = async () => {
    if (totpBusy) return;
    setTotpBusy(true);
    try {
      const status = await get2faStatus();
      if (!status.enabled) {
        const setup = await setup2fa();
        const codeModal = await showEditableModal({
          title: t('settings.totp_setup_title'),
          content: `${t('settings.totp_secret')}: ${setup.secret}`,
          placeholderText: t('unlock.totp_placeholder'),
          confirmText: t('common.confirm'),
        });
        if (!codeModal.confirm) return;
        const code = (codeModal.content ?? '').trim();
        if (!code) return;
        const en = await enable2fa(code);
        Taro.showToast({
          title: en.enabled ? t('settings.totp_enabled') : t('common.unlock_failed'),
          icon: en.enabled ? 'success' : 'none',
        });
      } else {
        const modal = await showEditableModal({
          title: t('settings.totp_disable_title'),
          content: t('settings.totp_disable_hint'),
          placeholderText: t('unlock.totp_placeholder'),
          confirmText: t('common.confirm'),
          confirmColor: '#E07B6C',
        });
        if (!modal.confirm) return;
        const code = (modal.content ?? '').trim();
        if (!code) return;
        const dis = await disable2fa(code);
        Taro.showToast({
          title: dis.enabled ? t('common.unlock_failed') : t('settings.totp_disabled'),
          icon: dis.enabled ? 'none' : 'success',
        });
      }
    } catch (err) {
      Taro.showToast({ title: (err as Error).message || t('common.error'), icon: 'none' });
    } finally {
      setTotpBusy(false);
    }
  };

  return (
    <>
      <ThemeVars />
      <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">{t('settings.title')}</Text>
        <Text className="topbar-actions"></Text>
      </View>

      <View className="settings-group">
        <View className="settings-row" onClick={onThemeChange}>
          <View className="settings-row-label">
            <Text>{t('settings.theme')}</Text>
          </View>
          <Text className="settings-row-value">{t(THEME_KEY[theme])} ›</Text>
        </View>
        <View className="settings-row" onClick={onLanguageChange}>
          <View className="settings-row-label">
            <Text>{t('settings.language')}</Text>
          </View>
          <Text className="settings-row-value">{lang === 'en' ? 'English' : '简体中文'} ›</Text>
        </View>
        <View className="settings-row">
          <View className="settings-row-label">
            <Text>{t('settings.current_mode')}</Text>
          </View>
          <Text className="settings-row-value">
            {mode === 'standalone' ? t('settings.mode_standalone') : t('settings.mode_online')} ›
          </Text>
        </View>
        <View className="settings-row" onClick={onSwitchMode}>
          <View className="settings-row-label">
            <Text>{t('settings.switch_mode')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        {mode === 'online' && (
          <View className="settings-row" onClick={onChangeServerUrl}>
            <View className="settings-row-label">
              <Text>{t('settings.server_url_title')}</Text>
            </View>
            <Text className="settings-row-value">
              {serverUrl ? serverUrl.replace(/^https?:\/\//i, '') : '›'}
            </Text>
          </View>
        )}
        <View className="settings-row" onClick={onAutolock}>
          <View className="settings-row-label">
            <Text>{t('settings.autolock_title')}</Text>
          </View>
          <Text className="settings-row-value">
            {(() => {
              const m = String(Taro.getStorageSync('dustnote_autolock_min') || '0');
              return m === '0' ? t('settings.autolock_off') : t('settings.autolock_minutes', { n: m });
            })()} ›
          </Text>
        </View>
        {mode === 'online' && (
          <View className="settings-row" onClick={onTotp}>
            <View className="settings-row-label">
              <Text>{t('settings.totp_title')}</Text>
            </View>
            <Text className="settings-row-value">›</Text>
          </View>
        )}
        <View className="settings-row" onClick={onExport}>
          <View className="settings-row-label">
            <Text>{t('settings.export_backup')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onImport}>
          <View className="settings-row-label">
            <Text>{t('settings.import_backup')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        {mode === 'online' && (
          <View
            className="settings-row"
            onClick={() => {
              Taro.navigateTo({ url: '/pages/share-mgr/index' }).catch(() => {});
            }}
          >
            <View className="settings-row-label">
              <Text>{t('settings.share_mgmt')}</Text>
            </View>
            <Text className="settings-row-value">›</Text>
          </View>
        )}
        {mode === 'online' && (
          <View className="settings-row" onClick={() => void openDevices()}>
            <View className="settings-row-label">
              <Text>{t('settings.device_mgmt')}</Text>
            </View>
            <Text className="settings-row-value">›</Text>
          </View>
        )}
        <View
          className="settings-row"
          onClick={() => {
            Taro.navigateTo({ url: '/pages/folders/index' }).catch(() => {});
          }}
        >
          <View className="settings-row-label">
            <Text>{t('settings.folder_mgmt')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View
          className="settings-row"
          onClick={() => {
            Taro.navigateTo({ url: '/pages/trash/index' }).catch(() => {});
          }}
        >
          <View className="settings-row-label">
            <Text>{t('settings.trash')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onPwdOpen}>
          <View className="settings-row-label">
            <Text>{t('settings.change_pwd')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onClearCache}>
          <View className="settings-row-label">
            <Text>{t('settings.clear_cache')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        {mode === 'online' && (
          <View className="settings-row" onClick={() => void onDeleteAccount()}>
            <View className="settings-row-label">
              <Text className="text-danger">{t('settings.delete_account')}</Text>
            </View>
            <Text className="settings-row-value">›</Text>
          </View>
        )}
        <View
          className="settings-row"
          onClick={() => {
            lock();
            Taro.reLaunch({ url: '/pages/index/index' });
          }}
        >
          <View className="settings-row-label">
            <Text className="text-danger">{t('settings.lock')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
      </View>

      <View className="settings-group">
        <View className="settings-row" onClick={onCopyGithub}>
          <View className="settings-row-label">
            <Text>🐙 GitHub</Text>
          </View>
          <Text className="settings-row-value">Hermitweb/dustnote ›</Text>
        </View>
        <View
          className="settings-row"
          onClick={() => {
            Taro.showModal({
              title: t('settings.license_title'),
              content: t('settings.license_content'),
              showCancel: false,
              confirmText: t('common.ok'),
            });
          }}
        >
          <View className="settings-row-label">
            <Text>{t('settings.license')}</Text>
          </View>
          <Text className="settings-row-value">MIT ›</Text>
        </View>
        <View
          className="settings-row"
          onClick={() => {
            // 体验版/开发版没有版本管理,getUpdateManager 不生效——明确反馈而非无响应
            if (typeof Taro.getUpdateManager !== 'function') {
              Taro.showToast({ title: t('settings.update_unavailable'), icon: 'none' });
              return;
            }
            const um = Taro.getUpdateManager();
            um.onUpdateReady(() => {
              Taro.showModal({
                title: t('settings.update_ready_title'),
                content: t('settings.update_ready_content'),
                success: (r) => {
                  if (r.confirm) um.applyUpdate();
                },
              });
            });
            um.onUpdateFailed(() => {
              Taro.showToast({ title: t('settings.update_failed'), icon: 'none' });
            });
            // Taro 类型未跟上的基础库方法:主动触发一次检查
            (um as unknown as { checkUpdate?: () => void }).checkUpdate?.();
            Taro.showToast({ title: t('settings.update_checking'), icon: 'none' });
          }}
        >
          <View className="settings-row-label">
            <Text>{t('settings.check_update')}</Text>
          </View>
          <Text className="settings-row-value">v{APP_VERSION} ›</Text>
        </View>
      </View>

      <View className="footer">
        <Text className="footer-text">{t('settings.footer_title', { version: APP_VERSION })}</Text>
        <Text className="footer-text">{t('settings.footer_e2e')}</Text>
        <Text className="footer-text">MIT License · {GITHUB_URL.replace('https://', '')}</Text>
      </View>
      {pwdOpen && (
        <View className="modal-mask" onClick={() => !changing && setPwdOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">{t('settings.pwd_title')}</Text>
            <Input
              className="mint-input"
              password
              placeholder={t('settings.pwd_current_placeholder')}
              value={oldPwd}
              onInput={(e) => setOldPwd((e.detail as { value: string }).value)}
            />
            <Input
              className="mint-input"
              password
              placeholder={t('settings.pwd_new_placeholder')}
              value={newPwd}
              onInput={(e) => setNewPwd((e.detail as { value: string }).value)}
            />
            <Input
              className="mint-input"
              password
              placeholder={t('settings.pwd_confirm_placeholder')}
              value={confirmPwd}
              onInput={(e) => setConfirmPwd((e.detail as { value: string }).value)}
            />
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => !changing && setPwdOpen(false)}
              >
                {t('common.cancel')}
              </View>
              <View
                className="mint-btn flex-1"
                style={{ opacity: changing ? 0.5 : 1 }}
                onClick={onPwdSubmit}
              >
                {changing ? t('settings.changing') : t('settings.confirm_change')}
              </View>
            </View>
          </View>
        </View>
      )}
      {devicesOpen && (
        <View className="modal-mask" onClick={() => setDevicesOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">{t('settings.devices_title')}</Text>
            {devicesLoading ? (
              <Text className="modal-text">{t('common.loading')}</Text>
            ) : devices.length === 0 ? (
              <Text className="modal-text">{t('settings.no_devices')}</Text>
            ) : (
              <ScrollView scrollY style={{ maxHeight: '500rpx' }}>
                {devices.map((d) => (
                  <View key={d.id} className="device-item">
                    <View className="device-item-info">
                      <Text className="device-item-name">
                        {d.name}
                        {d.isCurrent ? t('settings.current_tag') : ''}
                      </Text>
                      <Text className="device-item-meta">
                        {d.platform} · {new Date(d.lastActiveAt).toLocaleString()}
                      </Text>
                    </View>
                    {!d.isCurrent && (
                      <Text className="device-item-kick" onClick={() => void kickDevice(d)}>
                        {t('settings.kick')}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => setDevicesOpen(false)}
              >
                {t('common.close')}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
    </>
  );
}
