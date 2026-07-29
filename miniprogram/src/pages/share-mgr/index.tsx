/**
 * 分享管理页 — 支持多选批量吊销
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { getApi } from '../../state/auth';

interface ShareItem {
  id: string;
  noteId: string;
  token: string;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  revoked: boolean;
  createdAt: string;
}

function isExpired(e: string | null): boolean {
  return e ? new Date(e).getTime() < Date.now() : false;
}

export default function Shares() {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getApi().get<{ shares: ShareItem[] }>('/shares');
      setShares(r.shares);
    } catch (err: any) {
      Taro.showToast({
        title: `加载失败：${err?.err?.message || err?.message || '未知错误'}`,
        icon: 'none',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enterSelect = useCallback((id: string) => {
    setSelecting(true);
    setSelectedIds(new Set([id]));
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (next.size === 0) setSelecting(false);
        return next;
      }
      next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    const active = shares.filter((s) => !s.revoked && !isExpired(s.expiresAt));
    if (selectedIds.size === active.length) {
      setSelecting(false);
      setSelectedIds(new Set());
    } else setSelectedIds(new Set(active.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.size, shares]);
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const batchRevoke = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const r = await Taro.showModal({
      title: '批量吊销',
      content: `确定吊销选中的 ${ids.length} 个分享？吊销后链接将失效。`,
      confirmText: '吊销',
      confirmColor: '#E07B6C',
    });
    if (!r.confirm) return;
    setBatchBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await getApi().delete(`/shares/${id}`);
        ok++;
      } catch {
        /* skip */
      }
    }
    setBatchBusy(false);
    Taro.showToast({ title: `已吊销 ${ok} 个分享`, icon: 'success' });
    exitSelect();
    await load();
  };

  const hasAllSelected =
    selectedIds.size > 0 &&
    selectedIds.size === shares.filter((s) => !s.revoked && !isExpired(s.expiresAt)).length;
  const selCount = selectedIds.size;

  return (
    <View className="page">
      <View className="topbar">
        {selecting ? (
          <>
            <Text className="topbar-back" onClick={exitSelect}>
              ✕
            </Text>
            <Text className="topbar-title" onClick={toggleAll}>
              {hasAllSelected ? '取消全选' : `全选 ${selCount ? `(${selCount})` : ''}`}
            </Text>
            <View className="topbar-actions" />
          </>
        ) : (
          <>
            <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
              ←
            </Text>
            <Text className="topbar-title">分享管理</Text>
            <View className="topbar-actions" />
          </>
        )}
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">加载中…</View>}
        {!loading && shares.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">🔗</Text>
            <Text className="empty-state-text">还没有分享</Text>
          </View>
        )}
        {shares.map((s) => {
          const expired = isExpired(s.expiresAt);
          const status = s.revoked ? '已吊销' : expired ? '已过期' : '有效';
          const canAct = !s.revoked && !expired;
          const checked = selectedIds.has(s.id);
          return (
            <View
              key={s.id}
              className={`share-row${selecting ? ' select-mode' : ''}${checked ? ' note-row-checked' : ''}`}
            >
              <View className="share-row-head">
                {selecting && (
                  <View
                    className={`checkbox${checked ? ' checkbox-checked' : ''}`}
                    onClick={() => toggleSelect(s.id)}
                  >
                    {checked && <Text className="checkbox-mark">✓</Text>}
                  </View>
                )}
                <Text
                  className="share-title"
                  onClick={() => (selecting ? toggleSelect(s.id) : undefined)}
                  onLongPress={() => {
                    if (!selecting && canAct) enterSelect(s.id);
                  }}
                >
                  {/* 标题已不再存服务端（E2EE 分享），这里按创建时间标识 */}
                  {new Date(s.createdAt).toLocaleString('zh-CN')}
                </Text>
                {!selecting && canAct && (
                  <View className="share-actions">
                    <Text
                      className="mint-btn mint-btn-sm mint-btn-danger"
                      onClick={async () => {
                        try {
                          await getApi().delete(`/shares/${s.id}`);
                          Taro.showToast({ title: '已吊销', icon: 'success' });
                          await load();
                        } catch {
                          Taro.showToast({ title: '操作失败', icon: 'none' });
                        }
                      }}
                    >
                      吊销
                    </Text>
                  </View>
                )}
              </View>
              <Text className="share-meta">
                {new Date(s.createdAt).toLocaleString('zh-CN')}
                {` · 👁️ ${s.viewCount} 次`}
                {s.hasPassword ? ' · 🔐 加密' : ' · 公开'}
              </Text>
              <Text className="share-meta">状态：{status}</Text>
            </View>
          );
        })}
      </ScrollView>

      {selecting && (
        <View className="batch-bar">
          <Text className="batch-bar-count">已选 {selCount} 项</Text>
          <View className="batch-bar-actions">
            <Text className="batch-btn batch-btn-danger" onClick={batchRevoke}>
              🗑️ 批量吊销
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
