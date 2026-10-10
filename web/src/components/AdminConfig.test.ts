/**
 * AdminConfig 校验函数回归（部署管理板块）
 *
 * validateApiBase / validateMpAppId 是纯函数，直接测形状判定。
 * apiBase 填错曾静默保存（所有客户端连不上）——校验是那次隐患的防回潮。
 */
import { describe, it, expect } from 'vitest';
import { validateMpAppId } from './AdminConfig';

// validateApiBase 未导出——经 export 化（与 validateMpAppId 同批）后补此测试。
// 这里只测已导出的 AppID 校验；apiBase 校验由 UI 联动覆盖（保存按钮拦截路径）。
describe('validateMpAppId', () => {
  it('空串合法（选填字段）', () => {
    expect(validateMpAppId('')).toBeNull();
    expect(validateMpAppId('   ')).toBeNull();
  });

  it('标准格式合法：wx + 16 位小写 hex（miniprogram/project.config.json 实例）', () => {
    expect(validateMpAppId('wx29cbaab430c2a098')).toBeNull();
  });

  it('大写 hex 非法', () => {
    expect(validateMpAppId('wx29CBAAB430C2A098')).toBe('admin.validate_appid');
  });

  it('长度不足/超出非法', () => {
    expect(validateMpAppId('wx123')).toBe('admin.validate_appid');
    expect(validateMpAppId('wx29cbaab430c2a0980')).toBe('admin.validate_appid');
  });

  it('缺 wx 前缀非法', () => {
    expect(validateMpAppId('29cbaab430c2a098xx')).toBe('admin.validate_appid');
  });
});
