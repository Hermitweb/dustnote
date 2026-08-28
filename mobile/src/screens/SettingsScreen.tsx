/**
 * 设置页（v2.0.0 双模式架构）
 *
 * 功能：
 * - 外观：主题模式切换（light/dark/auto，持久化到 AsyncStorage）
 * - 模式：显示当前模式 + 切换模式（含数据迁移）
 * - 数据：导入 / 导出（基于 DataRepository.exportBackup / importBackup）
 *   - 导出：生成 JSON → 写入 RNFS → 通过 Share 分享文件
 *   - 导入：从剪贴板粘贴 JSON → 解析 → 调用 importBackup 覆盖式导入
 * - 账户：锁定
 * - 关于：版本号、加密算法、客户端类型
 *
 * 单机模式不显示"分享管理"（无服务端）
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { useLanguageStore, type AppLanguage } from '../lib/i18n';
import { createRepository } from '../lib/repository';
import { useColors, useThemeStore, type ThemeMode, THEMES, type ThemeId } from '../theme';
import type { BackupPayload, AppMode, Preferences } from '@dustnote/shared';
import { decryptString, encryptString, type Ciphertext } from '@dustnote/shared';
import RNFS from 'react-native-fs';
import { Linking } from 'react-native';
import RNShare from 'react-native-share';
import DocumentPicker from 'react-native-document-picker';
import { APP_VERSION } from '../lib/version';
import { checkUpdateOnce, resetUpdateCache } from '../lib/use-update-check';
import { savePendingMigration, clearPendingMigration } from '../lib/migration';
import { clearLocalAuthBlob, clearLockoutState } from '../lib/local-auth-storage';
import { setup2fa, enable2fa, disable2fa, get2faStatus } from '../lib/totp-client';
import type { CheckUpdateResult } from '@dustnote/shared';
import { resolveBaseUrl } from '../lib/mode-store';

/** 服务端设备列表项（GET /devices 返回结构） */
interface DeviceItem {
  id: string;
  name: string;
  platform: string;
  isCurrent: boolean;
  lastActiveAt: string;
}

