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
              titles[n.id] = pt.title || '未命名笔记';
            } catch {
              titles[n.id] = '🔒 解密失败';
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
  }, [masterKey]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /** 解封 shareKey，还原完整链接 */
  const buildLink = async (item: ShareItem): Promise<string> => {
    if (!masterKey) throw new Error('请先解锁');
    const shareKey = await unwrapKey(masterKey, item.wrappedShareKey);
    const baseUrl = resolveBaseUrl().replace(/\/api\/v1$/, '');
    return `${baseUrl}/share/${item.token}#${toBase64Url(shareKey)}`;
  };

  const onCopyLink = async (item: ShareItem) => {
    try {
      const url = await buildLink(item);
      Clipboard.setString(url);
      Alert.alert('已复制', '分享链接（含解密密钥）已复制到剪贴板。');
    } catch (err) {
      Alert.alert('复制失败', (err as Error).message);
    }
  };

  const onShareLink = async (item: ShareItem) => {
    try {
      const url = await buildLink(item);
      await Share.share({ message: url });
    } catch (err) {
      Alert.alert('分享失败', (err as Error).message);
    }
  };

  const onRevoke = (item: ShareItem) => {
    Alert.alert('吊销分享', '吊销后该链接立即失效，且不可恢复。确定？', [
      { text: '取消', style: 'cancel' },
      {
        text: '吊销',
        style: 'destructive',
        onPress: async () => {
          setBusyId(item.id);
          try {
            await api.delete(`/shares/${item.id}`);
            setShares((prev) => prev.map((s) => (s.id === item.id ? { ...s, revoked: true } : s)));
            Alert.alert('已吊销', '该分享链接已失效。');
          } catch (err) {
            Alert.alert('吊销失败', (err as Error).message);
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
          <Text style={styles.hint}>加载中…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.hint}>加载失败：{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={shares}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🔗</Text>
              <Text style={styles.hint}>还没有分享，去编辑页点击 🔗 分享笔记</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, item.revoked && { opacity: 0.5 }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {noteTitles[item.noteId] ?? '未知笔记'}
                </Text>
                {item.revoked ? (
                  <Text style={styles.revokedBadge}>已吊销</Text>
                ) : item.hasPassword ? (
                  <Text style={styles.passwordBadge}>🔑 有密码</Text>
                ) : null}
              </View>
              <Text style={styles.cardMeta}>
                创建于 {new Date(item.createdAt).toLocaleString('zh-CN')} · 查看 {item.viewCount} 次
                {'\n'}
                {item.hasPassword ? '🔑 有访问密码' : '无访问密码'}
                {item.expiresAt
                  ? ` · 过期：${new Date(item.expiresAt).toLocaleString('zh-CN')}`
                  : ' · 永不过期'}
              </Text>
              {!item.revoked && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void onCopyLink(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={styles.actionText}>📋 复制链接</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void onShareLink(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={styles.actionText}>📤 分享</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.revokeBtn]}
                    onPress={() => onRevoke(item)}
                    disabled={busyId === item.id}
                  >
                    <Text style={[styles.actionText, { color: colors.danger }]}>
                      {busyId === item.id ? '处理中…' : '🚫 吊销'}
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
