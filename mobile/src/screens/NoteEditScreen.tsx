/**
 * 笔记编辑：标题 + Markdown 内容 + 自动保存
 *
 * 加载时解密展示，保存时加密提交；解密失败的笔记禁止自动保存，避免覆盖原始密文。
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { decryptString, encryptString, type Ciphertext } from '@dustnote/shared';
import { api } from '../api';
import { useAuthStore } from '../state/auth';
import { useColors } from '../theme';

interface NoteData {
  id: string;
  ciphertext: string;
  keyVersion: number;
  isPinned: number;
  isFavorite: number;
  version: number;
}

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
  const masterKey = useAuthStore((s) => s.masterKey);
  const { noteId } = route.params;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<NoteData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 解密是否失败；失败时禁止自动保存，避免覆盖原始密文 */
  const [decryptFailed, setDecryptFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get<{ notes: NoteData[] }>(`/notes`);
        const n = r.notes.find((x) => x.id === noteId);
        if (!n) {
          setLoadError('笔记不存在');
          return;
        }
        setNote(n);
        if (masterKey) {
          try {
            const env = parseEnvelope(n.ciphertext);
            const json = await decryptString(masterKey, env.payload);
            const pt = JSON.parse(json) as { title: string; content: string };
            setTitle(pt.title);
            setContent(pt.content);
            setDecryptFailed(false);
          } catch {
            setTitle('🔒 解密失败');
            setContent('');
            setDecryptFailed(true);
          }
        }
      } catch (err) {
        setLoadError((err as Error).message);
      }
    })();
  }, [noteId, masterKey]);

  const save = useCallback(async () => {
    if (!masterKey || !note) return;
    // 解密失败的笔记禁止自动保存，避免覆盖原始密文
    if (decryptFailed) return;
    setSaving(true);
    try {
      const json = JSON.stringify({ title, content, tags: [] });
      const payload = await encryptString(masterKey, json, 1);
      const env: NoteEnvelope = { v: 1, payload };
      const r = await api.patch<{ version: number; serverUpdatedAt: string }>(`/notes/${noteId}`, {
        ciphertext: JSON.stringify(env),
        keyVersion: 1,
        isPinned: !!note.isPinned,
        isFavorite: !!note.isFavorite,
        clientUpdatedAt: new Date().toISOString(),
        version: note.version,
      });
      setNote({ ...note, version: r.version });
    } catch (err) {
      Alert.alert('保存失败', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [masterKey, note, noteId, title, content, decryptFailed]);

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
            await api.delete(`/notes/${noteId}`);
            navigation.goBack();
          } catch (err) {
            Alert.alert('删除失败', (err as Error).message);
          }
        },
      },
    ]);
  };

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
          <Text style={styles.toolbarBtn}>←</Text>
        </TouchableOpacity>
        <Text style={styles.toolbarStatus}>
          {decryptFailed ? '⚠️ 解密失败' : saving ? '🔄 保存中…' : '✅ 已保存'}
        </Text>
        <TouchableOpacity onPress={onDelete}>
          <Text style={[styles.toolbarBtn, { color: colors.danger }]}>🗑️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          placeholder="标题"
          placeholderTextColor={colors.muted}
          editable={!decryptFailed}
        />
        <TextInput
          style={styles.content}
          value={content}
          onChangeText={setContent}
          placeholder="开始记录…\n\n支持 Markdown 语法"
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          editable={!decryptFailed}
        />
      </ScrollView>
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
  });
}
