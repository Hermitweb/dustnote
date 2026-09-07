/**
 * 分享管理页 — 支持多选批量吊销
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ThemeVars, useThemeDarkClass } from '../../components/ThemeVars';
import { getApi, useAuthStore, decryptNote, parseEnvelope } from '../../state/auth';
import { unwrapKey, toBase64Url, noteAad, type Ciphertext } from '@dustnote/shared';
import { getRepo } from '../../lib/get-repo';
import { getCachedPlain, putCachedPlain } from '../../lib/plain-cache';
import { useModeStore } from '../../lib/mode-store';
import { t, useLanguage } from '../../lib/i18n';
import { parseServerDate } from '../../lib/date-parse';

interface ShareItem {
  id: string;
  noteId: string;
  token: string;
  wrappedShareKey: Ciphertext;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  revoked: boolean;
  createdAt: string;
}

function isExpired(e: string | null): boolean {
  return e ? parseServerDate(e).getTime() < Date.now() : false;
}

/** 复制访客可直开的分享链接：本地解封 shareKey，key 走 URL hash 不经过服务端 */
const copyShareLink = async (s: ShareItem): Promise<void> => {
  try {
    const mk = useAuthStore.getState().masterKey;
    if (!mk) return;
    const shareKey = await unwrapKey(mk, s.wrappedShareKey);
    const key = toBase64Url(shareKey);
    const shareUrl =
      process.env.TARO_ENV === 'h5'
        ? `${window.location.origin}/#/pages/share/index?token=${s.token}&key=${key}`
        : `${(useModeStore.getState().serverUrl ?? '').replace(/\/+$/, '')}/share/${s.token}#${key}`;
    await Taro.setClipboardData({ data: shareUrl });
    Taro.showToast({ title: t('share_mgr.link_copied'), icon: 'success' });
  } catch {
    Taro.showToast({ title: t('common.operation_failed'), icon: 'none' });
  }
};

export default function Shares() {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
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
      // 标题映射：明文缓存优先，未命中解密（E2EE 下服务端无标题，对齐安卓端）
      try {
        const mk = useAuthStore.getState().masterKey;
        if (mk) {
          const aadUserId = useAuthStore.getState().userId ?? '';
          const snapshot = await getRepo().loadAll();
          const map: Record<string, string> = {};
          for (const n of snapshot.notes as Array<{
            id: string;
            ciphertext: string;
            deletedAt?: string | null;
          }>) {
            if (n.deletedAt) continue;
            const cached = getCachedPlain(n.id, n.ciphertext);
            if (cached) {
              map[n.id] = cached.title;
              continue;
            }
            try {
              const env = parseEnvelope(n.ciphertext);
              const pt = await decryptNote(
                mk,
                env,
                env.payload.a === 1 ? noteAad(n.id, aadUserId) : undefined
              );
              map[n.id] = pt.title;
              putCachedPlain(n.id, n.ciphertext, pt.title, pt.content, pt.tags);
            } catch {
              /* 单条解密失败跳过 */
            }
          }
          setTitles(map);
        }
      } catch {
        /* 标题加载失败不阻塞列表 */
      }
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

  const darkClass = useThemeDarkClass();
  return (
    <>
      <ThemeVars />
      <View className={`page ${darkClass}`}>
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
            <Text className="topbar-title">{t('share_mgr.title')}</Text>
          </>
        )}
      </View>

      <ScrollView
        scrollY
        className="flex-1"
        refresherEnabled
        refresherTriggered={loading}
        onRefresherRefresh={() => void load()}
      >
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
                  {titles[s.noteId] || t('share_mgr.no_title')}
                </Text>
                {!selecting && canAct && (
                  <View className="share-actions">
                    <Text
                      className="mint-btn mint-btn-sm mint-btn-ghost"
                      onClick={() => void copyShareLink(s)}
                    >
                      {t('share_mgr.copy_link')}
                    </Text>
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
                {parseServerDate(s.createdAt).toLocaleString('zh-CN')}
                {t('share_mgr.views', { count: s.viewCount })}
                {s.hasPassword ? t('share_mgr.encrypted') : t('share_mgr.public')}
                {s.revoked
                  ? ''
                  : s.expiresAt
                    ? t('share_mgr.expires_at', {
                        time: parseServerDate(s.expiresAt).toLocaleString('zh-CN'),
                      })
                    : t('share_mgr.never_expires')}
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
    </>
  );
}
