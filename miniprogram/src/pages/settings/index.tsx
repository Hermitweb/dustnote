/**
 * 小程序设置页
 *
 * 功能：
 * - 主题切换（浅色 / 暗色 / 跟随系统）—— 仅 H5 生效，weapp 持久化但不切换
 * - 清空缓存 —— 调用 Taro.clearStorageSync() 后跳转解锁页
 * - 导入导出 / 分享管理 / 修改密码 —— 占位提示「该功能即将上线」
 */
import React, { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAuthStore, APP_VERSION } from '../../state/auth';
import { useThemeStore, type Theme } from '../../state/theme';
import { useModeStore } from '../../lib/mode-store';
import { getRepo, resetRepoCache } from '../../lib/get-repo';
import { clearStandaloneMasterKey } from '../../lib/standalone-session';

/** 项目 GitHub 仓库地址 */
const GITHUB_URL = 'https://github.com/Hermitweb/dustnote';

const THEME_LABEL: Record<Theme, string> = {
  light: '浅色',
  dark: '暗色',
  auto: '跟随系统',
};

export default function Settings() {
  const lock = useAuthStore((s) => s.lock);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const mode = useModeStore((s) => s.mode);
  const resetMode = useModeStore((s) => s.resetMode);

  const onThemeChange = async () => {
    try {
      const res = await Taro.showActionSheet({
        itemList: ['浅色', '暗色', '跟随系统'],
      });
      const map: Theme[] = ['light', 'dark', 'auto'];
      const next = map[res.tapIndex];
      setTheme(next);
      Taro.showToast({ title: `已切换：${THEME_LABEL[next]}`, icon: 'none' });
    } catch {
      /* 用户取消 */
    }
  };

  const onClearCache = async () => {
    const confirm = await Taro.showModal({
      title: '清空缓存',
      content: '将清除本地所有数据（含登录态和单机笔记），确定继续？',
      confirmText: '清空',
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      // 清空业务数据 + 鉴权数据 + 模式状态
      await getRepo().clearBusinessData();
      clearStandaloneMasterKey();
      resetRepoCache();
      resetMode();
      Taro.clearStorageSync();
      Taro.showToast({ title: '已清空', icon: 'success' });
      // 重置后回到模式选择页
      setTimeout(() => Taro.reLaunch({ url: '/pages/mode-select/index' }), 600);
    } catch {
      Taro.showToast({ title: '清空失败', icon: 'none' });
    }
  };

  const changePassword = useAuthStore((s) => s.changePassword);

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
      Taro.showToast({ title: '请输入当前密码', icon: 'none' });
      return;
    }
    if (newPwd.length < 8) {
      Taro.showToast({ title: '新密码至少 8 位', icon: 'none' });
      return;
    }
    if (newPwd !== confirmPwd) {
      Taro.showToast({ title: '两次新密码不一致', icon: 'none' });
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
        title: '修改成功',
        content: '主密码已更新，请牢记新密码。若忘记密码，可通过恢复码找回。',
        showCancel: false,
        confirmText: '知道了',
      });
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '修改失败',
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
      success: () => Taro.showToast({ title: '仓库地址已复制', icon: 'none' }),
    });
  };

  const onExport = async () => {
    try {
      Taro.showLoading({ title: '导出中…' });
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
        Taro.showToast({ title: '导出成功', icon: 'success' });
      } else {
        // weapp：复制到剪贴板
        await Taro.setClipboardData({ data: json });
        Taro.showToast({ title: '备份数据已复制到剪贴板', icon: 'success' });
      }
    } catch {
      Taro.hideLoading();
      Taro.showToast({ title: '导出失败', icon: 'none' });
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
            Taro.showToast({ title: '无效的备份文件', icon: 'none' });
            return;
          }
          Taro.showLoading({ title: '导入中…' });
          await getRepo().importBackup(data);
          Taro.hideLoading();
          Taro.showToast({ title: `已导入 ${data.notes.length} 条笔记`, icon: 'success' });
        } catch {
          Taro.hideLoading();
          Taro.showToast({ title: '文件解析失败', icon: 'none' });
        }
      };
      input.click();
    } else {
      Taro.showToast({ title: 'weapp 暂不支持导入，请使用 H5 版本', icon: 'none' });
    }
  };

  /** 切换模式：重置模式状态，回到模式选择页 */
  const onSwitchMode = async () => {
    const confirm = await Taro.showModal({
      title: '切换模式',
      content: '切换模式前请确保数据已导出备份。确定要切换到另一种模式吗？',
      confirmText: '确定',
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    clearStandaloneMasterKey();
    resetRepoCache();
    resetMode();
    Taro.reLaunch({ url: '/pages/mode-select/index' });
  };

  return (
    <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">设置</Text>
        <Text className="topbar-actions"></Text>
      </View>

      <View className="settings-group">
        <View className="settings-row" onClick={onThemeChange}>
          <View className="settings-row-label">
            <Text>🎨 主题切换</Text>
          </View>
          <Text className="settings-row-value">{THEME_LABEL[theme]} ›</Text>
        </View>
        <View className="settings-row">
          <View className="settings-row-label">
            <Text>📱 当前模式</Text>
          </View>
          <Text className="settings-row-value">
            {mode === 'standalone' ? '单机' : '联机'} ›
          </Text>
        </View>
        <View className="settings-row" onClick={onSwitchMode}>
          <View className="settings-row-label">
            <Text>🔄 切换模式</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onExport}>
          <View className="settings-row-label">
            <Text>📤 导出备份</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onImport}>
          <View className="settings-row-label">
            <Text>📥 导入备份</Text>
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
              <Text>🔗 分享管理</Text>
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
            <Text>📁 文件夹管理</Text>
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
            <Text>🗑️ 回收站</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onPwdOpen}>
          <View className="settings-row-label">
            <Text>🔑 修改密码</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onClearCache}>
          <View className="settings-row-label">
            <Text>🧹 清空缓存</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View
          className="settings-row"
          onClick={() => {
            lock();
            Taro.reLaunch({ url: '/pages/index/index' });
          }}
        >
          <View className="settings-row-label">
            <Text className="text-danger">🔒 锁定</Text>
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
              title: '开源协议',
              content:
                'DustNote 采用 MIT License 开源。\nCopyright (c) 2025 DustNote\n可自由使用、修改与分发，详见项目 LICENSE 文件。',
              showCancel: false,
              confirmText: '知道了',
            });
          }}
        >
          <View className="settings-row-label">
            <Text>📄 开源协议</Text>
          </View>
          <Text className="settings-row-value">MIT ›</Text>
        </View>
        <View className="settings-row">
          <View className="settings-row-label">
            <Text>🏷️ 版本</Text>
          </View>
          <Text className="settings-row-value">v{APP_VERSION}</Text>
        </View>
      </View>

      <View className="footer">
        <Text className="footer-text">DustNote · 尘心笔记 v{APP_VERSION}</Text>
        <Text className="footer-text">E2EE · 端到端加密 · 单机/联机双模式</Text>
        <Text className="footer-text">MIT License · {GITHUB_URL.replace('https://', '')}</Text>
      </View>
      {pwdOpen && (
        <View className="modal-mask" onClick={() => !changing && setPwdOpen(false)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">修改主密码</Text>
            <Input
              className="mint-input"
              password
              placeholder="当前密码"
              value={oldPwd}
              onInput={(e) => setOldPwd((e.detail as { value: string }).value)}
            />
            <Input
              className="mint-input"
              password
              placeholder="新密码（至少 8 位）"
              value={newPwd}
              onInput={(e) => setNewPwd((e.detail as { value: string }).value)}
            />
            <Input
              className="mint-input"
              password
              placeholder="确认新密码"
              value={confirmPwd}
              onInput={(e) => setConfirmPwd((e.detail as { value: string }).value)}
            />
            <View className="row gap-m">
              <View
                className="mint-btn mint-btn-ghost flex-1"
                onClick={() => !changing && setPwdOpen(false)}
              >
                取消
              </View>
              <View
                className="mint-btn flex-1"
                style={{ opacity: changing ? 0.5 : 1 }}
                onClick={onPwdSubmit}
              >
                {changing ? '修改中…' : '确认修改'}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
