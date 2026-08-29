/**
 * 文件夹管理页（目录结构范式 v2.5.5）
 *
 * 功能：
 * - 列出所有文件夹（按分支 + 深度缩进展示）
 * - 新建文件夹：顶层必选分支（业务·项目 / 个人·沉淀）；作为子文件夹时继承父分支
 * - 重命名 / 移动 / 删除（长按或点击行尾菜单）
 * - 深度封顶：最多两级（顶层=1 → 子文件夹=2），代码层拦截
 *
 * 范式规范见 docs/note-system-folder-structure-spec.md：
 * - 顶层二元隔离：work（业务·项目）/ personal（个人·沉淀）
 * - 子文件夹继承父分支，不可单独修改
 *
 * v2.0.0 双模式架构：通过 createRepository 工厂按模式分流
 * - standalone → LocalRepository（AsyncStorage）
 * - online     → RemoteRepository（封装 api）
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useModeStore } from '../lib/mode-store';
import { createRepository } from '../lib/repository';
import { useColors } from '../theme';

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  depth?: number;
  branch?: 'work' | 'personal' | null;
}

/** 文件夹最大嵌套深度（与 server MAX_FOLDER_DEPTH 一致） */
const MAX_DEPTH = 2;

const BRANCH_ICON: Record<string, string> = { work: '💼', personal: '🌿' };

