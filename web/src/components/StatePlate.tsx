/**
 * 状态版面（空 / 加载 / 错误三态的统一起版）
 *
 * 为什么要有这个组件：三态此前各自起版——空状态是「44 圆角块 + 图标 + 一行标题 +
 * 一行提示 + 动作」，而错误屏是「一个 40px 图标 + 一段自己的排版」。同一件
 * "告诉用户现在是什么情况、下一步能做什么"的事，在三个地方长三种样子，
 * 用户每次都要重新读一遍。§3.5 说的"插图节奏"缺的就是这个。
 *
 * 两档，节奏相同、体量不同（这是设计判断，不是遗漏）：
 * plate 舞台级：空态、舞台内加载 —— 图版 44、图标 20、标题 text-sm
 * card 卡片级：阻断式错误屏（连接失败 / 崩溃 / 强制更新）—— 图版 56、图标 28、标题 text-lg
 * 两档的间距节奏完全一致，所以从空态切到错误屏不会看见节奏变化。
 *
 * 节奏（写死在这里，不在调用点重排）：
 * 图版 →12→ 标题 →6→ 提示 →12→ 详情 →12→ 动作
 * 提示 text-xs / secondary，最多两句，居中，max-w-md
 * 详情 可选，只有错误屏用：原始错误码 / 服务端返回，等宽、可断行、自带底色
 * 动作 最多三个；没有动作时整段不占位
 * 加载 busy 时图版位置换成 spinner，**外框尺寸不变**——切状态不许跳版
 *
 * 三端各自实现（web 组件 / 小程序 .state-plate / RN StyleSheet），规格以本文件为准。
 */
import type { ReactNode } from 'react';
import { ILL_SIZES, type IllName } from '@dustnote/shared';
import { Icon, type IconName } from './Icon';
import { Illustration } from './Illustration';

export type StateTone = 'info' | 'guide' | 'danger';
export type StatePlateSize = 'plate' | 'card';

/** 图标色由 tone 决定；文字色一律走语义令牌，不写死 */
/**
 * 插画的墨色另开一张表，不复用 TONE_ICON。
 * 图标整体染成强调色是对的（它只有一个笔画体量）；插画染整张就直接违反规则 2
 * ——「accent 只点一处，那个你现在能做的动作」。这条不是猜的：由共享几何生成的
 * 样张里，first-use 整本书都是蓝的，而手画的 mock 恰好用了中性色，把它盖住了。
 */
const ILL_INK: Record<StateTone, string> = {
  info: 'text-text-tertiary',
  /** guide 的强调只落在插画自己标了 accent 的那一处，不染整张 */
  guide: 'text-text-tertiary',
  /** danger 例外：出错这件事要整张都读得出来，不靠局部 */
  danger: 'text-danger',
};

const TONE_ICON: Record<StateTone, string> = {
  /** 次级灰：单纯"这里还没有东西" */
  info: 'text-text-tertiary',
  /** 强调色：需要用户做第一步（首次使用、连接失败后的重试） */
  guide: 'text-accent-text',
  /** 危险色：出错了，不是空的 */
  danger: 'text-danger',
};

const TILE: Record<StatePlateSize, { box: string; icon: 20 | 28; title: string; pad: string }> = {
  /** 舞台级：自己就是整块区域，上下给足呼吸 */
  plate: { box: 'h-11 w-11', icon: 20, title: 'text-sm', pad: 'px-6 py-12' },
  /** 卡片级：外层卡片自带 padding，这里不再叠第二层 */
  card: { box: 'h-14 w-14', icon: 28, title: 'text-lg', pad: 'px-2' },
};

/**
 * 卡片档按钮：错误屏的动作以前在每个调用点手抄一遍类名（三份各有细微不一致，
 * 其中一份还漏了 transition-colors）。收在这里，调用点只给行为。
 */
export const CARD_BTN_PRIMARY =
  'min-w-[7rem] flex-1 rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-on transition-colors hover:bg-accent-strong-hover';
export const CARD_BTN_SECONDARY =
  'min-w-[7rem] flex-1 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-bg';

export interface StatePlateProps {
  /**
   * 图形槽：icon（44/56 方框里一枚 lucide）或 illust（88x64 / 120x88 画幅）。
   * 两个都传时 illust 优先 —— 一块状态版面里既画图又画图标只会互相抢注意力。
   * 两个都不传就没有图形槽，标题直接顶上（少数极紧凑的卡里是想要的效果）。
   */
  icon?: IconName;
  illust?: IllName;
  tone?: StateTone;
  /** plate=舞台级（默认），card=阻断式错误屏 */
  size?: StatePlateSize;
  title: string;
  hint?: ReactNode;
  /** 错误屏的原始信息（错误码 / 服务端响应）；正常态不要传 */
  detail?: ReactNode;
  actions?: ReactNode;
  /** 转圈占位（加载态）：给了它就不渲染图标，外框尺寸保持不变 */
  busy?: boolean;
}

export function StatePlate({
  icon,
  illust,
  tone = 'info',
  size = 'plate',
  title,
  hint,
  detail,
  actions,
  busy = false,
}: StatePlateProps) {
  const t = TILE[size];
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-3 ${t.pad} text-center`}>
      {/*
       * 外框尺寸由"当前是哪一档状态"决定，且 busy 与非 busy 必须同尺寸 ——
       * 插画态忙起来若缩回 44 方框，标题就会跳一下，那是本节开头明令禁止的事。
       */}
      <div
        className="flex items-center justify-center"
        style={illust ? { width: ILL_SIZES[size].w, height: ILL_SIZES[size].h } : undefined}
      >
        {busy ? (
          <span className="state-plate-spinner" aria-hidden="true" />
        ) : illust ? (
          <Illustration name={illust} size={size} className={ILL_INK[tone]} />
        ) : (
          <span
            className={`glass-2 flex ${t.box} items-center justify-center rounded-lg border border-surface-border bg-surface-card ${TONE_ICON[tone]}`}
          >
            {icon ? <Icon name={icon} size={t.icon} /> : null}
          </span>
        )}
      </div>
      {/* 标题与提示之间的 6px 由这个内层 gap 给，外层保持 12px 的两段节奏 */}
      <div className="flex flex-col items-center gap-1.5">
        <p className={`${t.title} font-medium text-text-primary`}>{title}</p>
        {hint ? <p className="max-w-md text-xs text-text-secondary">{hint}</p> : null}
      </div>
      {detail ? (
        <div className="w-full max-w-md rounded-lg bg-surface-bg px-3 py-2 text-left text-xs text-text-secondary">
          {detail}
        </div>
      ) : null}
      {actions ? (
        <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
