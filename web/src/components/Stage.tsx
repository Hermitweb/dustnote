/**
 * 舞台（UI 阶段 2.8）：两栏布局右侧那一栏，按状态机决定当前显示哪一态。
 *
 * 四个态全部接线：detail → StageHead + Editor，list / search → NoteList，overview → Overview。
 * 键盘：Esc 逐级回退（详情 → 命中列表 → 根列表 → 概览）；弹窗与输入框里不抢按键。
 *
 * 只放内容层，不放 <main>：唯一的 main 与 id="main-content"（跳转链接的目标）在 App.tsx。
 * 之前舞台和 Editor 各写了一个 main，嵌套 main + 重复 id 让"跳到主内容"落点不确定。
 */
import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { nextOnEscape, resolveStage, scopeBack, type StageInput } from '../lib/stage';
import { Editor } from './Editor';
import { Overview } from './Overview';
import { NoteList } from './NoteList';
import { StageHead } from './StageHead';

/** 焦点在输入控件里时不劫持按键（与 use-keyboard-shortcuts 同口径） */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

/** 从 store 现取舞台输入，Esc 与渲染用的是同一份事实 */
function stageInput(): StageInput {
  const s = useStore.getState();
  return {
    destination: s.viewMode,
    searchQuery: s.searchQuery,
    selectedNoteId: s.selectedNoteId,
    selectedFolderId: s.selectedFolderId,
    selectedTag: s.selectedTag,
  };
}

export function Stage() {
  // 订阅舞台的四个输入：值由 stageInput() 现取，这里只负责"变了就重渲染"
  useStore((s) => s.viewMode);
  useStore((s) => s.searchQuery);
  useStore((s) => s.selectedNoteId);
  useStore((s) => s.selectedTag);
  const mode = resolveStage(stageInput());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 弹窗 / 命令面板自己处理 Esc，别抢
      if (document.querySelector('[role="dialog"]')) return;
      if (isTypingTarget(e.target)) return;
      const input = stageInput();
      const action = nextOnEscape(input);
      if (action === 'stay') return;
      e.preventDefault();
      const st = useStore.getState();
      if (action === 'clear-search') st.setSearchQuery('');
      else if (action === 'close-detail') st.selectNote(null);
      else if (input.selectedTag)
        st.setSelectedTag(null); // 标签先退掉，回到本范围
      else if (scopeBack(input) === 'all') st.selectFolder(null);
      else st.setViewMode('overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mode === 'detail')
    return (
      <>
        <StageHead />
        <Editor />
      </>
    );

  // list / search：笔记列表就是舞台本身（两栏改造后树里不再嵌笔记）
  if (mode === 'list' || mode === 'search')
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-surface-bg">
        <NoteList />
      </div>
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-bg">
      <Overview />
    </div>
  );
}

export default Stage;
