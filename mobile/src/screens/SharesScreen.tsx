/**
 * 分享管理页（联机模式）
 *
 * 列出当前账户的全部分享（GET /shares）、复制/分享完整链接（用 masterKey 解封
 * wrappedShareKey 还原 fragment 密钥）、吊销分享（DELETE /shares/:id）。
 *
 * 安全说明：服务端只存密文 + wrappedShareKey；完整链接（含 #fragment 密钥）
 * 只能在本地用 masterKey 解封还原，服务端永远见不到。
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { decryptString, unwrapKey, toBase64Url, noteAad, type Ciphertext } from '@dustnote/shared';
import { api } from '../api';
import { useAuthStore } from '../state/auth';
import { createRepository } from '../lib/repository';
import { resolveBaseUrl } from '../lib/mode-store';
import { parseEnvelope } from '../lib/envelope';
import { useColors } from '../theme';

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

export function SharesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const masterKey = useAuthStore((s) => s.masterKey);
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [noteTitles, setNoteTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ shares: ShareItem[] }>('/shares');
      setShares(r.shares ?? []);

      // 解密本地笔记标题用于展示（服务端不存标题）
      const titles: Record<string, string> = {};
      if (masterKey) {
        try {
          const repo = createRepository({
            mode: 'online',
            serverUrl: null,
            accessToken: null,
            deviceId: null,
          });
          const snapshot = await repo.loadAll();
          const userId = useAuthStore.getState().userId ?? '';
          for (const n of snapshot.notes) {
            try {
              const env = parseEnvelope(n.ciphertext);
              const aad = env.payload.a === 1 ? noteAad(n.id, userId) : undefined;
              const json = await decryptString(masterKey, env.payload, aad);
              const pt = JSON.parse(json) as { title?: string };
              titles[n.id] = pt.title || t('editor.untitled');
            } catch {
              titles[n.id] = t('editor.decrypt_failed_title');
            }
          }
        } catch {
          /* 标题加载失败不阻塞分享列表 */
        }
      }
      setNoteTitles(titles);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [masterKey, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /** 解封 shareKey，还原完整链接 */
  const buildLink = async (item: ShareItem): Promise<string> => {
    if (!masterKey) throw new Error(t('common.unlock_required'));
    const shareKey = await unwrapKey(masterKey, item.wrappedShareKey);
    const baseUrl = resolveBaseUrl().replace(/\/api\/v1$/, '');
    return `${baseUrl}/share/${item.token}#${toBase64Url(shareKey)}`;
  };

  const onCopyLink = async (item: ShareItem) => {
    try {
      const url = await buildLink(item);
      Clipboard.setString(url);
      Alert.alert(t('common.copied'), t('share.copied_detail'));
    } catch (err) {
      Alert.alert(t('share.copy_failed'), (err as Error).message);
    }
  };

  const onShareLink = async (item: ShareItem) => {
    try {
      const url = await buildLink(item);
      await Share.share({ message: url });
    } catch (err) {
      Alert.alert(t('editor.share_failed'), (err as Error).message);
    }
  };

  const onRevoke = (item: ShareItem) => {
    Alert.alert(t('share.revoke_title'), t('share.revoke_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('share.revoke'),
        style: 'destructive',
        onPress: async () => {
          setBusyId(item.id);
          try {
            await api.delete(`/shares/${item.id}`);
            setShares((prev) => prev.map((s) => (s.id === item.id ? { ...s, revoked: true } : s)));
            Alert.alert(t('share.revoked_title'), t('share.revoked_detail'));
          } catch (err) {
            Alert.alert(t('share.revoke_failed'), (err as Error).message);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.mint600} />
          <Text style={styles.hint}>{t('common.loading')}</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.hint}>{t('share.load_failed_detail', { reason: error })}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={shares}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🔗</Text>
              <Text style={styles.hint}>{t('share.empty')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, item.revoked && { opacity: 0.5 }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {noteTitles[item.noteId] ?? t('share.unknown_note')}
                </Text>
                {item.revoked ? (
                  <Text style={styles.revokedBadge}>{t('share.revoked_title')}</Text>
                ) : item.hasPassword ? (
                  <Text style={styles.passwordBadge}>{t('share.has_password_badge')}</Text>
                ) : null}
              </View>
              <Text style={styles.cardMeta}>
                {t('share.created_at', { date: new Date(item.createdAt).toLocaleString('zh-CN') })}{' '}
                · {t('share.views', { count: item.viewCount })}
                {'\n'}
                {item.hasPassword ? t('share.password_protected') : t('share.no_password')}
                {item.expiresAt
                  ? ` · ${t('share.expires_at', { date: new Date(item.expiresAt).toLocaleString('zh-CN') })}`
                  : ` · ${t('share.never_expires')}`}
              </Text>
              {!item.revoked && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void onCopyLink(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={styles.actionText}>{t('share.copy_link_btn')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void onShareLink(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={styles.actionText}>{t('share.share_btn')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.revokeBtn]}
                    onPress={() => onRevoke(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={[styles.actionText, { color: colors.danger }]}>
                      {busyId === item.id ? t('share.processing') : t('share.revoke_btn')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errorEmoji: { fontSize: 48, marginBottom: 12 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    hint: { fontSize: 14, color: c.muted, textAlign: 'center', marginTop: 8 },
    retryBtn: {
      marginTop: 16,
      paddingHorizontal: 24,
      paddingVertical: 10,
      backgroundColor: c.mint600,
      borderRadius: 8,
    },
    retryText: { color: 'white', fontSize: 14, fontWeight: '600' },
    card: {
      backgroundColor: c.card,
      marginHorizontal: 12,
      marginTop: 10,
      padding: 14,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontSize: 16, fontWeight: '600', color: c.fg, flex: 1 },
    revokedBadge: { fontSize: 12, color: c.muted },
    passwordBadge: { fontSize: 12, color: c.accent },
    cardMeta: { fontSize: 12, color: c.muted, marginTop: 6, lineHeight: 18 },
    actions: { flexDirection: 'row', marginTop: 10, gap: 8 },
    actionBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 6,
      borderColor: c.border,
      borderWidth: 1,
      alignItems: 'center',
      backgroundColor: c.bg,
    },
    revokeBtn: { borderColor: c.danger },
    actionText: { fontSize: 13, color: c.fg },
  });
}
