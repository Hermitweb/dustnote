/**
 * 材质与极光（阶段 3 · docs/ui-optimization.md §2.2）
 *
 * 为什么不塞进 `Preferences`：
 * 1. 服务端 `preferences` 表是固定列（theme/mode/font/density/auto_lock/language），
 *    多出来的键要么被丢要么 400 —— 见 server/src/routes/account.ts 的显式 SELECT；
 * 2. 更重要的是它本来就不该跨端同步：玻璃吃 `backdrop-filter`，同一份偏好在
 *    弱机 / 省电模式 / 大屏投影上正确性完全不同。这是**本机渲染偏好**，
 *    和"用哪个主题"不是一类东西。
 *
 * 所以：单独一个 localStorage key + 一个极小的 zustand store（与 lib/toast.ts 同形）。
 */
import { create } from 'zustand';

export type EffectMode = 'glass' | 'flat';
/** 极光乘数：0 关 / 0.5 柔和（默认）/ 1 标准 / 1.4 浓郁 */
export const AURORA_LEVELS = [0, 0.5, 1, 1.4] as const;
export type AuroraLevel = (typeof AURORA_LEVELS)[number];

export const EFFECT_STORAGE_KEY = 'dustnote_effect';

export interface EffectPrefs {
  effect: EffectMode;
  aurora: AuroraLevel;
}

/** 默认：玻璃开 + 柔和极光。上一版极光吃满（等效 1.4），概览与列表像泡在蓝雾里 */
export const DEFAULT_EFFECT: EffectPrefs = { effect: 'glass', aurora: 0.5 };

function isAurora(v: unknown): v is AuroraLevel {
  return typeof v === 'number' && (AURORA_LEVELS as readonly number[]).includes(v);
}

export function loadEffectPrefs(): EffectPrefs {
  try {
    const raw = localStorage.getItem(EFFECT_STORAGE_KEY);
    if (!raw) return DEFAULT_EFFECT;
    const p = JSON.parse(raw) as Partial<EffectPrefs>;
    return {
      effect: p.effect === 'flat' ? 'flat' : 'glass',
      aurora: isAurora(p.aurora) ? p.aurora : DEFAULT_EFFECT.aurora,
    };
  } catch {
    return DEFAULT_EFFECT;
  }
}

function persist(p: EffectPrefs): void {
  try {
    localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式写不进：内存里生效即可，下次开机回到默认 */
  }
}

/**
 * 写进 DOM。关闭玻璃时把乘数强制归零 —— 极光本身没有"实色模式"，
 * 留着它就成了"文字直接压在渐变上"，违反 §2.2 的硬约束。
 */
export function applyEffect(p: EffectPrefs = loadEffectPrefs()): void {
  const root = document.documentElement;
  root.dataset.effect = p.effect;
  root.style.setProperty('--mn-aurora', String(p.effect === 'glass' ? p.aurora : 0));
}

interface EffectStore extends EffectPrefs {
  setEffect: (mode: EffectMode) => void;
  setAurora: (level: AuroraLevel) => void;
}

export const useEffectStore = create<EffectStore>((set, get) => ({
  ...loadEffectPrefs(),
  setEffect: (effect) => {
    const next = { ...get(), effect };
    persist({ effect: next.effect, aurora: next.aurora });
    applyEffect({ effect: next.effect, aurora: next.aurora });
    set({ effect });
  },
  setAurora: (aurora) => {
    const prev = get();
    const next: EffectPrefs = { effect: prev.effect, aurora };
    persist(next);
    applyEffect(next);
    set({ aurora });
  },
}));
