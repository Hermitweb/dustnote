/**
 * AppErrorBoundary 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '../test/render';

vi.mock('../lib/diagnostics', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
  exportDiagnostics: vi.fn(async () => undefined),
}));

import { AppErrorBoundary } from '../components/AppErrorBoundary';

const Boom = ({ throwIt }: { throwIt: boolean }) => {
  if (throwIt) throw new Error('boom');
  return <div data-testid="ok">safe</div>;
};

describe('AppErrorBoundary', () => {
  afterEach(() => cleanup());

  it('正常 children 透传渲染', () => {
    const r = render(
      <AppErrorBoundary>
        <Boom throwIt={false} />
      </AppErrorBoundary>
    );
    expect(r.container.querySelector('[data-testid="ok"]')).toBeTruthy();
  });

  it('子组件抛错 → 进入错误态（渲染重试/导出按钮）', () => {
    const r = render(
      <AppErrorBoundary>
        <Boom throwIt={true} />
      </AppErrorBoundary>
    );
    expect(r.container.querySelector('button')).toBeTruthy();
  });
});
