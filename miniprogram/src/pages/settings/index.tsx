/**
 * 小程序设置页
 *
 * 功能：
 * - 主题切换（浅色 / 暗色 / 跟随系统）—— 仅 H5 生效，weapp 持久化但不切换
 * - 清空缓存 —— 调用 Taro.clearStorageSync() 后跳转解锁页
 * - 导入导出 / 分享管理 / 修改密码 —— 占位提示「该功能即将上线」
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { FInput } from '../../components/FInput';
import Taro from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { useAuthStore, APP_VERSION, getApi, decryptNote, parseEnvelope, encryptNote } from '../../state/auth';
import { noteAad } from '@dustnote/shared';
import { randomUuid } from '../../lib/uuid';
import { useThemeStore, type Theme } from '../../state/theme';
import { useModeStore } from '../../lib/mode-store';
import { getRepo, resetRepoCache } from '../../lib/get-repo';
import { getCachedPlain, putCachedPlain } from '../../lib/plain-cache';
import {
  savePendingMigration,
  loadPendingMigration,
} from '../../lib/migration';
import { clearStandaloneMasterKey } from '../../lib/standalone-session';
import { setup2fa, enable2fa, disable2fa, get2faStatus } from '../../lib/totp-client';
import { t, setLanguage, useLanguage, type Language } from '../../lib/i18n';
import { parseServerDate } from '../../lib/date-parse';
import {
  cacheMasterKeyForBiometric,
  isBiometricEnabled,
  isBiometricSupported,
  promptBiometric,
  setBiometricEnabled,
} from '../../lib/biometric';

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
  const masterKey = useAuthStore((s) => s.masterKey);
  const setPendingMasterKey = useAuthStore((s) => s.setPendingMasterKey);

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
      const newRecoveryCode = await changePassword(oldPwd, newPwd);
      setPwdOpen(false);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      if (newRecoveryCode) {
        // 单机模式：改密轮换了恢复码（旧码失效），必须让用户保存新码（对齐安卓端）
        void Taro.setClipboardData({ data: newRecoveryCode });
        Taro.showModal({
          title: t('settings.pwd_changed_standalone_title'),
          content: t('settings.pwd_changed_standalone_content', { code: newRecoveryCode }),
          showCancel: false,
          confirmText: t('common.ok'),
        });
      } else {
        Taro.showModal({
          title: t('settings.pwd_success_title'),
          content: t('settings.pwd_success_content'),
          showCancel: false,
          confirmText: t('common.ok'),
        });
      }
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

  /** 解密单条笔记（导出/标题复用），缓存优先，失败返回 null */
  const tryDecrypt = async (id: string, ciphertext: string) => {
    const cached = getCachedPlain(id, ciphertext);
    if (cached) return cached;
    const mk = useAuthStore.getState().masterKey;
    if (!mk) return null;
    try {
      const env = parseEnvelope(ciphertext);
      const aadUserId = useAuthStore.getState().userId ?? '';
      const pt = await decryptNote(mk, env, env.payload.a === 1 ? noteAad(id, aadUserId) : undefined);
      putCachedPlain(id, ciphertext, pt.title, pt.content, pt.tags);
      return pt;
    } catch {
      return null;
    }
  };

  /** 导出 Markdown：解密全库拼 md（与安卓端格式互认：# 标题 / > 标签： / --- 分隔） */
  const onExportMarkdown = async () => {
    if (!masterKey) {
      Taro.showToast({ title: t('common.need_unlock'), icon: 'none' });
      return;
    }
    try {
      Taro.showLoading({ title: t('settings.exporting') });
      const snapshot = await getRepo().loadAll();
      const parts: string[] = [];
      let ok = 0;
      for (const note of snapshot.notes as Array<{
        id: string;
        ciphertext: string;
        deletedAt?: string | null;
      }>) {
        if (note.deletedAt) continue;
        const pt = await tryDecrypt(note.id, note.ciphertext);
        if (!pt) continue;
        const tagsLine = pt.tags?.length
          ? '\n\n> 标签：' + pt.tags.map((tg) => '#' + tg).join(' ')
          : '';
        parts.push(
          '# ' + (pt.title || t('common.unnamed_note')) + '\n\n' + pt.content + tagsLine + '\n\n---\n'
        );
        ok++;
      }
      Taro.hideLoading();
      const md = parts.join('\n');
      if (process.env.TARO_ENV === 'h5') {
        // H5：UTF-8 BOM + 文件下载（Windows 记事本兼容，对齐安卓端）
        const blob = new Blob(['\uFEFF' + md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dustnote-notes-' + new Date().toISOString().slice(0, 10) + '.md';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // weapp 无文件分享能力：全文复制到剪贴板
        await Taro.setClipboardData({ data: md });
      }
      Taro.showToast({ title: t('settings.export_md_done', { count: ok }), icon: 'success' });
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: t('settings.export_failed'), icon: 'none' });
    }
  };

  /** JSON 备份导入（对齐安卓端：清空业务数据后恢复，完成回解锁页重新确认身份） */
  const importBackupJson = async (data: { notes: unknown[] }) => {
    const confirm = await Taro.showModal({
      title: t('settings.import_confirm_title'),
      content: t('settings.import_backup_content', { count: data.notes.length }),
      confirmText: t('common.confirm'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    Taro.showLoading({ title: t('settings.importing') });
    try {
      await getRepo().clearBusinessData();
      await getRepo().importBackup(data as never);
      Taro.hideLoading();
      lock();
      const mode = useModeStore.getState().mode;
      Taro.reLaunch({
        url: mode === 'standalone' ? '/pages/standalone-unlock/index' : '/pages/unlock/index',
      });
    } catch (err) {
      Taro.hideLoading();
      const msg =
        (err as { err?: { message?: string } })?.err?.message || t('settings.parse_failed');
      Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
    }
  };

  /** Markdown/TXT 导入：按 --- 分隔拆篇（# 标题 / > 标签：，与导出格式互认） */
  const importMarkdown = async (content: string) => {
    const sections = content
      .split(/\n---+\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sections.length === 0) {
      Taro.showToast({ title: t('settings.import_file_empty'), icon: 'none' });
      return;
    }
    const confirm = await Taro.showModal({
      title: t('settings.import_confirm_title'),
      content: t('settings.import_file_md_detail', { count: sections.length }),
      confirmText: t('common.confirm'),
    });
    if (!confirm.confirm) return;
    Taro.showLoading({ title: t('settings.importing') });
    try {
      const mk = useAuthStore.getState().masterKey;
      if (!mk) throw new Error(t('common.need_unlock'));
      const aadUserId = useAuthStore.getState().userId ?? '';
      let imported = 0;
      for (const section of sections) {
        const lines = section.split('\n');
        let title = t('settings.imported_note_title');
        let start = 0;
        if (lines[0]?.startsWith('# ')) {
          title = lines[0].slice(2).trim();
          start = 1;
        }
        while (start < lines.length && lines[start].trim() === '') start++;
        const body = lines.slice(start).join('\n').trim();
        const tagMatch = body.match(/>\s*标签：(.+)/);
        let tags: string[] = [];
        let clean = body;
        if (tagMatch) {
          tags = tagMatch[1]
            .split(/\s+/)
            .map((x) => x.replace(/^#/, ''))
            .filter(Boolean);
          clean = body.replace(/>\s*标签：.+\n?/, '').trim();
        }
        const noteId = randomUuid();
        const { json: cipherJson } = await encryptNote(
          mk,
          { title, content: clean, tags },
          noteAad(noteId, aadUserId)
        );
        await getRepo().createNote({
          id: noteId,
          ciphertext: cipherJson,
          keyVersion: 1,
          isPinned: false,
          isFavorite: false,
          folderId: null,
        });
        imported++;
      }
      Taro.hideLoading();
      Taro.showToast({
        title: t('settings.import_md_done', { count: imported }),
        icon: 'success',
      });
    } catch (err) {
      Taro.hideLoading();
      Taro.showToast({
        title: err instanceof Error ? err.message : t('settings.import_failed'),
        icon: 'none',
        duration: 3000,
      });
    }
  };

  /** 按内容路由导入：JSON 备份 vs Markdown/TXT */
  const routeImportContent = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"notes"')) {
      const data = JSON.parse(trimmed) as { notes: unknown[] };
      if (!Array.isArray(data.notes)) {
        Taro.showToast({ title: t('settings.invalid_backup'), icon: 'none' });
        return;
      }
      await importBackupJson(data);
    } else {
      await importMarkdown(text);
    }
  };

  const onImport = async () => {
    // H5 下用隐藏文件输入框，weapp 下用 Taro.chooseMessageFile
    if (process.env.TARO_ENV === 'h5') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.md,.txt';
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          await routeImportContent(text);
        } catch {
          Taro.showToast({ title: t('settings.parse_failed'), icon: 'none' });
        }
      };
      input.click();
    } else if (process.env.TARO_ENV === 'weapp' && typeof Taro.chooseMessageFile === 'function') {
      // weapp:从微信聊天记录选择文件(先把 .json/.md/.txt 发给任意聊天/文件传输助手)
      Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json', 'md', 'txt'],
        success: (res) => {
          const path = res.tempFiles?.[0]?.path;
          if (!path) return;
          Taro.getFileSystemManager().readFile({
            filePath: path,
            encoding: 'utf-8',
          success: async (readRes) => {
            try {
              await routeImportContent(String(readRes.data));
            } catch (err) {
              const msg =
                (err as { err?: { message?: string } })?.err?.message ||
                t('settings.parse_failed');
              Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
            }
          },
            fail: () => Taro.showToast({ title: t('settings.parse_failed'), icon: 'none' }),
          });
        },
        fail: () => undefined,
      });
    } else {
      Taro.showToast({ title: t('settings.import_unsupported'), icon: 'none' });
    }
  };

  /** 粘贴 JSON 导入（对齐安卓端 import Modal） */
  const onPasteImport = async () => {
    try {
      const res = await showEditableModal({
        title: t('settings.paste_import_title'),
        placeholderText: '{ "notes": [...] }',
      });
      if (!res.confirm || !res.content) return;
      const data = JSON.parse(res.content) as { notes: unknown[] };
      if (!data || !Array.isArray(data.notes)) {
        Taro.showToast({ title: t('settings.invalid_backup'), icon: 'none' });
        return;
      }
      await importBackupJson(data);
    } catch {
      Taro.showToast({ title: t('settings.parse_failed'), icon: 'none' });
    }
  };

  /** 切换模式：DM-7 延迟迁移（对齐安卓端）——低风险步骤先行 */
  const onSwitchMode = async () => {
    const confirm = await Taro.showModal({
      title: t('settings.switch_title'),
      content: t('settings.switch_content'),
      confirmText: t('common.confirm'),
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    // 1. 导出备份 + 暂存旧 masterKey + 持久化迁移槽（全部失败可回滚，不切换）
    try {
      Taro.showLoading({ title: t('settings.exporting') });
      const backup = await getRepo().exportBackup();
      savePendingMigration(backup, useAuthStore.getState().userId);
      setPendingMasterKey(useAuthStore.getState().masterKey);
      Taro.hideLoading();
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: t('settings.export_failed'), icon: 'none' });
      return;
    }
    // 2. 切换模式 + 锁定（新模式 setup/unlock 成功后 auth store 自动消费迁移槽，
    //    用新模式 masterKey 重加密导入——否则旧密文在新 key 下全部无法解密）
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

  // 指纹解锁（SOTER）：仅 weapp 且设备支持时显示；开启需当次指纹验证
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(isBiometricEnabled());
  useEffect(() => {
    void (async () => {
      const supported = await isBiometricSupported();
      setBioSupported(supported);
      if (!supported) setBioOn(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onToggleBiometric = async () => {
    if (bioOn) {
      setBiometricEnabled(false);
      setBioOn(false);
      return;
    }
    const ok = await promptBiometric();
    if (!ok) {
      Taro.showToast({ title: t('unlock.bio_failed'), icon: 'none' });
      return;
    }
    setBiometricEnabled(true);
    const mk = useAuthStore.getState().masterKey;
    if (mk) cacheMasterKeyForBiometric(mk);
    setBioOn(true);
    Taro.showToast({ title: t('settings.biometric_on'), icon: 'success' });
  };

  const onAutolock = async () => {
    const labels = AUTOLOCK_OPTIONS.map((m) =>
      m === '0' ? t('settings.autolock_off') : t('settings.autolock_minutes', { n: m }),
    );
    try {
      const r = await Taro.showActionSheet({ itemList: labels });
      const min = AUTOLOCK_OPTIONS[r.tapIndex] ?? '0';
      Taro.setStorageSync('dustnote_autolock_min', Number(min));
      Taro.showToast({ title: t('settings.autolock_saved'), icon: 'success' });
    } catch {
      /* 用户取消 showActionSheet 也会 reject，静默 */
    }
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

  const darkClass = useThemeDarkClass();
  return (
    <>
      <ThemeVars />
      <View className={`page ${darkClass}`}>
      <View className="topbar topbar-center">
        <Text className="topbar-title">{t('settings.title')}</Text>
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
        {process.env.TARO_ENV === 'weapp' && bioSupported && (
          <View className="settings-row" onClick={onToggleBiometric}>
            <View className="settings-row-label">
              <Text>{t('settings.biometric_row')}</Text>
            </View>
            <Text className="settings-row-value">{bioOn ? '✓' : '›'}</Text>
          </View>
        )}
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
        <View className="settings-row" onClick={onExportMarkdown}>
          <View className="settings-row-label">
            <Text>{t('settings.export_md_row')}</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onPasteImport}>
          <View className="settings-row-label">
            <Text>{t('settings.paste_import_row')}</Text>
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
            <FInput
              className="mint-input"
              password
              placeholder={t('settings.pwd_current_placeholder')}
              value={oldPwd}
              onInput={(e) => setOldPwd((e.detail as { value: string }).value)}
            />
            <FInput
              className="mint-input"
              password
              placeholder={t('settings.pwd_new_placeholder')}
              value={newPwd}
              onInput={(e) => setNewPwd((e.detail as { value: string }).value)}
            />
            <FInput
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
                        {d.platform} · {parseServerDate(d.lastActiveAt).toLocaleString()}
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
