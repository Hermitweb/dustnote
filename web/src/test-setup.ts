/**
 * Vitest 测试环境初始化
 *
 * jsdom 21.x 未实现 Blob.text() / Blob.arrayBuffer() 等 Promise 风格方法，
 * 这里通过 FileReader 提供 polyfill，让导出相关测试可在 jsdom 下运行。
 */

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
