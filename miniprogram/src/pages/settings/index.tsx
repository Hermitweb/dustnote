/**
 * 小程序设置页
 *
 * 功能：
 * - 主题切换（浅色 / 暗色 / 跟随系统）—— 仅 H5 生效，weapp 持久化但不切换
 * - 清空缓存 —— 调用 Taro.clearStorageSync() 后跳转解锁页
 * - 导入导出 / 分享管理 / 修改密码 —— 占位提示「该功能即将上线」
 */
import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAuthStore, getApi } from '../../state/auth';
import { useThemeStore, type Theme } from '../../state/theme';

const THEME_LABEL: Record<Theme, string> = {
  light: '浅色',
  dark: '暗色',
  auto: '跟随系统',
};

export default function Settings() {
  const lock = useAuthStore((s) => s.lock);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const onThemeChange = async () => {
    try {
      const res = await Taro.showActionSheet({
        itemList: ['浅色', '暗色', '跟随系统'],
      });
      const map: Theme[] = ['light', 'dark', 'auto'];
      const next = map[res.tapIndex];
      setTheme(next);
      Taro.showToast({ title: `已切换：${THEME_LABEL[next]}`, icon: 'none' });
    } catch { /* 用户取消 */ }
  };

  const onClearCache = async () => {
    const confirm = await Taro.showModal({
      title: '清空缓存',
      content: '将清除本地所有数据（含登录态），确定继续？',
      confirmText: '清空',
      confirmColor: '#E07B6C',
    });
    if (!confirm.confirm) return;
    try {
      Taro.clearStorageSync();
      Taro.showToast({ title: '已清空', icon: 'success' });
      setTimeout(() => Taro.reLaunch({ url: '/pages/unlock/index' }), 600);
    } catch {
      Taro.showToast({ title: '清空失败', icon: 'none' });
    }
  };

  const onNotImplemented = () => {
    Taro.showToast({ title: '该功能即将上线', icon: 'none' });
  };

  const onExport = async () => {
    try {
      Taro.showLoading({ title: '导出中…' });
      const data = await getApi().get<{ notes: any[]; folders: any[] }>('/export/backup');
      Taro.hideLoading();
      const json = JSON.stringify(data, null, 2);
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
          Taro.showToast({ title: `检测到 ${data.notes.length} 条笔记，暂不支持导入`, icon: 'none' });
        } catch {
          Taro.showToast({ title: '文件解析失败', icon: 'none' });
        }
      };
      input.click();
    } else {
      Taro.showToast({ title: '该功能即将上线', icon: 'none' });
    }
  };

  return (
    <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>←</Text>
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
        <View className="settings-row" onClick={() => {
          Taro.redirectTo({ url: '/pages/share-mgr/index' }).catch(() => {});
        }}>
          <View className="settings-row-label">
            <Text>🔗 分享管理</Text>
          </View>
          <Text className="settings-row-value">›</Text>
        </View>
        <View className="settings-row" onClick={onNotImplemented}>
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

      <View className="footer">
        <Text className="footer-text">DustNote · 尘心笔记 v0.1.0</Text>
        <Text className="footer-text">E2EE · 端到端加密</Text>
      </View>
    </View>
  );
}
