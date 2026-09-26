/**
 * 舞台头部（详情态的导航行，docs/ui-optimization.md §2.1）
 *
 * 列表与正文合并成一栏之后，「我在哪儿、还剩几篇、怎么回去」这三件事没有了
 * 第三列来承担，必须由这一行补回来：返回目的地 · 路径面包屑 · ‹ 3/11 › · Esc 提示。
 * 工具条（模式 / 格式 / 状态 / 动作）仍归 Editor，两行各管各的。
 */
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { stagePosition, stepInSet } from '../lib/stage';
import { Icon } from './Icon';

export function StageHead() {
  const { t } = useTranslation();
  const folders = useStore((s) => s.folders);
  const selectedNoteId = useStore((s) => s.selectedNoteId);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const destination = useStore((s) => s.viewMode);
  const selectedTag = useStore((s) => s.selectedTag);
  const stageOrder = useStore((s) => s.stageOrder);
  const selectNote = useStore((s) => s.selectNote);
  const selectFolder = useStore((s) => s.selectFolder);
  const setSelectedTag = useStore((s) => s.setSelectedTag);

  const pos = stagePosition(stageOrder, selectedNoteId);

  /** 目的地名：选中文件夹时用文件夹链，其余用视图名 */
  function scopeLabel(): string {
    /* 标签范围优先于视图名：头部要说清"现在看的是这一堆" */
    if (selectedTag) return `${t('sidebar.tags')} · ${selectedTag}`;
    if (destination === 'favorites') return t('sidebar.favorites');
    if (destination === 'trash') return t('sidebar.trash');
    if (!selectedFolderId) return t('sidebar.all');
    const chain: string[] = [];
    let cur = folders.find((f) => f.id === selectedFolderId);
    // 层级在创建时已限死（≤3），guard 只防脏数据成环
    for (let guard = 0; cur && guard < 12; guard++) {
      chain.unshift(cur.name);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    return chain.length > 0 ? chain.join(' / ') : t('sidebar.all');
  }

  /** 从概览的最近编辑点进来时，返回就是回概览；其余回本视图的根列表 */
  const back = () => {
    if (selectedTag) setSelectedTag(null);
    else if (destination === 'overview') selectNote(null);
    else selectFolder(null);
  };

  const step = (delta: 1 | -1) => {
    const next = stepInSet(stageOrder, selectedNoteId, delta);
    if (next) selectNote(next);
  };

  return (
    <nav
      aria-label={t('stage.nav_aria')}
      className="glass-2 flex h-9 flex-shrink-0 items-center gap-2 border-b border-surface-border bg-surface-card px-3 text-xs"
    >
      <button
        onClick={back}
        title={t('stage.back_hint')}
        className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-surface-muted transition-colors hover:bg-surface-bg hover:text-surface-fg"
      >
        <Icon name="arrow-left" size={14} />
        <span className="truncate">{scopeLabel()}</span>
      </button>

      {pos && (
        <span className="flex flex-shrink-0 items-center gap-0.5 tabular-nums text-surface-muted">
          <button
            onClick={() => step(-1)}
            disabled={pos.index <= 1}
            aria-label={t('stage.prev')}
            className="rounded px-1 py-1 hover:bg-surface-bg disabled:opacity-35"
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <span>
            {pos.index}/{pos.total}
          </span>
          <button
            onClick={() => step(1)}
            disabled={pos.index >= pos.total}
            aria-label={t('stage.next')}
            className="rounded px-1 py-1 hover:bg-surface-bg disabled:opacity-35"
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </span>
      )}

      <span className="ml-auto hidden text-surface-muted sm:inline">{t('stage.esc_hint')}</span>
    </nav>
  );
}

export default StageHead;
