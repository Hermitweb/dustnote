/**
 * 主题卡：显示**真实配色**，不是一个传达不了颜色的 emoji（阶段 2.6）
 *
 * 改造前是 `🌿 尘心晨光` / `🫧 液态玻璃` 这种卡片：选中哪套只能靠读名字，
 * 而"雾霭蓝"和"暮色森林"差在哪，一个叶子图标说不出来。
 * 现在每张卡直接画一遍两套底色 + 卡片色 + 文字色带 + accent 圆点，
 * 明暗两态同屏可见 —— 选主题这件事应该用眼睛决定，不是用中文名字猜。
 *
 * 颜色不写在这里：全部由 @dustnote/shared 的种子表派生（与界面实际用的同一套），
 * 所以这张卡不可能"画得比实际好看"。
 */
import { useTranslation } from 'react-i18next';
import { THEME_SEEDS, resolvePalette, type ThemeDef } from '@dustnote/shared';

/**
 * 种子表按 id 索引。theme.ts 在模块加载时就自检过「UI 列表 ⊆ 种子表」，
 * 所以这里只是让类型系统也认这件事，不是把 bug 咽下去。
 */
const seedOf = (id: ThemeId): ThemeDef => THEME_SEEDS[id] as ThemeDef;
import type { ThemeId } from '../lib/store';
import { Icon } from './Icon';

/** 单侧（明或暗）的迷你预览：底 + 一张卡 + 两条文字带 + accent 点 */
function Side({ id, mode }: { id: ThemeId; mode: 'light' | 'dark' }) {
  const p = resolvePalette(seedOf(id), mode);
  return (
    <span
      className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border p-1.5"
      style={{ background: p.bg, borderColor: p.border }}
      aria-hidden={true}
    >
      <span className="flex items-center gap-1 rounded-sm px-1 py-1" style={{ background: p.card }}>
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: p.accent }} />
        <span className="h-1 flex-1 rounded-full" style={{ background: p.fg }} />
      </span>
      <span className="h-1 w-3/4 rounded-full" style={{ background: p.muted }} />
      <span className="h-1 w-1/2 rounded-full" style={{ background: p.muted }} />
    </span>
  );
}

export function ThemeCard({
  id,
  selected,
  onSelect,
}: {
  id: ThemeId;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const accent = resolvePalette(seedOf(id), 'light').accent;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      type="button"
      className={`relative flex flex-col gap-1.5 rounded-lg border-2 p-2 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent-soft/30 dark:bg-accent/20'
          : 'border-surface-border hover:bg-surface-bg'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="h-3 w-3 flex-none rounded-full ring-1 ring-black/10"
          style={{ background: accent }}
        />
        <span className="truncate text-xs font-medium text-text-primary">
          {t(`settings.theme_${id}`)}
        </span>
      </span>
      <span className="flex gap-1">
        <Side id={id} mode="light" />
        <Side id={id} mode="dark" />
      </span>
      {/* 选中态：右上角 Check 徽标（§2.5），不靠"整块变色"表达选中 */}
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-strong text-white">
          <Icon name="check" size={14} />
        </span>
      )}
    </button>
  );
}

export default ThemeCard;
