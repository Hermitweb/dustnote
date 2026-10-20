/**
 * Modal 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

describe('Modal', () => {
  afterEach(() => cleanup());

  it('渲染 title / children / footer', () => {
    const onClose = vi.fn();
    const r = render(
      <Modal title="Title" onClose={onClose} footer={<button>OK</button>}>
        Body content
      </Modal>
    );
    expect(r.container.textContent).toContain('Title');
    expect(r.container.textContent).toContain('Body content');
    expect(r.container.textContent).toContain('OK');
  });

  it('点击关闭按钮 → onClose', () => {
    const onClose = vi.fn();
    const r = render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    const closeBtn = r.container.querySelector('button[aria-label="common.close"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击遮罩 → onClose（默认）', () => {
    const onClose = vi.fn();
    const r = render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    const scrim = r.container.firstChild as HTMLElement;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击面板内部不触发 onClose', () => {
    const onClose = vi.fn();
    const r = render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    const panel = r.container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismissOnScrim=false → 点击遮罩不关闭', () => {
    const onClose = vi.fn();
    const r = render(
      <Modal title="T" onClose={onClose} dismissOnScrim={false}>
        x
      </Modal>
    );
    const scrim = r.container.firstChild as HTMLElement;
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc → onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    fireEvent.keyDown(window, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  afterEach(() => cleanup());

  it('variant=default 确认按钮使用 accent', () => {
    const r = render(
      <ConfirmDialog title="X" message="Y" onConfirm={() => undefined} onCancel={() => undefined} />
    );
    const btn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'common.confirm'
    ) as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('bg-accent-strong');
  });

  it('variant=danger 确认按钮使用 danger', () => {
    const r = render(
      <ConfirmDialog
        title="X"
        message="Y"
        variant="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    const btn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'common.confirm'
    ) as HTMLElement;
    expect(btn.className).toContain('bg-danger-solid');
  });

  it('点击确认 → onConfirm', () => {
    const onConfirm = vi.fn();
    const r = render(
      <ConfirmDialog title="X" message="Y" onConfirm={onConfirm} onCancel={() => undefined} />
    );
    const btn = r.container.querySelector('button.bg-accent-strong') as HTMLElement;
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('Esc → onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="X" message="Y" onConfirm={() => undefined} onCancel={onCancel} />);
    fireEvent.keyDown(window, 'Escape');
    expect(onCancel).toHaveBeenCalled();
  });

  it('点击遮罩 → onCancel（默认 dismissOnScrim=true）', () => {
    const onCancel = vi.fn();
    const r = render(
      <ConfirmDialog title="X" message="Y" onConfirm={() => undefined} onCancel={onCancel} />
    );
    const scrim = r.container.firstChild as HTMLElement;
    fireEvent.click(scrim);
    expect(onCancel).toHaveBeenCalled();
  });
});
