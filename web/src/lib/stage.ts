/**
 * 舞台状态机（UI 阶段 2.8 的契约层，docs/ui-optimization.md §2.1）
 *
 * 两栏 = 导航轨（树常驻）+ 舞台。舞台同一时刻只处于一个态：
 *   overview  概览：统计 + 最近编辑 + 快捷入口（首屏落点）
 *   list      列表：当前范围（全部 / 文件夹 / 收藏 / 回收站）的笔记列表
 *   detail    详情：打开的笔记（编辑 / 分屏 / 预览 / 所见即所得）
 *   search    搜索：查询非空时的命中列表
 *
 * 这里只放纯函数：输入是 store 里已有的事实，输出是态与导航结果。
 * 好处是「该显示什么」第一次变成可单测的东西 —— 之前它散在 Sidebar 与 Editor 的
 * 若干 if (!note) return ... 里，改布局时只能靠肉眼回归。
 */
import type { ViewMode } from './store-types';

export type StageMode = 'overview' | 'list' | 'detail' | 'search';

export interface StageInput {
  /** 导航轨当前目的地。overview 表示「还没决定要看哪一堆笔记」 */
  destination: ViewMode;
  searchQuery: string;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  /** 导航轨标签段选中的标签（与文件夹互斥，同为一层"范围"） */
  selectedTag: string | null;
}

/**
 * 优先级：detail > search > list > overview。
 *
 * detail 压在 search 之上是有意的：点开一条命中后要能读到正文，而不是被结果列表
 * 弹回去。为此 setSearchQuery 在查询变非空时清掉选中笔记（「开始搜索 = 离开正文」），
 * 于是两态各司其职：打字时列表接管舞台，点开时正文接管舞台，查询词留在框里等 Esc。
 */
export function resolveStage({
  destination,
  searchQuery,
  selectedNoteId,
  selectedTag,
}: StageInput): StageMode {
  if (selectedNoteId) return 'detail';
  if (searchQuery.trim()) return 'search';
  // 选了标签就已经决定「看哪一堆」，哪怕目的地还停在概览
  if (destination === 'overview' && !selectedTag) return 'overview';
  return 'list';
}

/** Esc 的一次按键要做的事。逐级回退，最后一级不动作（避免"按 Esc 页面跳来跳去"） */
export type EscapeAction = 'clear-search' | 'close-detail' | 'clear-scope' | 'stay';

/** 是否还在子范围里：非「全部笔记」视图、选了文件夹、或选了标签 */
function inSubScope(input: StageInput): boolean {
  return (
    input.destination !== 'all' || input.selectedFolderId !== null || input.selectedTag !== null
  );
}

export function nextOnEscape(input: StageInput): EscapeAction {
  const mode = resolveStage(input);
  if (mode === 'detail') return 'close-detail';
  if (mode === 'search') return 'clear-search';
  // list：子范围（文件夹 / 收藏 / 回收站）先回根列表，根列表再回概览
  if (mode === 'list') return inSubScope(input) ? 'clear-scope' : 'stay';
  return 'stay';
}

/**
 * clear-scope 的去向：子范围 → 全部笔记，根列表 → 概览。
 * 拆成函数是因为这一步要在 data-slice 之外决定"回哪"，而它必须是可单测的。
 */
export function scopeBack(input: StageInput): 'all' | 'overview' {
  return inSubScope(input) ? 'all' : 'overview';
}

/**
 * 结果集内翻篇（左右方向键 / ‹ › 按钮）。到边界停住而不是循环 —— 循环会让用户失去「到头了」的反馈。
 * 当前项不在集合里（例如从概览的最近编辑点进来）时，前进取首个、后退取末个。
 */
export function stepInSet<T>(ids: readonly T[], current: T | null, delta: 1 | -1): T | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return delta > 0 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  const next = at + delta;
  if (next < 0 || next >= ids.length) return ids[at] ?? null;
  return ids[next] ?? null;
}

/** 舞台头部的位置指示：不在结果集里（从概览进来的）就不显示 ‹ 3/11 › */
export function stagePosition(
  order: readonly string[],
  id: string | null
): { index: number; total: number } | null {
  if (!id) return null;
  const at = order.indexOf(id);
  if (at < 0) return null;
  return { index: at + 1, total: order.length };
}

/** 舞台头部要不要显示「返回」：只有详情态需要（其余态本身就是落点） */
export const stageHasBack = (mode: StageMode): boolean => mode === 'detail';