const LANG_OPTIONS: Array<{ lang: AppLanguage; key: string }> = [
  { lang: 'zh-CN', key: 'settings.lang_zh' },
  { lang: 'en', key: 'settings.lang_en' },
];

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const { t } = useTranslation();
  const lock = useAuthStore((s) => s.lock);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const themeId = useThemeStore((s) => s.themeId);
  const setThemeId = useThemeStore((s) => s.setThemeId);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const MODE_OPTIONS: Array<{ mode: ThemeMode; label: string }> = [
    { mode: 'light', label: t('settings.theme_light') },
    { mode: 'dark', label: t('settings.theme_dark') },
    { mode: 'auto', label: t('settings.theme_auto') },
  ];

  // 模式相关
  const appMode = useModeStore((s) => s.mode);
  const setAppMode = useModeStore((s) => s.setMode);
  const setServerUrl = useModeStore((s) => s.setServerUrl);
  const initialize = useModeStore((s) => s.initialize);
  const masterKey = useAuthStore((s) => s.masterKey);

  // 导入/导出 Modal
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [busy, setBusy] = useState(false);

  // 模式切换 Modal
  const [showSwitchMode, setShowSwitchMode] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<AppMode | null>(null);
  const [switchServerUrl, setSwitchServerUrl] = useState('');

  // 更新检查
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null);

  // 修改主密码 Modal
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  // 设备管理 Modal（联机模式）
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  // 删除账户（联机模式，GDPR Article 17）
  const [deleteBusy, setDeleteBusy] = useState(false);

  const styles = makeStyles(colors);

  // ========== 设备管理（联机模式） ==========
  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      const baseUrl = resolveBaseUrl();
      const token = useAuthStore.getState().accessToken;
      const r = await fetch(`${baseUrl}/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { devices: DeviceItem[] };
      setDevices(data.devices ?? []);
    } catch (err) {
      Alert.alert(
        t('settings.devices_load_failed'),
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setDevicesLoading(false);
    }
  };

  const openDevices = () => {
    setShowDevices(true);
    void loadDevices();
  };

  const kickDevice = (device: DeviceItem) => {
    Alert.alert(
      t('settings.device_kick'),
      t('settings.device_kick_confirm', { name: device.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.device_kick'),
          style: 'destructive',
          onPress: async () => {
            try {
              const baseUrl = resolveBaseUrl();
              const token = useAuthStore.getState().accessToken;
              const r = await fetch(`${baseUrl}/devices/${device.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              setDevices((prev) => prev.filter((d) => d.id !== device.id));
              Alert.alert(t('settings.device_kicked'));
            } catch (err) {
              Alert.alert(
                t('settings.device_kick_failed'),
                err instanceof Error ? err.message : String(err)
              );
            }
          },
        },
      ]
    );
  };

  // ========== 删除账户（GDPR Article 17，两步确认） ==========
  const onDeleteAccountStep1 = () => {
    Alert.alert(t('settings.delete_account'), t('settings.delete_account_confirm_1'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: onDeleteAccountStep2 },
    ]);
  };

  const onDeleteAccountStep2 = () => {
    Alert.alert(t('settings.delete_account'), t('settings.delete_account_confirm_2'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.delete_account'),
        style: 'destructive',
        onPress: async () => {
          setDeleteBusy(true);
          try {
            const baseUrl = resolveBaseUrl();
            const token = useAuthStore.getState().accessToken;
            const r = await fetch(`${baseUrl}/account`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ confirm: true }),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            Alert.alert(t('settings.delete_account_success'));
            // 锁定清密钥 → 重新探测（服务端已无账户 → uninitialized → Setup 页）
            lock();
            void useAuthStore.getState().init();
          } catch (err) {
            Alert.alert(
              t('settings.delete_account_failed'),
              err instanceof Error ? err.message : String(err)
            );
          } finally {
            setDeleteBusy(false);
          }
        },
      },
    ]);
  };

  // ========== 更新检查 ==========
  const onCheckUpdate = async () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    setUpdateResult(null);
    resetUpdateCache();
    try {
      const r = await checkUpdateOnce();
      setUpdateResult(r);
      if (r.status === 'force_update' && r.updateUrl) {
        Alert.alert('发现新版本', `当前版本已过期，请升级到最新版本。\n\n${r.message ?? ''}`, [
          { text: '稍后', style: 'cancel' },
          { text: '去下载', onPress: () => void Linking.openURL(r.updateUrl!) },
        ]);
      } else if (r.hasUpdate && r.manifest) {
        const latest = r.manifest.latest.version;
        Alert.alert(
          '发现新版本',
          `最新版本：v${latest}\n当前版本：v${APP_VERSION}\n\n是否前往下载？`,
          [
            { text: '稍后', style: 'cancel' },
            {
              text: '去下载',
              onPress: () => {
                if (r.updateUrl) void Linking.openURL(r.updateUrl);
              },
            },
          ]
        );
      } else if (r.status === 'ok') {
        Alert.alert('已是最新版本', `当前版本：v${APP_VERSION}`);
      } else if (r.status === 'error') {
        Alert.alert('检查更新失败', r.message ?? '未知错误');
      }
    } finally {
      setUpdateChecking(false);
    }
  };

  // ========== 导出 ==========
  // 使用 react-native-share 分享真实 JSON 文件。
  // 注意：RN 内置 Share.share 在 Android 上只支持文本（message），无法分享文件，
  // 会导致生成只含无关文字的 TXT。RNShare 通过 FileProvider 分享 cache 目录下的文件。
  const onExport = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    setBusy(true);
    try {
      const repo = createRepository({
        mode: appMode,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });
      const payload = await repo.exportBackup();
      const json = JSON.stringify(payload, null, 2);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `dustnote-backup-${ts}.json`;
      // 写入缓存目录（RNShare 的 FileProvider 仅暴露 cache-path 与 Download/）
      const dir = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
      const path = `${dir}/${filename}`;
      await RNFS.writeFile(path, json, 'utf8');
      // 通过 react-native-share 打开分享面板，分享真实 .json 文件
      try {
        await RNShare.open({
          title: 'DustNote 备份',
          subject: `DustNote 数据备份 ${ts}`,
          url: `file://${path}`,
          type: 'application/json',
          filename,
          failOnCancel: false,
        });
      } catch (shareErr) {
        // 分享失败（非取消）：文件仍在缓存目录，提示用户
        Alert.alert(
          '已生成备份',
          `备份文件已生成：\n${filename}\n\n请通过分享菜单保存到云盘或本地。`
        );
      }
    } catch (err) {
      Alert.alert('导出失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ========== 导入 ==========
  const onImportConfirm = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    if (!importJson.trim()) {
      Alert.alert('提示', '请粘贴备份 JSON');
      return;
    }
    setBusy(true);
    try {
      const payload = JSON.parse(importJson) as BackupPayload;
      if (!payload.notes || !Array.isArray(payload.notes)) {
        throw new Error('无效的备份格式：缺少 notes 字段');
      }
      Alert.alert(
        '确认导入',
        `将覆盖当前所有数据：\n笔记 ${payload.notes.length} 条\n文件夹 ${payload.folders?.length ?? 0} 个\n标签 ${payload.tags?.length ?? 0} 个\n\n继续？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认导入',
            style: 'destructive',
            onPress: async () => {
              try {
                const repo = createRepository({
                  mode: appMode,
                  serverUrl: useModeStore.getState().serverUrl,
                  accessToken: useAuthStore.getState().accessToken,
                  deviceId: useAuthStore.getState().deviceId,
                });
                await repo.clearBusinessData();
                await repo.importBackup(payload);
                Alert.alert('导入成功', '数据已恢复，请重新加载应用', [
                  {
                    text: '确定',
                    onPress: () => {
                      setShowImport(false);
                      setImportJson('');
                      // 重新加载数据（通过锁定 + 解锁流程）；
                      // 单机模式无 'Unlock' 路由，必须按 appMode 选择，否则导航中断
                      lock();
                      navigation.reset({
                        index: 0,
                        routes: [
                          {
                            name:
                              appMode === 'standalone' ? ('StandaloneUnlock' as never) : 'Unlock',
                          },
                        ],
                      });
                    },
                  },
                ]);
              } catch (err) {
                Alert.alert('导入失败', (err as Error).message);
              } finally {
                setBusy(false);
              }
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('解析失败', `JSON 格式错误：${(err as Error).message}`);
      setBusy(false);
    }
  };

  // ========== 导出为 Markdown ==========
  // 解密所有笔记，格式化为单个 .md 文件（每篇笔记以 # 标题 + --- 分隔）
  const onExportMarkdown = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    setBusy(true);
    try {
      const repo = createRepository({
        mode: appMode,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });
      const snapshot = await repo.loadAll();
      const activeNotes = snapshot.notes.filter((n) => !n.deletedAt);

      // 逐条解密，拼接为 Markdown
      const parts: string[] = [];
      let ok = 0;
      for (const note of activeNotes) {
        try {
          const env = JSON.parse(note.ciphertext) as
            | { v?: number; payload?: Ciphertext }
            | Ciphertext;
          const payload: Ciphertext =
            env && typeof env === 'object' && 'payload' in env ? env.payload! : (env as Ciphertext);
          const json = await decryptString(masterKey, payload);
          const pt = JSON.parse(json) as { title: string; content: string; tags?: string[] };
          const tagsLine =
            Array.isArray(pt.tags) && pt.tags.length > 0
              ? `\n\n> 标签：${pt.tags.map((t) => `#${t}`).join(' ')}`
              : '';
          parts.push(`# ${pt.title || '无标题'}\n\n${pt.content}${tagsLine}\n\n---\n`);
          ok++;
        } catch {
          // 解密失败的笔记跳过
        }
      }

      const md = parts.join('\n');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `dustnote-notes-${ts}.md`;
      const dir = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
      const path = `${dir}/${filename}`;
      // 添加 UTF-8 BOM 确保 Windows 记事本兼容
      await RNFS.writeFile(path, '\uFEFF' + md, 'utf8');

      try {
        await RNShare.open({
          title: 'DustNote 笔记导出',
          subject: `DustNote 笔记 ${ts}`,
          url: `file://${path}`,
          type: 'text/markdown',
          filename,
          failOnCancel: false,
        });
      } catch {
        Alert.alert('已生成文件', `Markdown 文件已生成：\n${filename}\n\n请通过分享菜单保存。`);
      }
      Alert.alert('导出成功', `共导出 ${ok} 篇笔记为 Markdown`);
    } catch (err) {
      Alert.alert('导出失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ========== 从文件导入 ==========
  // 支持 .json（备份文件）和 .md/.txt（Markdown 笔记）
  const onImportFile = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        copyTo: 'cachesDirectory',
      });
      if (!result || result.length === 0) return;
      const file = result[0];
      const content = await RNFS.readFile(file.fileCopyUri || file.uri, 'utf8');

      // 判断格式：JSON 备份 vs Markdown/TXT
      const trimmed = content.trim();
      if (trimmed.startsWith('{') && trimmed.includes('"notes"')) {
        // JSON 备份格式 — 走原有 importBackup 流程
        const payload = JSON.parse(trimmed) as BackupPayload;
        if (!payload.notes || !Array.isArray(payload.notes)) {
          throw new Error('无效的备份格式：缺少 notes 字段');
        }
        Alert.alert(
          '确认导入',
          `检测到 JSON 备份文件：\n笔记 ${payload.notes.length} 条\n\n将覆盖当前所有数据，继续？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '确认导入',
              style: 'destructive',
              onPress: async () => {
                setBusy(true);
                try {
                  const repo = createRepository({
                    mode: appMode,
                    serverUrl: useModeStore.getState().serverUrl,
                    accessToken: useAuthStore.getState().accessToken,
                    deviceId: useAuthStore.getState().deviceId,
                  });
                  await repo.clearBusinessData();
                  await repo.importBackup(payload);
                  Alert.alert('导入成功', '数据已恢复', [
                    {
                      text: '确定',
                      onPress: () => {
                        lock();
                        navigation.reset({
                          index: 0,
                          routes: [
                            {
                              name:
                                appMode === 'standalone' ? ('StandaloneUnlock' as never) : 'Unlock',
                            },
                          ],
                        });
                      },
                    },
                  ]);
                } catch (e) {
                  Alert.alert('导入失败', (e as Error).message);
                } finally {
                  setBusy(false);
                }
              },
            },
          ]
        );
      } else {
        // Markdown/TXT 格式 — 按 --- 分隔符拆分为多篇笔记
        const sections = content
          .split(/\n---+\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (sections.length === 0) {
          Alert.alert('导入失败', '文件内容为空');
          return;
        }
        Alert.alert(
          '确认导入',
          `检测到 Markdown 文件：\n将导入 ${sections.length} 篇笔记（追加，不覆盖现有数据）\n\n继续？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '确认导入',
              onPress: async () => {
                setBusy(true);
                try {
                  const repo = createRepository({
                    mode: appMode,
                    serverUrl: useModeStore.getState().serverUrl,
                    accessToken: useAuthStore.getState().accessToken,
                    deviceId: useAuthStore.getState().deviceId,
                  });
                  let imported = 0;
                  for (const section of sections) {
                    // 解析 Markdown：第一行 # 开头为标题，其余为正文
                    const lines = section.split('\n');
                    let title = '导入的笔记';
                    let contentStart = 0;
                    if (lines[0] && lines[0].startsWith('# ')) {
                      title = lines[0].slice(2).trim();
                      contentStart = 1;
                    }
                    // 跳过标题后的空行
                    while (contentStart < lines.length && lines[contentStart].trim() === '') {
                      contentStart++;
                    }
                    const noteContent = lines.slice(contentStart).join('\n').trim();
                    // 提取 > 标签：xxx 行中的标签
                    const tagMatch = noteContent.match(/>\s*标签：(.+)/);
                    let tags: string[] = [];
                    let cleanContent = noteContent;
                    if (tagMatch) {
                      tags = tagMatch[1]
                        .split(/\s+/)
                        .map((t) => t.replace(/^#/, ''))
                        .filter(Boolean);
                      cleanContent = noteContent.replace(/>\s*标签：.+\n?/, '').trim();
                    }
                    const json = JSON.stringify({ title, content: cleanContent, tags });
                    // 加密并创建笔记（createNote 直接接受 ciphertext）
                    const payload = await encryptString(masterKey, json, 1);
                    const env = { v: 1, payload };
                    await repo.createNote({
                      ciphertext: JSON.stringify(env),
                      keyVersion: 1,
                      folderId: null,
                    });
                    imported++;
                  }
                  Alert.alert('导入成功', `共导入 ${imported} 篇笔记`);
                } catch (e) {
                  Alert.alert('导入失败', (e as Error).message);
                } finally {
                  setBusy(false);
                }
              },
            },
          ]
        );
      }
    } catch (err) {
      if (DocumentPicker.isCancel(err)) return;
      Alert.alert('文件读取失败', (err as Error).message);
    }
  };

  // ========== 模式切换 ==========
  // v2.4.4 修复「迁移后密文不可解密」：
  // 旧流程在 importBackup 后 lock() 清空 masterKey，新模式 setup/unlock 生成新 masterKey，
  // 导入的密文绑定旧 masterKey → 全部 🔒 解密失败。
  // 新流程（延迟迁移，DM-7 原子化）：
  // 1. 导出备份 → 把旧 masterKey 副本放入内存 pending + 备份持久化到 AsyncStorage
  // 2. 切换模式 + lock()（所有可能失败的步骤都发生在切换之前 → 失败可回滚到原模式）
  // 3. 新模式 setup / unlock / recover 成功后（auth store 内）自动导入待迁移数据，
  //    并用新模式 masterKey 重加密 —— 迁移后所有笔记可正常解密，不出现「🔒 解密失败」。
  const onSwitchModeConfirm = async () => {
    if (!masterKey) {
      Alert.alert('提示', '请先解锁');
      return;
    }
    if (!switchTarget) {
      Alert.alert('提示', '请选择目标模式');
      return;
    }
    if (switchTarget === 'online' && !switchServerUrl.trim()) {
      Alert.alert('提示', '联机模式需要填写服务器地址');
      return;
    }
    if (switchTarget === appMode) {
      Alert.alert('提示', '目标模式与当前模式相同');
      return;
    }
    setBusy(true);
    try {
      // 1. 导出当前模式数据（失败则中止，未做任何变更）
      const oldRepo = createRepository({
        mode: appMode,
        serverUrl: useModeStore.getState().serverUrl,
        accessToken: useAuthStore.getState().accessToken,
        deviceId: useAuthStore.getState().deviceId,
      });
      const backup = await oldRepo.exportBackup();

      // 2. 保留旧 masterKey（内存副本，lock() 不清除它）+ 备份持久化（失败则中止）
      useAuthStore.getState().setPendingMasterKey(masterKey);
      await savePendingMigration(backup, useAuthStore.getState().userId);

      // 3. 更新模式状态（此后不可回退，但所有可能失败的步骤都已过去）
      setAppMode(switchTarget);
      if (switchTarget === 'online') {
        setServerUrl(switchServerUrl.trim());
      } else {
        setServerUrl(null);
      }
      initialize();

      setShowSwitchMode(false);
      setSwitchTarget(null);
      setSwitchServerUrl('');

      // 4. 锁定并重新探测目标模式的鉴权状态（App.tsx 据此自动路由到 Setup / Unlock）
      lock();
      void useAuthStore.getState().init();

      Alert.alert(
        '切换成功',
        `已切换到${switchTarget === 'online' ? '联机' : '单机'}模式。\n\n数据将在解锁 / 设置主密码后自动迁移（笔记、文件夹、标签、偏好）。`,
        [{ text: '确定' }]
      );
    } catch (err) {
      // 失败：模式未变更，数据未受影响（DM-7 原子化回滚）
      Alert.alert('切换失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ========== 修改主密码 ==========
  const onChangePasswordSubmit = async () => {
    if (!pwCurrent.trim() || !pwNew.trim()) {
      Alert.alert('提示', '请输入当前密码和新密码');
      return;
    }
    if (pwNew.length < 8) {
      Alert.alert('提示', '新密码至少 8 位');
      return;
    }
    if (pwNew !== pwConfirm) {
      Alert.alert('提示', '两次输入的新密码不一致');
      return;
    }
    setPwBusy(true);
    try {
      const auth = useAuthStore.getState();
      if (appMode === 'online') {
        await auth.changePassword(pwCurrent, pwNew);
        Alert.alert('修改成功', '主密码已更新，历史笔记不受影响。');
      } else {
        const newCode = await auth.changePasswordStandalone(pwCurrent, pwNew);
        Alert.alert(
          '修改成功',
          `主密码已更新，历史笔记不受影响。\n\n⚠️ 新恢复码（请妥善保存，旧恢复码已失效）：\n\n${newCode}`
        );
      }
      setShowChangePassword(false);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (err) {
      Alert.alert('修改失败', (err as Error).message);
    } finally {
      setPwBusy(false);
    }
  };

  // ========== 清空数据 ==========

  // ========== 2FA / TOTP ==========
  const [show2fa, setShow2fa] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);

  // 加载2FA状态（联机模式）
  React.useEffect(() => {
    if (appMode !== 'online') return;
    get2faStatus().then((r) => setTotpEnabled(r.enabled)).catch(() => {});
  }, [appMode]);

  const onSetup2fa = async () => {
    setTotpBusy(true);
    try {
      const r = await setup2fa();
      setTotpSecret(r.secret);
      setTotpUri(r.uri);
    } catch (err) {
      Alert.alert('错误', (err as Error).message);
    } finally {
      setTotpBusy(false);
    }
  };

  const onEnable2fa = async () => {
    if (totpCode.length !== 6) { Alert.alert('提示', '请输入6位验证码'); return; }
    setTotpBusy(true);
    try {
      await enable2fa(totpCode);
      setTotpEnabled(true);
      setShow2fa(false);
      setTotpSecret('');
      setTotpCode('');
      Alert.alert('已启用', '两步验证已开启。下次解锁需输入验证码。');
    } catch (err) {
      Alert.alert('错误', (err as Error).message);
    } finally {
      setTotpBusy(false);
    }
  };

  const onDisable2fa = async () => {
    Alert.alert('关闭两步验证', '请输入当前验证码以确认关闭', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认',
        onPress: async () => {
          // 简化：复用 totpCode 状态
          if (totpCode.length !== 6) { Alert.alert('提示', '请输入6位验证码'); return; }
          setTotpBusy(true);
          try {
            await disable2fa(totpCode);
            setTotpEnabled(false);
            setTotpCode('');
            Alert.alert('已关闭', '两步验证已关闭。');
          } catch (err) {
            Alert.alert('错误', (err as Error).message);
          } finally {
            setTotpBusy(false);
          }
        },
      },
    ]);
  };

  // ========== 清空数据 ==========
  const onClearData = () => {
    Alert.alert('清空数据', '将删除全部笔记、文件夹、标签和偏好设置，且不可恢复。确定继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const repo = createRepository({
              mode: appMode,
              serverUrl: useModeStore.getState().serverUrl,
              accessToken: useAuthStore.getState().accessToken,
              deviceId: useAuthStore.getState().deviceId,
            });
            if (appMode === 'online') {
              // 服务端无批量清空接口，逐条永久删除 + 重置偏好
              const snapshot = await repo.loadAll();
              for (const n of snapshot.notes) {
                await repo.permanentDeleteNote(n.id);
              }
              const defaultPrefs: Preferences = {
                theme: 'mint-dawn',
                mode: 'auto',
                font: 'system',
                density: 'standard',
                autoLock: 15,
                language: 'zh-CN',
              };
              await repo.setPreferences(defaultPrefs).catch(() => undefined);
              Alert.alert('已清空', '所有笔记已删除');
            } else {
              await repo.clearBusinessData();
              // 单机模式：一并清空本地鉴权，回到首次设置
              await clearLocalAuthBlob();
              await clearLockoutState();
              await clearPendingMigration();
              lock();
              useAuthStore.setState({ pendingMasterKey: null, authState: 'uninitialized' });
              navigation.reset({
                index: 0,
                routes: [{ name: 'StandaloneSetup' as never }],
              });
            }
          } catch (err) {
            Alert.alert('清空失败', (err as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <Section title={t('settings.appearance')} colors={colors}>
        {/* 主题选择：6 主题（与 Web 端一致） */}
        <View style={styles.themeGrid}>
          {THEMES.map((opt) => {
            const active = themeId === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.themeChip,
                  active && {
                    backgroundColor: colors.accentSoft,
                    borderColor: colors.accent,
                  },
                ]}
                onPress={() => setThemeId(opt.id as ThemeId)}
              >
                <Text style={styles.themeEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.themeChipText,
                    active && { color: colors.accent, fontWeight: '700' },
                  ]}
                >
                  {opt.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* 模式：light / dark / auto */}
        <View style={styles.modeRow}>
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.mode;
            return (
              <TouchableOpacity
                key={opt.mode}
                style={[
                  styles.modeChip,
                  active && { backgroundColor: colors.mint600, borderColor: colors.mint600 },
                ]}
                onPress={() => setMode(opt.mode)}
              >
                <Text style={[styles.modeChipText, active && { color: 'white' }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section title={t('settings.language_section')} colors={colors}>
        <View style={styles.modeRow}>
          {LANG_OPTIONS.map((opt) => {
            const active = language === opt.lang;
            return (
              <TouchableOpacity
                key={opt.lang}
                style={[
                  styles.modeChip,
                  active && { backgroundColor: colors.mint600, borderColor: colors.mint600 },
                ]}
                onPress={() => setLanguage(opt.lang)}
              >
                <Text style={[styles.modeChipText, active && { color: 'white' }]}>
                  {t(opt.key)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section title={t('settings.app_mode_section')} colors={colors}>
        <Row
          label={t('settings.current_mode')}
          detail={
            appMode === 'standalone' ? t('settings.mode_standalone') : t('settings.mode_online')
          }
          colors={colors}
        />
        <Row
          label={t('settings.switch_mode')}
          onPress={() => {
            setSwitchTarget(appMode === 'standalone' ? 'online' : 'standalone');
            setSwitchServerUrl('');
            setShowSwitchMode(true);
          }}
          colors={colors}
        />
        <Text style={styles.modeHint}>{t('settings.switch_mode_hint')}</Text>
      </Section>

      <Section title={t('settings.data_section')} colors={colors}>
        <Row label={t('settings.export')} onPress={onExport} colors={colors} />
        <Row label="📄 导出为 Markdown" onPress={onExportMarkdown} colors={colors} />
        <Row
          label={t('settings.import')}
          onPress={() => {
            setImportJson('');
            setShowImport(true);
          }}
          colors={colors}
        />
        <Row label="📁 从文件导入 (.md/.txt/.json)" onPress={onImportFile} colors={colors} />
        <Text style={styles.modeHint}>{t('settings.data_hint')}</Text>
      </Section>

      <Section title={t('settings.account_section')} colors={colors}>
        <Row
          label="🔑 修改主密码"
          onPress={() => {
            setPwCurrent('');
            setPwNew('');
            setPwConfirm('');
            setShowChangePassword(true);
          }}
          colors={colors}
        />
        {appMode === 'online' && (
          <Row
            label={totpEnabled ? '🔒 两步验证（已开启）' : '🔓 两步验证（未开启）'}
            onPress={() => {
              if (totpEnabled) {
                setTotpCode('');
                onDisable2fa();
              } else {
                onSetup2fa();
                setShow2fa(true);
              }
            }}
            colors={colors}
          />
        )}
        {appMode === 'online' && (
          <Row
            label={t('settings.shares')}
            onPress={() => navigation.navigate('Shares')}
            colors={colors}
          />
        )}
        {appMode === 'online' && (
          <Row label={t('settings.devices')} onPress={openDevices} colors={colors} />
        )}
        <Row label="🧹 清空数据" onPress={onClearData} colors={colors} />
        {appMode === 'online' && (
          <Row
            label={t('settings.delete_account')}
            onPress={onDeleteAccountStep1}
            colors={colors}
            danger
          />
        )}
        <Row
          label={t('settings.lock')}
          onPress={() => {
            lock();
            navigation.reset({
              index: 0,
              routes: [
                { name: appMode === 'standalone' ? ('StandaloneUnlock' as never) : 'Unlock' },
              ],
            });
          }}
          colors={colors}
        />
      </Section>

      <Section title={t('settings.about_section')} colors={colors}>
        <Row label={t('settings.version')} detail={APP_VERSION} colors={colors} />
        <Row
          label={t('settings.encryption')}
          detail={t('settings.encryption_value')}
          colors={colors}
        />
        <Row label={t('settings.client')} detail={t('settings.client_value')} colors={colors} />
        <Row
          label={t('settings.mode_label')}
          detail={
            appMode === 'standalone'
              ? t('settings.mode_detail_standalone')
              : t('settings.mode_detail_online')
          }
          colors={colors}
        />
        {/* 更新检查（仅联机模式可用） */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => void onCheckUpdate()}
          disabled={updateChecking || appMode === 'standalone'}
        >
          <Text style={styles.rowLabel}>{updateChecking ? '检查更新中…' : '🔍 检查更新'}</Text>
          {appMode === 'standalone' ? (
            <Text style={styles.rowDetail}>单机模式不可用</Text>
          ) : updateResult?.status === 'ok' && updateResult.manifest ? (
            <Text style={styles.rowDetail}>最新 v{updateResult.manifest.latest.version}</Text>
          ) : (
            <Text style={styles.rowDetail}>›</Text>
          )}
        </TouchableOpacity>
      </Section>

      {/* 设备管理 Modal（联机模式） */}
      <Modal visible={showDevices} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('settings.devices')}</Text>
            <TouchableOpacity onPress={() => setShowDevices(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {devicesLoading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator color={colors.mint600} />
            </View>
          ) : (
            <ScrollView>
              {devices.length === 0 && (
                <Text style={[styles.modalHint, { textAlign: 'center', marginTop: 24 }]}>
                  {t('settings.devices_empty')}
                </Text>
              )}
              {devices.map((d) => (
                <View key={d.id} style={styles.deviceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceName}>
                      {d.name}
                      {d.isCurrent ? `（${t('settings.device_current')}）` : ''}
                    </Text>
                    <Text style={styles.deviceMeta}>
                      {d.platform} · {new Date(d.lastActiveAt).toLocaleString()}
                    </Text>
                  </View>
                  {!d.isCurrent && (
                    <TouchableOpacity style={styles.kickBtn} onPress={() => kickDevice(d)}>
                      <Text style={styles.kickBtnText}>{t('settings.device_kick')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* 导入 Modal */}
      <Modal visible={showImport} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>导入备份</Text>
            <TouchableOpacity onPress={() => setShowImport(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>粘贴备份 JSON 内容（导出时获得的 JSON 字符串）：</Text>
          <TextInput
            style={styles.modalInput}
            multiline
            textAlignVertical="top"
            placeholder='{"version":"2.0.0","notes":[...]...'
            value={importJson}
            onChangeText={setImportJson}
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity
            style={[styles.modalButton, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={onImportConfirm}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.modalButtonText}>确认导入（覆盖现有数据）</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 模式切换 Modal */}
      <Modal visible={showSwitchMode} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>切换模式</Text>
            <TouchableOpacity onPress={() => setShowSwitchMode(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            当前模式：{appMode === 'standalone' ? '单机' : '联机'}
            {'\n'}目标模式：
            {switchTarget === 'standalone' ? '单机（本地存储）' : '联机（服务器同步）'}
            {'\n\n'}将迁移所有数据（笔记、文件夹、标签、偏好）。
          </Text>
          <View style={styles.switchModeRow}>
            <TouchableOpacity
              style={[
                styles.switchModeChip,
                switchTarget === 'standalone' && {
                  backgroundColor: colors.mint600,
                  borderColor: colors.mint600,
                },
              ]}
              onPress={() => setSwitchTarget('standalone')}
            >
              <Text
                style={[
                  styles.switchModeChipText,
                  switchTarget === 'standalone' && { color: 'white' },
                ]}
              >
                📱 单机
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.switchModeChip,
                switchTarget === 'online' && {
                  backgroundColor: colors.mint600,
                  borderColor: colors.mint600,
                },
              ]}
              onPress={() => setSwitchTarget('online')}
            >
              <Text
                style={[styles.switchModeChipText, switchTarget === 'online' && { color: 'white' }]}
              >
                🌐 联机
              </Text>
            </TouchableOpacity>
          </View>
          {switchTarget === 'online' && (
            <TextInput
              style={styles.modalInput}
              placeholder="服务器地址 https://your-server.com"
              value={switchServerUrl}
              onChangeText={setSwitchServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholderTextColor={colors.muted}
            />
          )}
          <TouchableOpacity
            style={[styles.modalButton, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={onSwitchModeConfirm}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.modalButtonText}>迁移数据并切换</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 修改主密码 Modal */}
      <Modal visible={showChangePassword} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>修改主密码</Text>
            <TouchableOpacity onPress={() => setShowChangePassword(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            {appMode === 'online'
              ? '修改后仅密码包装变更，masterKey 与所有笔记密文不变，历史笔记照常可读。'
              : '修改后 masterKey 与所有笔记密文不变；将生成新恢复码，旧恢复码失效。'}
          </Text>
          <TextInput
            style={styles.pwInput}
            placeholder="当前主密码"
            secureTextEntry
            value={pwCurrent}
            onChangeText={setPwCurrent}
            placeholderTextColor={colors.muted}
          />
          <TextInput
            style={styles.pwInput}
            placeholder="新主密码（至少 8 位）"
            secureTextEntry
            value={pwNew}
            onChangeText={setPwNew}
            placeholderTextColor={colors.muted}
          />
          <TextInput
            style={styles.pwInput}
            placeholder="再次输入新主密码"
            secureTextEntry
            value={pwConfirm}
            onChangeText={setPwConfirm}
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity
            style={[styles.modalButton, pwBusy && { opacity: 0.5 }]}
            disabled={pwBusy}
            onPress={onChangePasswordSubmit}
          >
            {pwBusy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.modalButtonText}>确认修改</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* 2FA 设置 Modal */}
      <Modal visible={show2fa && !totpEnabled} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>设置两步验证</Text>
            <TouchableOpacity onPress={() => { setShow2fa(false); setTotpSecret(''); setTotpCode(''); }}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            使用 Google Authenticator、Authy 或 1Password 扫描以下密钥，输入6位验证码确认启用。
          </Text>
          {totpSecret ? (
            <>
              <View style={{ padding: 16, backgroundColor: colors.card, borderRadius: 8, marginVertical: 12 }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 14, color: colors.fg, textAlign: 'center', letterSpacing: 2 }}>
                  {totpSecret}
                </Text>
              </View>
              <Text style={[styles.modalHint, { marginBottom: 4 }]}>手动输入密钥或扫描二维码（如支持）</Text>
              <TextInput
                style={styles.pwInput}
                placeholder="输入6位验证码"
                keyboardType="number-pad"
                maxLength={6}
                value={totpCode}
                onChangeText={setTotpCode}
                placeholderTextColor={colors.muted}
              />
              <TouchableOpacity
                style={[styles.modalButton, totpCode.length !== 6 && styles.modalButtonDisabled]}
                onPress={onEnable2fa}
                disabled={totpBusy || totpCode.length !== 6}
              >
                {totpBusy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalButtonText}>确认启用</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator style={{ marginTop: 24 }} />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  detail,
  onPress,
  colors,
  danger,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
  danger?: boolean;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {detail && <Text style={styles.rowDetail}>{detail}</Text>}
    </TouchableOpacity>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    section: { padding: 16 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: c.muted,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    rowLabel: { fontSize: 15, color: c.fg },
    rowDetail: { fontSize: 13, color: c.muted },
    modeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 14,
      borderTopColor: c.border,
      borderTopWidth: 1,
    },
    modeChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    modeChipText: { fontSize: 13, color: c.fg },
    // 主题选择网格（2 列）
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 14,
    },
    themeChip: {
      width: '47%',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      gap: 8,
    },
    themeEmoji: { fontSize: 20 },
    themeChipText: { fontSize: 13, color: c.fg, flexShrink: 1 },
    modeHint: {
      fontSize: 12,
      color: c.muted,
      padding: 14,
      lineHeight: 18,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: c.bg,
      padding: 16,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.fg,
    },
    modalClose: {
      fontSize: 22,
      color: c.muted,
      paddingHorizontal: 8,
    },
    modalHint: {
      fontSize: 13,
      color: c.muted,
      lineHeight: 20,
      marginBottom: 12,
    },
    deviceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 12,
    },
    deviceName: {
      fontSize: 15,
      color: c.fg,
      fontWeight: '500',
    },
    deviceMeta: {
      fontSize: 12,
      color: c.muted,
      marginTop: 2,
    },
    kickBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: c.danger,
    },
    kickBtnText: {
      color: 'white',
      fontSize: 13,
    },
    modalInput: {
      flex: 1,
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 14,
      color: c.fg,
      marginBottom: 16,
      minHeight: 120,
    },
    modalButton: {
      backgroundColor: c.mint600,
      borderRadius: 8,
      padding: 16,
      alignItems: 'center',
    },
    modalButtonText: {
      color: 'white',
      fontSize: 15,
      fontWeight: '600',
    },
    switchModeRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
    },
    switchModeChip: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      alignItems: 'center',
    },
    switchModeChipText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.fg,
    },
    pwInput: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 14,
      fontSize: 15,
      color: c.fg,
      marginBottom: 12,
    },
  });
}
