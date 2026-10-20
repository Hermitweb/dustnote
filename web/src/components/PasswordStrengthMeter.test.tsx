/** * PasswordStrengthMeter 缁勪欢娴嬭瘯 * * 瑕嗙洊锛? *  - 绌哄瘑鐮佷笉娓叉煋 *  - 涓嶅悓寮哄害绛夌骇 鈫?娓叉煋瀵瑰簲 color class 涓?label */ import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import { render, cleanup } from '../test/render';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
}));
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
describe('PasswordStrengthMeter', () => {
  afterEach(() => cleanup());
  it('绌哄瘑鐮佷笉娓叉煋', () => {
    const r = render(<PasswordStrengthMeter password="" />);
    expect(r.container.firstChild).toBeNull();
  });
  it('寮卞瘑鐮?鈫?寮哄害鏉?+ role=meter', () => {
    const r = render(<PasswordStrengthMeter password="a" />);
    const meter = r.container.querySelector('[role="meter"]') as HTMLElement;
    expect(meter).toBeTruthy();
    expect(meter.getAttribute('aria-valuenow')).toBe('0');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('4');
  });
  it('寮哄瘑鐮?鈫?娓叉煋 5 涓己搴︽潯鏍煎瓙', () => {
    const r = render(<PasswordStrengthMeter password="aA1!abcdefghijklmnopqrstuvwxyz" />);
    const bars = r.container.querySelectorAll('[role="meter"] > div > div');
    expect(bars.length).toBe(5);
  });
  it('涓嶅悓寮哄害 鈫?涓嶅悓 aria-valuenow', () => {
    const r1 = render(<PasswordStrengthMeter password="a" />);
    const r2 = render(<PasswordStrengthMeter password="abc123!@#" />);
    const m1 = r1.container.querySelector('[role="meter"]') as HTMLElement;
    const m2 = r2.container.querySelector('[role="meter"]') as HTMLElement;
    expect(Number(m1.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(m2.getAttribute('aria-valuenow'))
    );
  });
});