export function FoldersScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const mode = useModeStore((s) => s.mode);
  const modeInitialized = useModeStore((s) => s.initialized);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');
  // 创建参数：父级（null=顶层）
  const [parentSel, setParentSel] = useState<string | null>(null);
  // 重命名 / 移动
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [renameText, setRenameText] = useState('');
  const [moving, setMoving] = useState<Folder | null>(null);
  // 行操作菜单（自定义 Modal，可 ✕ / 遮罩关闭）
  const [menuFolder, setMenuFolder] = useState<Folder | null>(null);
  // 树形展开状态
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 创建 Repository（按当前模式分流）
  // mode 可能因 hydrated 延迟而短暂为 null，使用 ?? 'online' 兜底避免类型错误
  const repo = useMemo(
    () =>
      createRepository({
        mode: mode ?? 'online',
        serverUrl: null,
        accessToken: null,
        deviceId: null,
      }),
    [mode]
  );

  const load = useCallback(async () => {
    if (!modeInitialized) return;
    setRefreshing(true);
    try {
      const snapshot = await repo.loadAll();
      setFolders(snapshot.folders);
    } catch (err) {
      console.warn('加载文件夹失败', err);
    } finally {
      setRefreshing(false);
    }
  }, [repo, modeInitialized]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- 工具 ----------

  const findFolder = (id: string | null) => (id ? folders.find((f) => f.id === id) : undefined);

  /** targetId 是否是 folderId 的后代（含自身） */
  const isSelfOrDescendant = (targetId: string, folderId: string): boolean => {
    let cur = findFolder(targetId);
    while (cur) {
      if (cur.id === folderId) return true;
      cur = findFolder(cur.parentId);
    }
    return false;
  };

  /** 可作为新建父级的文件夹：一级文件夹（depth<2） */
  const parentCandidates = folders.filter((f) => (f.depth ?? 1) < MAX_DEPTH);

  /** 可作为移动目标的文件夹：排除自身/后代 + 一级文件夹；含子文件夹的被移动项只能去顶层 */
  const moveTargets = useMemo(() => {
    if (!moving) return [];
    const hasChildren = folders.some((f) => f.parentId === moving.id);
    if (hasChildren) return [];
    return folders.filter(
      (f) => !isSelfOrDescendant(f.id, moving.id) && (f.depth ?? 1) < MAX_DEPTH
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, folders]);

  // ---------- 操作 ----------

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const parent = findFolder(parentSel);
    if (parent && (parent.depth ?? 1) >= MAX_DEPTH) {
      Alert.alert(t('common.hint'), t('folders.depth_limit'));
      return;
    }
    try {
      const id = await repo.createFolder({
        name,
        parentId: parentSel,
      });
      setFolders((prev) => [
        ...prev,
        {
          id,
          name,
          parentId: parentSel,
          icon: null,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          depth: parent ? (parent.depth ?? 1) + 1 : 1,
          branch: parent ? (parent.branch ?? null) : null,
        },
      ]);
      setNewName('');
    } catch (err) {
      Alert.alert(t('folders.create_failed'), err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (folder: Folder) => {
    Alert.alert(t('folders.delete'), `${folder.name}\n${t('folders.delete_confirm')}`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('folders.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await repo.deleteFolder(folder.id);
            setFolders((prev) => prev.filter((f) => f.id !== folder.id));
          } catch (err) {
            Alert.alert(t('folders.delete'), err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  // 文件夹操作菜单：原生 Alert 必须点按钮才能关闭（无 ✕、点外部无效，
  // 用户反馈"没有关闭按钮"）→ 改用与重命名/移动一致的自定义 Modal
  const openMenu = (folder: Folder) => {
    setMenuFolder(folder);
  };

  const handleRename = async () => {
    if (!renaming) return;
    const name = renameText.trim();
    if (!name) return;
    try {
      await repo.renameFolder(renaming.id, name);
      setFolders((prev) => prev.map((f) => (f.id === renaming.id ? { ...f, name } : f)));
      setRenaming(null);
    } catch (err) {
      Alert.alert(t('folders.rename_failed'), err instanceof Error ? err.message : String(err));
    }
  };

  const handleMove = async (targetParentId: string | null) => {
    if (!moving) return;
    const target = findFolder(targetParentId);
    if (target && isSelfOrDescendant(target.id, moving.id)) {
      Alert.alert(t('folders.move_failed'), t('folders.invalid_target'));
      return;
    }
    try {
      await repo.moveFolder(moving.id, targetParentId);
      setFolders((prev) =>
        prev.map((f) =>
          f.id === moving.id
            ? {
                ...f,
                parentId: targetParentId,
                depth: target ? (target.depth ?? 1) + 1 : 1,
                branch: target ? (target.branch ?? null) : f.branch,
              }
            : f
        )
      );
      setMoving(null);
    } catch (err) {
      Alert.alert(t('folders.move_failed'), err instanceof Error ? err.message : String(err));
    }
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      {/* 新建栏：名称 + 父级 + 分支 */}
      <View style={styles.createBar}>
        <TextInput
          style={styles.input}
          placeholder={t('folders.name_placeholder')}
          placeholderTextColor={colors.muted}
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => void handleCreate()}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]}
          onPress={() => void handleCreate()}
          disabled={!newName.trim()}
        >
          <Text style={styles.createBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* 创建位置：父级选择 */}
      <View style={styles.metaBar}>
        <Text style={styles.metaLabel}>{t('folders.create_in')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <Chip
            label={`📁 ${t('folders.parent_top')}`}
            active={parentSel === null}
            onPress={() => setParentSel(null)}
            styles={styles}
          />
          {parentCandidates.map((f) => (
            <Chip
              key={f.id}
              label={`📁 ${f.name}`}
              active={parentSel === f.id}
              onPress={() => setParentSel(f.id)}
              styles={styles}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={folders.filter((f) => {
          // 树形：只显示顶层 + 已展开的子文件夹
          if ((f.depth ?? 1) === 1) return true;
          return f.parentId && expanded.has(f.parentId);
        })}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📁</Text>
            <Text style={styles.emptyText}>{t('folders.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const hasChildren = folders.some((f) => f.parentId === item.id);
          const isExpanded = expanded.has(item.id);
          return (
            <View style={[styles.row, { paddingLeft: ((item.depth ?? 1) - 1) * 20 }]}>
              {/* 展开/折叠按钮 */}
              {hasChildren ? (
                <TouchableOpacity
                  onPress={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  style={{ marginRight: 4 }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted }}>{isExpanded ? '▼' : '▶'}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ width: 20, textAlign: 'center', marginRight: 4, color: colors.muted }}>·</Text>
              )}
              <Text style={styles.rowIcon}>📁</Text>
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => openMenu(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteText}>⋯</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        contentContainerStyle={{ paddingBottom: 20 }}
      />

      {/* 重命名 Modal */}
      <Modal visible={renaming !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalMask} onPress={() => setRenaming(null)}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>{t('folders.rename_title')}</Text>
              <TouchableOpacity onPress={() => setRenaming(null)}>
                <Text style={{ fontSize: 18, color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleRename()}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setRenaming(null)}>
                <Text style={styles.modalBtnCancel}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, !renameText.trim() && { opacity: 0.5 }]}
                onPress={() => void handleRename()}
                disabled={!renameText.trim()}
              >
                <Text style={styles.modalBtnOk}>{t('common.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 移动 Modal：选择目标父级 */}
      <Modal visible={moving !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalMask} onPress={() => setMoving(null)}>
          <View style={[styles.modalCard, { maxHeight: 420 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>
                {t('folders.move_folder')}「{moving?.name}」
              </Text>
              <TouchableOpacity onPress={() => setMoving(null)}>
                <Text style={{ fontSize: 18, color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>
            {folders.some((f) => f.parentId === moving?.id) && (
              <Text style={styles.modalHint}>{t('folders.has_children_top_only')}</Text>
            )}
            <ScrollView style={{ maxHeight: 300 }}>
              <TouchableOpacity style={styles.moveRow} onPress={() => void handleMove(null)}>
                <Text style={styles.moveRowIcon}>📁</Text>
                <Text style={styles.moveRowName}>{t('folders.parent_top')}</Text>
              </TouchableOpacity>
              {moveTargets.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.moveRow}
                  onPress={() => void handleMove(f.id)}
                >
                  <Text style={styles.moveRowIcon}>{BRANCH_ICON[f.branch ?? 'work'] ?? '📁'}</Text>
                  <Text style={styles.moveRowName}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* 行操作菜单 Modal（✕ / 遮罩可关闭，替代原生 Alert） */}
      <Modal visible={menuFolder !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalMask} onPress={() => setMenuFolder(null)}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                📁 {menuFolder?.name}
              </Text>
              <TouchableOpacity onPress={() => setMenuFolder(null)}>
                <Text style={{ fontSize: 18, color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const f = menuFolder;
                setMenuFolder(null);
                if (f) {
                  setRenaming(f);
                  setRenameText(f.name);
                }
              }}
            >
              <Text style={styles.menuRowText}>✏️ {t('folders.rename')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const f = menuFolder;
                setMenuFolder(null);
                if (f) setMoving(f);
              }}
            >
              <Text style={styles.menuRowText}>📁 {t('folders.move_folder')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const f = menuFolder;
                setMenuFolder(null);
                if (f) handleDelete(f);
              }}
            >
              <Text style={[styles.menuRowText, { color: colors.danger }]}>🗑️ {t('folders.delete')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    createBar: {
      flexDirection: 'row',
      padding: 12,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      gap: 8,
    },
    input: {
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
    createBtn: {
      width: 40,
      borderRadius: 8,
      backgroundColor: c.mint600,
      justifyContent: 'center',
      alignItems: 'center',
    },
    createBtnText: { color: 'white', fontSize: 22, fontWeight: '300' },
    metaBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.card,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      gap: 8,
    },
    metaLabel: { fontSize: 12, color: c.muted },
    chipScroll: { flex: 1 },
    chipRow: { flexDirection: 'row', gap: 8, flex: 1 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      marginRight: 8,
    },
    chipActive: { backgroundColor: c.mint600, borderColor: c.mint600 },
    chipText: { fontSize: 12, color: c.fg },
    chipTextActive: { color: 'white' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      marginHorizontal: 12,
      marginTop: 8,
      padding: 14,
      borderRadius: 8,
      borderColor: c.border,
      borderWidth: 1,
    },
    rowIcon: { fontSize: 18, marginRight: 10 },
    rowName: { flex: 1, fontSize: 15, color: c.fg },
    depthBadge: { fontSize: 10, color: c.muted, marginRight: 6 },
    deleteBtn: { paddingHorizontal: 8 },
    deleteText: { fontSize: 16, color: c.muted },
    empty: { alignItems: 'center', marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyText: { fontSize: 16, color: c.fg, marginBottom: 4 },
    modalMask: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    modalTitle: { fontSize: 16, fontWeight: '600', color: c.fg },
    menuRow: {
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    menuRowText: { fontSize: 15, color: c.fg },
    modalHint: { fontSize: 12, color: c.muted },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalBtn: { paddingVertical: 6, paddingHorizontal: 12 },
    modalBtnCancel: { color: c.muted, fontSize: 14 },
    modalBtnOk: { color: c.mint600, fontSize: 14, fontWeight: '600' },
    moveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    moveRowIcon: { fontSize: 16, marginRight: 10 },
    moveRowName: { fontSize: 15, color: c.fg, flex: 1 },
  });
}
