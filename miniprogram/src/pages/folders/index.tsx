/**
 * 小程序文件夹管理页
 *
 * 功能：列出 / 新建 / 删除文件夹
 * 复用 settings 页 topbar + settings-row 样式
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { getApi } from '../../state/auth';

interface Folder {
  id: string;
  name: string;
  icon: string | null;
  createdAt: string;
}

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getApi().get<{ folders: Folder[] }>('/folders');
      setFolders(r.folders);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useDidShow(() => {
    void load();
  });

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await getApi().post<{ id: string }>('/folders', { name });
      setFolders((prev) => [
        ...prev,
        { id: r.id, name, icon: null, createdAt: new Date().toISOString() },
      ]);
      setNewName('');
      Taro.showToast({ title: '已创建', icon: 'success' });
    } catch {
      Taro.showToast({ title: '创建失败', icon: 'none' });
    }
  };

  const handleDelete = async (folder: Folder) => {
    const r = await Taro.showModal({
      title: '删除文件夹',
      content: `确定删除「${folder.name}」？文件夹内的笔记不会被删除。`,
      confirmText: '删除',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      await getApi().delete(`/folders/${folder.id}`);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      Taro.showToast({ title: '已删除', icon: 'success' });
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  return (
    <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">文件夹管理</Text>
        <Text className="topbar-actions"></Text>
      </View>

      <View className="settings-group">
        <View className="folder-input-row">
          <Input
            className="folder-input"
            placeholder="新建文件夹名称…"
            value={newName}
            onInput={(e: any) => setNewName((e.detail as { value: string }).value)}
            onConfirm={() => void handleCreate()}
          />
          <Text
            className={`mint-btn mint-btn-sm${!newName.trim() ? ' mint-btn-disabled' : ''}`}
            onClick={() => void handleCreate()}
          >
            添加
          </Text>
        </View>
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">加载中…</View>}
        {!loading && folders.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">📁</Text>
            <Text className="empty-state-text">还没有文件夹</Text>
          </View>
        )}
        {folders.map((f) => (
          <View key={f.id} className="settings-row folder-row">
            <View className="settings-row-label">
              <Text>
                {f.icon ?? '📁'} {f.name}
              </Text>
            </View>
            <Text className="settings-row-value text-danger" onClick={() => void handleDelete(f)}>
              🗑️
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
