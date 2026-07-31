/**
 * 笔记编辑：标题 + Markdown 内容 + 自动保存
 *
 * 加载时解密展示，保存时加密提交；解密失败的笔记禁止自动保存，避免覆盖原始密文。
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流（standalone / online）
 * 不再直接调用 api，避免单机模式下因无服务端而崩溃
 *
 * 注：DataRepository 接口未提供 getNote(id)，loadAll 后 find 是临时方案；
 * 后续可在接口补 getNote(id)，或联机模式直接 GET /notes/:id
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Share,
  Modal,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../App';
import {
  decryptString,
  encryptString,
  randomBytes,
  wrapKey,
  toBase64Url,
  fillTemplatePlaceholders,
  PRESET_TEMPLATES,
  type Ciphertext,
  type NoteRow,
  type NoteVersionMeta,
} from '@dustnote/shared';
import { useAuthStore } from '../state/auth';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { useColors } from '../theme';

interface NoteEnvelope {
  v: number;
  payload: Ciphertext;
}

/** 解析密文信封：兼容新格式 { v, payload } 与旧格式（直接是 Ciphertext） */
function parseEnvelope(raw: string): NoteEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'payload' in parsed) {
    return parsed as NoteEnvelope;
  }
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: 1, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

export function NoteEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'NoteEdit'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const { t } = useTranslation();
  const masterKey = useAuthStore((s) => s.masterKey);
  const mode = useModeStore((s) => s.mode);
  const { noteId } = route.params;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<NoteRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 解密是否失败；失败时禁止自动保存，避免覆盖原始密文 */
  const [decryptFailed, setDecryptFailed] = useState(false);
  // 模板选择 Modal
  const [showTemplates, setShowTemplates] = useState(false);
  // 历史版本 Modal
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 创建 Repository（按当前模式分流）
  const repo = useMemo(
    () => createRepository({ mode: mode ?? 'online', serverUrl: null, accessToken: null, deviceId: null }),
    [mode]
  );

  useEffect(() => {
    void (async () => {
      try {
        const snapshot = await repo.loadAll();
        const n = snapshot.notes.find((x) => x.id === noteId);
        if (!n) {
          setLoadError('笔记不存在');
          return;
        }
        setNote(n);
        if (masterKey) {
          try {
            const env = parseEnvelope(n.ciphertext);
            const json = await decryptString(masterKey, env.payload);
            const pt = JSON.parse(json) as { title: string; content: string; tags?: string[] };
            setTitle(pt.title);
            setContent(pt.content);
            setTags(Array.isArray(pt.tags) ? pt.tags : []);
            setDecryptFailed(false);
          } catch {
            setTitle('🔒 解密失败');
            setContent('');
            setTags([]);
            setDecryptFailed(true);
          }
        }
      } catch (err) {
        setLoadError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, masterKey]);

  const save = useCallback(async () => {
    if (!masterKey || !note) return;
    // 解密失败的笔记禁止自动保存，避免覆盖原始密文
    if (decryptFailed) return;
    setSaving(true);
    try {
      const json = JSON.stringify({ title, content, tags });
      const payload = await encryptString(masterKey, json, 1);
      const env: NoteEnvelope = { v: 1, payload };
      const nextVersion = await repo.updateNote(noteId, {
        ciphertext: JSON.stringify(env),
        keyVersion: 1,
        isPinned: !!note.isPinned,
        isFavorite: !!note.isFavorite,
        version: note.version,
      });
      setNote({ ...note, version: nextVersion });
    } catch (err) {
      Alert.alert('保存失败', (err as Error).message);
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterKey, note, noteId, title, content, tags, decryptFailed, repo]);

  useEffect(() => {
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [title, content, save]);

  const onDelete = () => {
    Alert.alert('确认', '确定要删除这篇笔记吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await repo.deleteNote(noteId);
            navigation.goBack();
          } catch (err) {
            Alert.alert('删除失败', (err as Error).message);
          }
        },
      },
    ]);
  };

  const onShare = useCallback(async () => {
    if (!masterKey || !note) {
      Alert.alert('提示', '请先解锁笔记');
      return;
    }
    // 联机模式才可分享（单机模式无服务端）
    if (mode !== 'online') {
      Alert.alert('提示', '分享功能仅在联机模式下可用');
      return;
    }
    try {
      // shareKey 只在本地生成，服务端永远见不到它
      const shareKey = randomBytes(32);
      const ciphertext = await encryptString(
        shareKey,
        JSON.stringify({ title: title || '未命名笔记', content })
      );
      const wrappedShareKey = await wrapKey(masterKey, shareKey);

      const { resolveBaseUrl } = await import('../lib/mode-store');
      const baseUrl = resolveBaseUrl().replace(/\/api\/v1$/, '');
      const token = useAuthStore.getState().accessToken;
      const r = await fetch(`${baseUrl}/api/v1/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          noteId,
          ciphertext,
          wrappedShareKey,
        }),
      });
      const data = (await r.json()) as { token: string; error?: string; message?: string };
      if (!r.ok) {
        Alert.alert('分享失败', data.message ?? data.error ?? `HTTP ${r.status}`);
        return;
      }
      // 密钥放 fragment：与 web 端一致，浏览器不会把 # 之后的内容发给服务端
      const shareUrl = `${baseUrl}/share/${data.token}#${toBase64Url(shareKey)}`;
      await Share.share({ message: shareUrl, title: title || '分享笔记' });
    } catch (err) {
      Alert.alert('分享失败', (err as Error).message);
    }
  }, [masterKey, note, mode, title, content, noteId]);

  // ========== 模板选择（简化版：仅预设模板） ==========
  const onApplyTemplate = useCallback(
    (templateContent: string, templateName: string) => {
      Alert.alert(t('common.hint'), t('templates.apply_confirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            try {
              const filled = fillTemplatePlaceholders(templateContent);
              setContent(filled);
              // 标题为空时用模板名填充
              if (!title.trim()) setTitle(templateName);
              setShowTemplates(false);
              Alert.alert(t('templates.applied'));
            } catch (err) {
              Alert.alert(t('templates.apply_failed'), (err as Error).message);
            }
          },
        },
      ]);
    },
    [t, title]
  );

  // ========== 历史版本（简化版：联机模式直接调 API） ==========
  const onLoadHistory = useCallback(async () => {
    if (mode !== 'online') {
      Alert.alert(t('common.hint'), t('templates.standalone_hint'));
      return;
    }
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const { resolveBaseUrl } = await import('../lib/mode-store');
      const baseUrl = resolveBaseUrl();
      const token = useAuthStore.getState().accessToken;
      const r = await fetch(`${baseUrl}/notes/${noteId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { versions: NoteVersionMeta[] };
      setVersions(data.versions ?? []);
    } catch (err) {
      Alert.alert(t('history.load_failed'), (err as Error).message);
      setShowHistory(false);
    } finally {
      setHistoryLoading(false);
    }
  }, [mode, noteId, t]);

  const onRestoreVersion = useCallback(
    async (versionId: string) => {
      Alert.alert(t('history.restore'), t('history.restore_confirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            try {
              if (!masterKey) throw new Error('no masterKey');
              const { resolveBaseUrl } = await import('../lib/mode-store');
              const baseUrl = resolveBaseUrl();
              const token = useAuthStore.getState().accessToken;
              // 1. 拉取版本密文
              const r = await fetch(`${baseUrl}/notes/${noteId}/versions/${versionId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const data = (await r.json()) as { ciphertext: string };
              // 2. 解密预览
              const env = parseEnvelope(data.ciphertext);
              const json = await decryptString(masterKey, env.payload);
              const pt = JSON.parse(json) as { title: string; content: string };
              // 3. 调用服务端 restore（乐观锁：带当前 version）
              const restoreR = await fetch(
                `${baseUrl}/notes/${noteId}/versions/${versionId}/restore`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ version: note?.version ?? 1 }),
                }
              );
              if (!restoreR.ok) throw new Error(`HTTP ${restoreR.status}`);
              const restored = (await restoreR.json()) as { version: number };
              // 4. 更新本地 UI
              setTitle(pt.title);
              setContent(pt.content);
              if (note) setNote({ ...note, version: restored.version });
              setShowHistory(false);
              Alert.alert(t('history.restore_success'));
            } catch (err) {
              Alert.alert(t('history.restore_failed'), (err as Error).message);
            }
          },
        },
      ]);
    },
    [masterKey, noteId, note, t]
  );

  const styles = makeStyles(colors);

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.fg }}>⚠️ {loadError}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.toolbarBtn}>{t('editor.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.toolbarStatus}>
          {decryptFailed
            ? t('editor.status_decrypt_failed')
            : saving
              ? t('editor.status_saving')
              : t('editor.status_saved')}
        </Text>
        <View style={{ flexDirection: 'row' }}>
          {/* 模板选择（简化版：仅预设模板，单机/联机均可用） */}
          {!decryptFailed && (
            <TouchableOpacity onPress={() => setShowTemplates(true)} disabled={saving}>
              <Text style={styles.toolbarBtn}>{t('editor.templates')}</Text>
            </TouchableOpacity>
          )}
          {/* 历史版本（联机模式才可用） */}
          {mode === 'online' && !decryptFailed && (
            <TouchableOpacity onPress={() => void onLoadHistory()} disabled={saving}>
              <Text style={styles.toolbarBtn}>{t('editor.history')}</Text>
            </TouchableOpacity>
          )}
          {mode === 'online' && !decryptFailed && (
            <TouchableOpacity onPress={() => void onShare()} disabled={saving}>
              <Text style={styles.toolbarBtn}>{t('editor.share')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onDelete}>
            <Text style={[styles.toolbarBtn, { color: colors.danger }]}>{t('editor.delete')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          placeholder={t('editor.title_placeholder')}
          placeholderTextColor={colors.muted}
          editable={!decryptFailed}
        />
        <TextInput
          style={styles.content}
          value={content}
          onChangeText={setContent}
          placeholder={t('editor.content_placeholder')}
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          editable={!decryptFailed}
        />
        {/* ========== 标签编辑 ========== */}
        {!decryptFailed && (
          <View style={styles.tagsContainer}>
            <View style={styles.tagsRow}>
              {tags.map((tag) => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>#{tag}</Text>
                  <TouchableOpacity
                    onPress={() => setTags((prev) => prev.filter((x) => x !== tag))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.tagChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="添加标签…"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                onSubmitEditing={() => {
                  const v = tagInput.trim().replace(/^#/, '').trim();
                  if (v && !tags.includes(v)) {
                    setTags((prev) => [...prev, v]);
                  }
                  setTagInput('');
                }}
              />
              <TouchableOpacity
                style={[styles.tagAddBtn, !tagInput.trim() && { opacity: 0.5 }]}
                disabled={!tagInput.trim()}
                onPress={() => {
                  const v = tagInput.trim().replace(/^#/, '').trim();
                  if (v && !tags.includes(v)) {
                    setTags((prev) => [...prev, v]);
                  }
                  setTagInput('');
                }}
              >
                <Text style={styles.tagAddBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ========== 模板选择 Modal ========== */}
      <Modal visible={showTemplates} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('templates.title')}</Text>
            <TouchableOpacity onPress={() => setShowTemplates(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>{t('templates.subtitle')}</Text>
          <FlatList
            data={PRESET_TEMPLATES}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.templateRow}
                onPress={() => onApplyTemplate(item.content, item.name)}
              >
                <Text style={styles.templateIcon}>{item.icon}</Text>
                <View style={styles.templateInfo}>
                  <Text style={styles.templateName}>{item.name}</Text>
                  <Text style={styles.templateDesc}>{item.description}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* ========== 历史版本 Modal ========== */}
      <Modal visible={showHistory} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('history.title')}</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {historyLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.mint600} />
              <Text style={{ marginTop: 12, color: colors.muted }}>{t('history.loading')}</Text>
            </View>
          ) : versions.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>🕘</Text>
              <Text style={{ color: colors.muted }}>{t('history.empty')}</Text>
            </View>
          ) : (
            <FlatList
              data={versions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.templateRow}
                  onPress={() => void onRestoreVersion(item.id)}
                >
                  <Text style={styles.templateIcon}>🕘</Text>
                  <View style={styles.templateInfo}>
                    <Text style={styles.templateName}>
                      {t('history.version_label', { n: item.noteVersion })}
                    </Text>
                    <Text style={styles.templateDesc}>
                      {new Date(item.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={styles.restoreBtn}>{t('history.restore')}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// 根据当前颜色生成样式；仅在 isDark 变化时重新创建
function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    toolbarBtn: { fontSize: 20, padding: 8, color: c.fg },
    toolbarStatus: { fontSize: 12, color: c.muted },
    scroll: { flex: 1 },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: c.fg,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
    },
    content: {
      fontSize: 16,
      color: c.fg,
      paddingHorizontal: 16,
      paddingBottom: 100,
      minHeight: 400,
      lineHeight: 24,
    },
    // 标签编辑
    tagsContainer: {
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 24,
      borderTopColor: c.border,
      borderTopWidth: 1,
      marginTop: 4,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10,
    },
    tagChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bg,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: c.border,
      gap: 6,
    },
    tagChipText: { fontSize: 13, color: c.mint600, fontWeight: '500' },
    tagChipClose: { fontSize: 14, color: c.muted, fontWeight: '600' },
    tagInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tagInput: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      color: c.fg,
      borderWidth: 1,
      borderColor: c.border,
    },
    tagAddBtn: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: c.mint600,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tagAddBtnText: { color: 'white', fontSize: 22, fontWeight: '300' },
    // Modal 通用样式
    modalContainer: { flex: 1, backgroundColor: c.bg, padding: 16 },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      marginBottom: 8,
    },
    modalTitle: { fontSize: 18, fontWeight: '700', color: c.fg },
    modalClose: { fontSize: 22, color: c.muted, paddingHorizontal: 8 },
    modalHint: { fontSize: 13, color: c.muted, marginBottom: 12, lineHeight: 18 },
    // 模板 / 历史列表行
    templateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    templateIcon: { fontSize: 28, marginRight: 14 },
    templateInfo: { flex: 1 },
    templateName: { fontSize: 15, fontWeight: '600', color: c.fg, marginBottom: 2 },
    templateDesc: { fontSize: 12, color: c.muted },
    restoreBtn: { fontSize: 13, color: c.mint600, fontWeight: '600' },
  });
}
