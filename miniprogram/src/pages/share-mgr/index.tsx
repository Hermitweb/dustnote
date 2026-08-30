/**
 * 分享管理页 — 支持多选批量吊销
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { getApi } from '../../state/auth';
import { t, useLanguage } from '../../lib/i18n';

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
  const lang = useLanguage();

  // 语言切换后同步原生导航栏标题
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('app.name') });
  }, [lang]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getApi().get<{ shares: ShareItem[] }>('/shares');
      setShares(r.shares);
    } catch (err: any) {
      Taro.showToast({
        title: t('share_mgr.load_failed', {
          msg: err?.err?.message || err?.message || t('common.unknown_error'),
        }),
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

  useDidShow(() => {
    void load();
  });

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
      title: t('share_mgr.revoke_title'),
      content: t('share_mgr.revoke_content', { count: ids.length }),
      confirmText: t('share_mgr.revoke'),
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
    Taro.showToast({ title: t('share_mgr.revoked_count', { count: ok }), icon: 'success' });
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
              {hasAllSelected
                ? t('common.deselect_all')
                : selCount
                  ? t('common.select_all_n', { count: selCount })
                  : t('common.select_all')}
            </Text>
            <View className="topbar-actions" />
          </>
        ) : (
          <>
            <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
              ←
            </Text>
            <Text className="topbar-title">{t('share_mgr.title')}</Text>
            <View className="topbar-actions" />
          </>
        )}
      </View>

      <ScrollView scrollY className="flex-1">
        {loading && <View className="loading">{t('common.loading')}</View>}
        {!loading && shares.length === 0 && (
          <View className="empty-state">
            <Text className="empty-state-icon">🔗</Text>
            <Text className="empty-state-text">{t('share_mgr.empty')}</Text>
          </View>
        )}
        {shares.map((s) => {
          const expired = isExpired(s.expiresAt);
          const status = s.revoked
            ? t('share_mgr.status_revoked')
            : expired
              ? t('share_mgr.status_expired')
              : t('share_mgr.status_valid');
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
                          Taro.showToast({ title: t('share_mgr.revoked'), icon: 'success' });
                          await load();
                        } catch {
                          Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
                        }
                      }}
                    >
                      {t('share_mgr.revoke')}
                    </Text>
                  </View>
                )}
              </View>
              <Text className="share-meta">
                {new Date(s.createdAt).toLocaleString('zh-CN')}
                {t('share_mgr.views', { count: s.viewCount })}
                {s.hasPassword ? t('share_mgr.encrypted') : t('share_mgr.public')}
              </Text>
              <Text className="share-meta">{t('share_mgr.status_label', { status })}</Text>
            </View>
          );
        })}
      </ScrollView>

      {selecting && (
        <View className="batch-bar">
          <Text className="batch-bar-count">{t('common.selected_count', { count: selCount })}</Text>
          <View className="batch-bar-actions">
            <Text className="batch-btn batch-btn-danger" onClick={batchRevoke}>
              {t('share_mgr.batch_revoke')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
