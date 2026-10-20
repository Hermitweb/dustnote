/**
 * toast 队列上限（§3.5 的"堆叠上限"那一项）
 *
 * 为什么单独测这个纯函数：上限写在 store 里就永远要靠"连点 5 次按钮"来验证，
 * 而那条路径在 e2e 里既慢又不稳。pushCapped 把规则抽成纯函数，一次说清。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TOAST_MAX, pushCapped, useToast, toast, type ToastItem } from './toast';

const item = (id: number): ToastItem => ({ id, kind: 'info', message: 'm' + id });
const ids = (list: ToastItem[]) => list.map((t) => t.id);

describe('pushCapped', () => {
  it('未触顶时按顺序追加', () => {
    expect(ids(pushCapped([], item(1)))).toEqual([1]);
    expect(ids(pushCapped([item(1), item(2)], item(3)))).toEqual([1, 2, 3]);
  });

  it('触顶时丢最旧的，长度恒定不超过上限', () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= 20; i++) list = pushCapped(list, item(i));
    expect(list).toHaveLength(TOAST_MAX);
    expect(ids(list)).toEqual([17, 18, 19, 20]);
  });

  it('新消息一定留下：批量失败时用户看到的是"最新那条错"，不是最早那条', () => {
    const list = pushCapped([item(1), item(2), item(3), item(4)], item(5));
    expect(ids(list)).toContain(5);
    expect(ids(list)).not.toContain(1);
  });

  it('上限是显式常量，不是散落在实现里的魔法数', () => {
    expect(TOAST_MAX).toBeGreaterThan(1);
    const list = pushCapped([item(1)], item(2), 2);
    expect(list).toHaveLength(2);
    expect(pushCapped([item(1), item(2)], item(3), 2)).toHaveLength(2);
  });
});

describe('useToast store + toast 命令式 API', () => {
  beforeEach(() => {
    // 重置 store：直接设 state.toasts = []
    useToast.setState({ toasts: [] });
    vi.useRealTimers();
  });

  it('show() 推入新 toast，dismiss() 移除指定 id', () => {
    useToast.getState().show('info', 'hello');
    expect(useToast.getState().toasts).toHaveLength(1);
    expect(useToast.getState().toasts[0]?.message).toBe('hello');

    const id = useToast.getState().toasts[0]!.id;
    useToast.getState().dismiss(id);
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it('toast.success / error / info 三种 API 都能 push', () => {
    toast.success('ok');
    toast.error('bad');
    toast.info('info');
    expect(useToast.getState().toasts).toHaveLength(3);
    const kinds = useToast
      .getState()
      .toasts.map((t) => t.kind)
      .sort();
    expect(kinds).toEqual(['error', 'info', 'success']);
  });

  it('show() 触顶 → 丢最旧', () => {
    for (let i = 0; i < 6; i++) toast.info(`m${i}`);
    expect(useToast.getState().toasts).toHaveLength(TOAST_MAX);
    // 后 4 条保留
    const msgs = useToast.getState().toasts.map((t) => t.message);
    expect(msgs).toContain('m5');
    expect(msgs).not.toContain('m0');
  });

  it('show() 默认 ttl: success/info=3s, error=5s（走 setTimeout 自动消失）', () => {
    vi.useFakeTimers();
    toast.success('s');
    toast.error('b');
    expect(useToast.getState().toasts).toHaveLength(2);
    // 推进 3s → success 应消失，error 仍在
    vi.advanceTimersByTime(3000);
    const after3s = useToast.getState().toasts;
    expect(after3s).toHaveLength(1);
    expect(after3s[0]?.kind).toBe('error');
    // 推进到 5s → error 也消失
    vi.advanceTimersByTime(2000);
    expect(useToast.getState().toasts).toHaveLength(0);
  });
});
