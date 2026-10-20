/**
 * InputDialog 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { InputDialog } from '../components/InputDialog';

describe('InputDialog', () => {
  afterEach(() => cleanup());

  it('输入文本 → 点击确认触发 onConfirm 带 trim 值', () => {
    const onConfirm = vi.fn();
    const r = render(<InputDialog title="T" onConfirm={onConfirm} onCancel={() => undefined} />);
    const input = r.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, '  hello  ');
    const confirmBtn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('common.confirm')
    ) as HTMLElement;
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('hello');
  });

  it('空白输入 → 确认按钮 disabled', () => {
    const r = render(
      <InputDialog title="T" onConfirm={() => undefined} onCancel={() => undefined} />
    );
    const input = r.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, '   ');
    const confirm = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('common.confirm')
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('Enter 键在有内容时提交 onConfirm', () => {
    const onConfirm = vi.fn();
    const r = render(<InputDialog title="T" onConfirm={onConfirm} onCancel={() => undefined} />);
    const input = r.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, 'ok');
    fireEvent.keyDown(input, 'Enter');
    expect(onConfirm).toHaveBeenCalledWith('ok');
  });

  it('Esc 键 → onCancel', () => {
    const onCancel = vi.fn();
    render(<InputDialog title="T" onConfirm={() => undefined} onCancel={onCancel} />);
    fireEvent.keyDown(window, 'Escape');
    expect(onCancel).toHaveBeenCalled();
  });

  it('点击遮罩 → onCancel', () => {
    const onCancel = vi.fn();
    const r = render(<InputDialog title="T" onConfirm={() => undefined} onCancel={onCancel} />);
    const scrim = r.container.firstChild as HTMLElement;
    fireEvent.click(scrim);
    expect(onCancel).toHaveBeenCalled();
  });

  it('自定义 confirmLabel 显示', () => {
    const r = render(
      <InputDialog
        title="T"
        confirmLabel="提交"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(r.container.textContent).toContain('提交');
  });
});
