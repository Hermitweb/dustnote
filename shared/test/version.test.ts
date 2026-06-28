import { describe, it, expect } from 'vitest';
import { compareSemver, lt, gt, shouldForceUpdate } from '../src/version.js';

describe('version', () => {
  it('parses and compares semver', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.3.0', '1.2.99')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('prerelease < release', () => {
    expect(lt('1.0.0-rc.1', '1.0.0')).toBe(true);
    expect(lt('1.0.0-rc.1', '1.0.0-rc.2')).toBe(true);
  });

  it('force update levels', () => {
    const base = {
      current: '1.0.0',
      min: '1.0.0',
      recommended: '1.2.0',
      force: null as string | null,
    };

    expect(
      shouldForceUpdate({ ...base, current: '0.9.0', force: '1.0.0' })
    ).toBe('L0_block');

    expect(shouldForceUpdate({ ...base, current: '0.5.0', force: null })).toBe('L1_2nd_startup');

    expect(shouldForceUpdate({ ...base, current: '1.1.0', releaseDate: '2026-01-01' })).toBe(
      'L2_strong_prompt'
    );

    expect(shouldForceUpdate({ ...base, current: '1.2.0' })).toBeNull();
  });
});
