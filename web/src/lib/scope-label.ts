/**
 * 当前作用域的名字（顶栏常驻标题）
 *
 * 为什么需要：图标轨档（1024–1279）把侧栏收成 56px，所有条目只剩图标。
 * 浮层（RailLabelTip）解决的是"我指着哪个"，但用户更常问的是"我现在在哪"——
 * 后者此前只能靠"哪个图标是亮的"反推，或者点一下再看列表。而 56px 宽的轨里
 * 物理放不下任何标签，所以常驻名字只能落在**顶栏**：它不受轨道宽度限制，
 * 顺带也修好了抽屉态（<1024，侧栏整个收起时同样读不到位置）。
 *
 * 纯函数 + 单测：这条逻辑要读 viewMode / selectedFolderId 两个状态与文件夹表，
 * 拼错一个分支就是"标题说在回收站、列表却是全部笔记"。
 */
import { UNFILED_ID } from './store-types';
import type { ViewMode } from './store-types';

export interface ScopeInput {
  viewMode: ViewMode;
  /** null = 全部笔记；UNFILED_ID = 未分类；其余为文件夹 id */
  selectedFolderId: string | null;
  /** 文件夹 id → 名字（由调用方从 store 里取，保持本函数无副作用） */
  folderNames: Record<string, string>;
}

/** 需要的译文由调用方注入（这里不 import i18n 实例，保证可单测） */
export interface ScopeLabels {
  overview: string;
  all: string;
  favorites: string;
  trash: string;
  unfiled: string;
}

export function scopeLabel(i: ScopeInput, l: ScopeLabels): string {
  switch (i.viewMode) {
    case 'overview':
      return l.overview;
    case 'favorites':
      return l.favorites;
    case 'trash':
      return l.trash;
    case 'all':
      break;
    default:
      return l.all;
  }
  const id = i.selectedFolderId;
  if (id === null) return l.all;
  if (id === UNFILED_ID) return l.unfiled;
  // 文件夹被别端删掉、本地还没同步到：回落到"全部笔记"而不是显示 undefined
  return i.folderNames[id] ?? l.all;
}
