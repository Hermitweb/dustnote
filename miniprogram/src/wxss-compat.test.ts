/**
 * WXSS 兼容性回归测试（上传编译只在微信服务端做，本地 Taro 构建、CI、预览都不报）
 *
 * 为什么必须有：2.5.48 首次小程序上传实锤——`.motion-flat *` 通配选择器（2.5.47 引入）
 * 让微信上传编译报 `app.wxss(1:105650): unexpected token '*'`，且因为它在 2.5.47 就进了
 * 源码，小程序端从 2.5.47 起就再没通过过上传编译，两轮发版都无人发现。
 * 这类"只有真上传才现形"的缺陷必须有静态断言守着（compose 端口门禁同族）。
 */
import { test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 剥掉块注释与行注释——注释里的 `*` 是合法的，不参与判定。 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 判定选择器位是否出现 `*`：覆盖 `* {}`、`*::before`、`.a *`、`, *` 四种写法。
 * `calc()` 里的乘号（`*` 前是数字/右括号且后跟操作数）不属于选择器位，不在判定内。
 */
export function hasWildcardSelector(css: string): boolean {
  return /(^|[,{]\s*)\*([:{.\s[]|$)/m.test(css) || /[\w)\]]\s+\*\s*[{,]/m.test(css);
}

/** 递归收集 src 下所有 scss 源文件（新增样式文件自动纳入，不用改这份测试）。 */
function collectScss(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectScss(p));
    else if (name.endsWith('.scss')) out.push(p);
  }
  return out;
}

test('判定器对 2.5.48 上传实录的四种事故形态都必须判红', () => {
  // 当年让整包上传失败的原始形态（.motion-flat 块，已改令牌清零）
  expect(hasWildcardSelector('.motion-flat *,\n.motion-flat *::before { animation: none; }')).toBe(
    true
  );
  expect(hasWildcardSelector('* { box-sizing: border-box; }')).toBe(true);
  expect(hasWildcardSelector('.a, *::after { x: y; }')).toBe(true);
  expect(hasWildcardSelector('.card * { color: red; }')).toBe(true);
});

test('判定器不得误伤：注释里的星号与 calc 乘法', () => {
  expect(hasWildcardSelector(stripComments('/* 通配 * 不算 */ .a { margin: 0; }'))).toBe(false);
  expect(hasWildcardSelector('.a { width: calc(2 * 10rpx); }')).toBe(false);
  expect(hasWildcardSelector('.a { width: calc(100% - 2 * 8rpx); }')).toBe(false);
});

test('仓库样式源码（全部 scss）当前不含通配选择器', () => {
  const offenders: string[] = [];
  for (const file of collectScss(HERE)) {
    if (hasWildcardSelector(stripComments(readFileSync(file, 'utf8')))) {
      offenders.push(file);
    }
  }
  // 失败时列出全部文件，一次修完而不是修一个撞一个
  expect(offenders).toEqual([]);
});
