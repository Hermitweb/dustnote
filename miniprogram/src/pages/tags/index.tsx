/**
 * 小程序标签管理页
 *
 * 功能：列出 / 删除标签
 * 标签由笔记内容聚合，不支持直接新建（在笔记编辑中添加 # 标签）
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { getApi } from '../../state/auth';

interface Tag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export default function Tags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getApi().get<{ tags: Tag[] }>('/tags');
      setTags(r.tags);
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

  const handleDelete = async (tag: Tag) => {
    const r = await Taro.showModal({
      title: '删除标签',
      content: `确定删除「#${tag.name}」？该标签会从所有笔记中移除。`,
      confirmText: '删除',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    try {
      await getApi().delete(`/tags/${tag.id}`);
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
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
        <Text className="topbar-title">标签管理</Text>
        <Text className="topbar-actions"></Text>
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">加载中…</View>}
        {!loading && tags.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">🏷️</Text>
            <Text className="empty-state-text">还没有标签</Text>
            <Text className="empty-state-hint">在笔记中添加 # 标签后会自动聚合到这里</Text>
          </View>
        )}
        {tags.map((t) => (
          <View key={t.id} className="settings-row tag-row">
            <View className="settings-row-label">
              <Text className="tag-hash">#</Text>
              <Text>{t.name}</Text>
            </View>
            <View className="settings-row-value">
              <Text className="tag-count">{t.count}</Text>
              <Text className="tag-delete" onClick={() => void handleDelete(t)}>
                🗑️
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
