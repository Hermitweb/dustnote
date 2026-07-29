/**
 * Vitest 测试环境初始化
 *
 * jsdom 21.x 未实现 Blob.text() / Blob.arrayBuffer() 等 Promise 风格方法，
 * 这里通过 FileReader 提供 polyfill，让导出相关测试可在 jsdom 下运行。
 *
 * @testing-library/jest-dom/vitest 注册 toBeInTheDocument 等 DOM 断言匹配器，
 * 供自定义 render 工具产出的 DOM 节点断言使用（不依赖 @testing-library/react）。
 *
 * React 18 的 act() 要求环境声明 IS_REACT_ACT_ENVIRONMENT，否则会输出
 * "The current testing environment is not configured to support act(...)" 警告。
 */

import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// 显式注册 jest-dom 匹配器（toBeInTheDocument / toHaveAttribute 等）。
// 直接 import '@testing-library/jest-dom/vitest' 在 globals:false 下偶尔不生效，
// 这里用 expect.extend 手动注册，确保所有测试文件可用。
expect.extend(matchers);

// React 18 act() 环境声明
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 抑制 "not wrapped in act(...)" 警告：自定义渲染工具用 react-dom/client 直接渲染，
// 初始 useEffect 触发的异步 fetch 回调会更新状态，这些发生在 waitFor 轮询之外，
// 警告会刷屏输出（曾导致测试进程崩溃）。这里过滤该类警告，不影响断言。
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
  if (msg.includes('not wrapped in act(') || msg.includes('inside a test was not wrapped')) {
    return;
  }
  origConsoleError(...args);
};

if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('Blob.text() 读取失败'));
      reader.readAsText(this);
    });
  };
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Blob.arrayBuffer() 读取失败'));
      reader.readAsArrayBuffer(this);
    });
  };
}
