/**
 * 图片存储优化
 *
 * 将笔记内容中的 base64 data URL 图片提取到独立存储（IndexedDB），
 * 笔记内容只保留引用标记 `![alt](dustnote-img://id)`。
 *
 * 优化前：一张 1MB 图片在笔记内容中占 ~1.37MB（base64 编码膨胀 33%）
 * 优化后：笔记内容只存 `![alt](dustnote-img://abc123)`（~40 字节），图片本体存在 IndexedDB
 */

const IMAGE_STORE = 'dustnote-images';
const DB_NAME = 'dustnote-image-store';
const DB_VERSION = 1;

/** 生成随机图片 ID */
function generateImageId(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(36).padStart(2, '0')).join('');
}

/** 打开图片数据库 */
function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMAGE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 缺图占位（P0-3 图片止血，2026-09-25）：
 * dustnote-img:// 引用只在「插入它的那台设备 + 该浏览器 profile」可解析
 * （图片本体在 IndexedDB，同步/分享/导出链路上对端拿不到）。渲染端遇到
 * 还原后仍残留的引用必须替换为本占位，而不是渲染破图/空白——空白会让用户
 * 误以为笔记数据丢了。附件系统 v1（roadmap R2）落地前，这是数据风险的兜底。
 */
export const MISSING_IMAGE_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96">
<rect width="100%" height="100%" rx="8" fill="#eef2f0" stroke="#c9d6cf"/>
<text x="50%" y="42%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#5b6b62">图片未同步到本设备</text>
<text x="50%" y="66%" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#8aa093">Image not synced to this device</text>
</svg>`
  );

/** 把还原后仍残留的 dustnote-img:// 引用替换为占位图（用于一切渲染出口） */
export function replaceMissingImageRefs(content: string): string {
  return content.replace(
    /!\[([^\]]*)\]\(dustnote-img:\/\/[a-z0-9]+\)/g,
    (_m, alt: string) => `![${alt || '图片'}](${MISSING_IMAGE_PLACEHOLDER})`
  );
}

/**
 * 存储图片。入参是**完整 data URL**（含 MIME）——此前只存 base64 段，
 * 恢复端硬编码 image/png，jpeg/webp/gif 图片恢复后 MIME 错误（真 bug，
 * P0-3 止血顺带修复）。旧格式值（无逗号前缀）在 getImage 消费端兼容。
 */
export async function storeImage(blob: string): Promise<string> {
  const id = generateImageId();
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(blob, id);
    tx.oncomplete = () => {
      db.close();
      resolve(id);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** 读取图片 blob */
export async function getImage(id: string): Promise<string | null> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readonly');
    const req = tx.objectStore(IMAGE_STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** 删除图片 */
export async function deleteImage(id: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const DUSTNOTE_IMG_PROTOCOL = 'dustnote-img://';
const BASE64_IMG_REGEX = /!\[([^\]]*)\]\(data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)\)/g;

/**
 * 优化笔记内容：提取 base64 图片到 IndexedDB，替换为引用标记
 *
 * 输入：`![photo](data:image/png;base64,iVBOR...)`
 * 输出：`![photo](dustnote-img://abc123)`
 */
export async function optimizeNoteImages(content: string): Promise<string> {
  let result = content;
  const matches = [...content.matchAll(BASE64_IMG_REGEX)];
  for (const match of matches) {
    const [fullMatch, alt, base64] = match;
    if (!fullMatch || !base64) continue;
    try {
      const id = await storeImage(base64);
      result = result.replace(fullMatch, `![${alt}](${DUSTNOTE_IMG_PROTOCOL}${id})`);
    } catch {
      /* 存储失败时保留原始 base64 */
    }
  }
  return result;
}

const DUSTNOTE_IMG_REGEX = /!\[([^\]]*)\]\(dustnote-img:\/\/([a-z0-9]+)\)/g;

/**
 * 还原笔记内容：将引用标记替换为 base64 data URL（用于预览/导出）
 */
export async function restoreNoteImages(content: string): Promise<string> {
  let result = content;
  const matches = [...content.matchAll(DUSTNOTE_IMG_REGEX)];
  for (const match of matches) {
    const [fullMatch, alt, id] = match;
    if (!fullMatch || !id) continue;
    try {
      const stored = await getImage(id);
      if (stored) {
        // 新格式存的是完整 data URL（自带 MIME）；旧格式只有 base64 段，
        // 兼容回退到 image/png（历史行为）。
        const dataUrl = stored.startsWith('data:') ? stored : `data:image/png;base64,${stored}`;
        result = result.replace(fullMatch, `![${alt}](${dataUrl})`);
      }
    } catch {
      /* 读取失败时保留引用标记 */
    }
  }
  return result;
}

/**
 * 统计笔记中的 base64 图片数量（用于决定是否需要优化）
 */
export function countBase64Images(content: string): number {
  return (content.match(BASE64_IMG_REGEX) ?? []).length;
}
