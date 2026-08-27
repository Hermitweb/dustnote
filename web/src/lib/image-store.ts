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

/** 存储图片 blob */
export async function storeImage(blob: string): Promise<string> {
  const id = generateImageId();
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(blob, id);
    tx.oncomplete = () => { db.close(); resolve(id); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 读取图片 blob */
export async function getImage(id: string): Promise<string | null> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readonly');
    const req = tx.objectStore(IMAGE_STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** 删除图片 */
export async function deleteImage(id: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
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
      const base64 = await getImage(id);
      if (base64) {
        result = result.replace(fullMatch, `![${alt}](data:image/png;base64,${base64})`);
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
