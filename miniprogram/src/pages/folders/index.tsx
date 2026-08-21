/**
 * 小程序文件夹管理页（目录结构范式 v2.5.5）
 *
 * 功能：
 * - 列出所有文件夹（分支 emoji + 深度缩进）
 * - 新建：顶层必选分支（业务·项目 / 个人·沉淀）；子文件夹继承父分支
 * - 重命名 / 移动 / 删除（点击行弹 ActionSheet）
 * - 深度封顶：最多两级，代码层拦截
 *
 * 范式规范见 docs/note-system-folder-structure-spec.md
 * 复用 settings 页 topbar + settings-row 样式
 */
import React, { useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { getRepo } from '../../lib/get-repo';

interface Folder {
  id: string;
  name: string;
  parentId?: string | null;
  icon: string | null;
  createdAt: string;
  depth?: number;
  branch?: 'work' | 'personal' | null;
}

/** 文件夹最大嵌套深度（与 server MAX_FOLDER_DEPTH 一致） */
const MAX_DEPTH = 2;

const BRANCH_ICON: Record<string, string> = { work: '💼', personal: '🌿' };

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  // 创建参数：父级 + 顶层分支
  const [parentSel, setParentSel] = useState<string | null>(null);
  const [branchSel, setBranchSel] = useState<'work' | 'personal'>('work');
  // 移动模式：movingId 非空时列表变为「选择目标父级」
  const [movingId, setMovingId] = useState<string | null>(null);
  // 重命名弹层（页面内实现：weapp 的 showModal editable 在 H5 端不可用）
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [renameText, setRenameText] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const snapshot = await getRepo().loadAll();
      setFolders(snapshot.folders as Folder[]);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
  }, []);
  useDidShow(() => {
    void load();
  });

  const findFolder = (id: string | null) => (id ? folders.find((f) => f.id === id) : undefined);

  /** targetId 是否是 folderId 的后代（含自身） */
  const isSelfOrDescendant = (targetId: string, folderId: string): boolean => {
    let cur = findFolder(targetId);
    while (cur) {
      if (cur.id === folderId) return true;
      cur = findFolder(cur.parentId ?? null);
    }
    return false;
  };

  /** 可作为父级的一级文件夹 */
  const parentCandidates = folders.filter((f) => (f.depth ?? 1) < MAX_DEPTH);

  /** 正在移动的文件夹（含子文件夹时只能移到顶层） */
  const moving = movingId ? findFolder(movingId) : undefined;
  const movingHasChildren = moving ? folders.some((f) => f.parentId === moving.id) : false;
  const moveTargets = moving
    ? folders.filter(
        (f) => !isSelfOrDescendant(f.id, moving.id) && (f.depth ?? 1) < MAX_DEPTH
      )
    : [];

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const parent = findFolder(parentSel);
    if (parent && (parent.depth ?? 1) >= MAX_DEPTH) {
      Taro.showToast({ title: '最多两级嵌套', icon: 'none' });
      return;
    }
    try {
      const id = await getRepo().createFolder({
        name,
        parentId: parentSel,
        // 顶层必选分支；子文件夹由数据层继承父分支
        branch: parentSel ? null : branchSel,
      });
      setFolders((prev) => [
        ...prev,
        {
          id,
          name,
          parentId: parentSel,
          icon: null,
          createdAt: new Date().toISOString(),
          depth: parent ? (parent.depth ?? 1) + 1 : 1,
          branch: parent ? (parent.branch ?? null) : branchSel,
        },
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
      await getRepo().deleteFolder(folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      Taro.showToast({ title: '已删除', icon: 'success' });
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  /** 提交重命名（页面内弹层） */
  const submitRename = async () => {
    if (!renameTarget) return;
    const name = renameText.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    try {
      await getRepo().renameFolder(renameTarget.id, name);
      setFolders((prev) => prev.map((f) => (f.id === renameTarget.id ? { ...f, name } : f)));
      setRenameTarget(null);
      Taro.showToast({ title: '已重命名', icon: 'success' });
    } catch {
      Taro.showToast({ title: '重命名失败', icon: 'none' });
    }
  };

  const handleMove = async (targetParentId: string | null) => {
    if (!moving) return;
    const target = findFolder(targetParentId);
    if (target && isSelfOrDescendant(target.id, moving.id)) {
      Taro.showToast({ title: '不能移动到自身或其子文件夹', icon: 'none' });
      return;
    }
    try {
      await getRepo().moveFolder(moving.id, targetParentId);
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
      setMovingId(null);
      Taro.showToast({ title: '已移动', icon: 'success' });
    } catch {
      Taro.showToast({ title: '移动失败', icon: 'none' });
    }
  };

  const openMenu = (folder: Folder) => {
    Taro.showActionSheet({
      itemList: ['✏️ 重命名', '📁 移动到…', '🗑️ 删除'],
      itemColor: '#E07B6C',
      success: (res) => {
        if (res.tapIndex === 0) {
          setRenameTarget(folder);
          setRenameText(folder.name);
        } else if (res.tapIndex === 1) setMovingId(folder.id);
        else if (res.tapIndex === 2) void handleDelete(folder);
      },
    });
  };

  return (
    <View className="page">
      <View className="topbar">
        <Text className="topbar-back" onClick={() => Taro.navigateBack()}>
          ←
        </Text>
        <Text className="topbar-title">{moving ? '移动文件夹' : '文件夹管理'}</Text>
        <Text className="topbar-actions"></Text>
      </View>

      {/* 移动模式：选择目标父级 */}
      {moving && (
        <ScrollView scrollY className="flex-1">
          <View className="settings-group">
            <Text className="settings-group-title">
              移动「{moving.name}」到：{movingHasChildren ? '（含子文件夹，仅可移到顶层）' : ''}
            </Text>
            <View className="settings-row" onClick={() => void handleMove(null)}>
              <View className="settings-row-label">
                <Text>📁 顶层</Text>
              </View>
            </View>
            {!movingHasChildren &&
              moveTargets.map((f) => (
                <View key={f.id} className="settings-row" onClick={() => void handleMove(f.id)}>
                  <View className="settings-row-label">
                    <Text>
                      {BRANCH_ICON[f.branch ?? 'work'] ?? '📁'} {f.name}
                    </Text>
                  </View>
                </View>
              ))}
            <View className="settings-row" onClick={() => setMovingId(null)}>
              <View className="settings-row-label">
                <Text className="text-muted">取消移动</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {/* 常规模式：创建 + 列表 */}
      {!moving && (
        <>
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

            {/* 创建位置：父级 chips（一级文件夹；二级不可再嵌套） */}
            <View className="folder-chip-row">
              <Text
                className={`folder-chip${parentSel === null ? ' folder-chip-active' : ''}`}
                onClick={() => setParentSel(null)}
              >
                📁 顶层
              </Text>
              {parentCandidates.map((f) => (
                <Text
                  key={f.id}
                  className={`folder-chip${parentSel === f.id ? ' folder-chip-active' : ''}`}
                  onClick={() => setParentSel(f.id)}
                >
                  {BRANCH_ICON[f.branch ?? 'work'] ?? '📁'} {f.name}
                </Text>
              ))}
            </View>

            {/* 顶层创建时选择分支（子文件夹继承父分支） */}
            {parentSel === null && (
              <View className="folder-chip-row">
                <Text
                  className={`folder-chip${branchSel === 'work' ? ' folder-chip-active' : ''}`}
                  onClick={() => setBranchSel('work')}
                >
                  💼 业务·项目
                </Text>
                <Text
                  className={`folder-chip${branchSel === 'personal' ? ' folder-chip-active' : ''}`}
                  onClick={() => setBranchSel('personal')}
                >
                  🌿 个人·沉淀
                </Text>
              </View>
            )}
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
              <View key={f.id} className="settings-row folder-row" onClick={() => openMenu(f)}>
                <View className="settings-row-label">
                  <Text style={{ paddingLeft: ((f.depth ?? 1) - 1) * 16 }}>
                    {BRANCH_ICON[f.branch ?? 'work'] ?? '📁'} {f.name}
                    {(f.depth ?? 1) > 1 ? ' (子)' : ''}
                  </Text>
                </View>
                <Text className="settings-row-value text-muted">⋯</Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}
      {/* 重命名弹层（页面内实现，双端一致） */}
      {renameTarget && (
        <View className="modal-mask" onClick={() => setRenameTarget(null)}>
          <View className="modal-card" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">重命名文件夹</Text>
            <Input
              className="mint-input"
              value={renameText}
              focus
              onInput={(e: any) => setRenameText((e.detail as { value: string }).value)}
              onConfirm={() => void submitRename()}
            />
            <View className="row gap-m">
              <View className="mint-btn mint-btn-ghost flex-1" onClick={() => setRenameTarget(null)}>
                取消
              </View>
              <View
                className={`mint-btn flex-1${!renameText.trim() ? ' mint-btn-disabled' : ''}`}
                onClick={() => void submitRename()}
              >
                确认
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
