/**
 * 编辑器图片拖拽 / 粘贴处理（S-2 懒人化体验）
 *
 * 设计取舍：
 * - 个人项目，不引入服务端附件存储与 E2EE 密文管理成本
 * - 直接把图片压缩成 data URL 内联进 Markdown（![alt](data:image/...)）
 * - sanitize-html 已放行 data:image/(png|jpeg|gif|webp);base64，渲染安全
 * - 通过 canvas 压缩：限制最大边 1600px、JPEG 质量 0.82，避免笔记体积爆炸
 * - 透明 PNG 保留为 PNG（避免黑底）
 *
 * 安全：data URL 由本地 canvas 生成，不涉及外部网络；不读取 EXIF 之外的元数据
 */

/** 压缩参数 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
/** 单张图片硬上限（bytes），超过则进一步压缩或拒绝 */
const MAX_BYTES = 4 * 1024 * 1024;

/** 判断文件是否为可处理的图片 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** 读取 File 为 HTMLImageElement（用于 canvas 绘制） */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    img.src = url;
  });
}

/** canvas 压缩并输出 data URL；保持比例，长边不超过 maxEdge */
async function compressImage(img: HTMLImageElement, keepAlpha: boolean): Promise<string> {
  let { width, height } = img;
  if (width > MAX_EDGE || height > MAX_EDGE) {
    const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(img, 0, 0, width, height);

  // 有透明通道时保留 PNG，否则用 JPEG 体积更小
  if (keepAlpha) {
    return canvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * 把一个图片 File 转成压缩后的 data URL
 * @returns { dataUrl, alt }
 */
export async function fileToImageDataUrl(file: File): Promise<{ dataUrl: string; alt: string }> {
  if (!isImageFile(file)) {
    throw new Error('非图片文件');
  }
  const img = await loadImage(file);

  // JPEG 直接压缩；PNG/WEBP/GIF 先尝试 JPEG（无透明时更小），失败回退 PNG
  const isJpeg = file.type === 'image/jpeg';
  let keepAlpha = !isJpeg;
  // 对 PNG 做一次透明度探测：绘制到 canvas 后读取 alpha 通道
  if (!isJpeg) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(img.width, 32);
      canvas.height = Math.min(img.height, 32);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = true;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i]! < 255) {
            opaque = false;
            break;
          }
        }
        keepAlpha = !opaque;
      }
    } catch {
      // getImageData 被 CORS 拦截时保守保留 PNG
      keepAlpha = true;
    }
  }

  let dataUrl = await compressImage(img, keepAlpha);

  // 仍超限则降低质量再压一次
  if (dataUrl.length > MAX_BYTES) {
    dataUrl = await compressImage(img, false);
    if (dataUrl.length > MAX_BYTES) {
      // 最终仍超限：缩到 800px
      const small = document.createElement('canvas');
      const ratio = Math.min(800 / img.width, 800 / img.height, 1);
      small.width = Math.round(img.width * ratio);
      small.height = Math.round(img.height * ratio);
      const ctx = small.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, small.width, small.height);
        dataUrl = small.toDataURL('image/jpeg', 0.7);
      }
    }
  }

  const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
  return { dataUrl, alt };
}

/**
 * 生成 Markdown 图片语法
 */
export function buildMarkdownImage(dataUrl: string, alt: string): string {
  return `![${alt}](${dataUrl})`;
}

/**
 * 在 textarea 当前光标处插入文本（支持选中替换）
 * @returns 新的 value 与光标位置
 */
export function insertAtCursor(
  textarea: HTMLTextAreaElement,
  insertText: string
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  // 前后各补一个换行，避免与现有文本粘连
  const prefix = before.length > 0 && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after.length > 0 && !after.startsWith('\n') ? '\n\n' : '';
  const inserted = `${prefix}${insertText}${suffix}`;
  const value = before + inserted + after;
  const cursor = start + inserted.length;
  return {
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}
