/**
 * toast 队列上限（§3.5 的"堆叠上限"那一项）
 *
 * 为什么单独测这个纯函数：上限写在 store 里就永远要靠"连点 5 次按钮"来验证，
 * 而那条路径在 e2e 里既慢又不稳。pushCapped 把规则抽成纯函数，一次说清。
 */
import { describe, expect, it } from 'vitest';
import { TOAST_MAX, pushCapped, type ToastItem } from './toast';

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
