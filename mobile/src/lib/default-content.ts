/**
 * 首次使用初始化（与 web 端 data-slice.ensureDefaultContent 语义一致，幂等）：
 * 1. 无任何文件夹时创建默认文件夹「关于尘心笔记」+ 引导笔记
 * 2. 历史未分类笔记（folderId=null 且未删除）迁入默认文件夹
 *    ——「未分类」已从产品移除，笔记必须归属文件夹
 */

import type { DataRepository } from '@dustnote/shared';
import { packEnvelope } from './envelope';

export const DEFAULT_FOLDER_NAME = '关于尘心笔记';
const INTRO_CONTENT = `## 欢迎使用尘心笔记

尘心笔记是一款**极简、安全**的跨端个人笔记系统。

- **端到端加密**：笔记在本地加密后才同步，服务器也看不到内容
- **多端同步**：Web / Windows / 安卓 / 小程序全端覆盖
- **双向链接**：[[关于尘心笔记]] 语法引用其他笔记
- **离线可用**：断网也能正常记录，联网后自动同步

### 快速上手

1. 在顶部选择或新建**文件夹**，笔记必须归属某个文件夹
2. 点击右下角 + 新建笔记，支持 Markdown 语法
3. 输入 / 呼出快捷命令菜单（日期 / 列表 / 待办等）

### 隐私与安全

- 主密码是唯一凭据，请务必妥善保管（无法找回）
- 恢复码请抄写在纸上或复制保存（本页支持一键复制）

*本文件夹为初始引导内容，可以随意修改或删除。*`;

/**
 * @param snapshot 调用方刚完成的 loadAll 快照（避免二次全量加载）
 */
/**
 * 并发单飞：列表页 useEffect 与 useFocusEffect 会同时触发 load(),
 * 两个 ensureDefaultContent 并发时都读到「0 文件夹」并各建一份——
 * 真机实锤的「初始文件夹/笔记创建两份」根因。并发调用共享同一 Promise;
 * 串行重入由 folders>0 检查挡住(调用方每次传入的都是新快照)。
 */
let inFlight: Promise<void> | null = null;

export async function ensureDefaultContent(
  repo: DataRepository,
  masterKey: Uint8Array | null,
  snapshot: { folders?: Array<{ id: string }>; notes?: Array<{ id: string; folderId: string | null; deletedAt: string | null }> }
): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runEnsure(repo, masterKey, snapshot).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnsure(
  repo: DataRepository,
  masterKey: Uint8Array | null,
  snapshot: { folders?: Array<{ id: string }>; notes?: Array<{ id: string; folderId: string | null; deletedAt: string | null }> }
): Promise<void> {
  if (!masterKey) return;
  if ((snapshot.folders ?? []).length > 0) return;

  const folderId = await repo.createFolder({ name: DEFAULT_FOLDER_NAME, parentId: null });
  // 迁移历史未分类笔记（先迁移再建引导笔记）
  for (const n of snapshot.notes ?? []) {
    if (!n.deletedAt && !n.folderId) {
      try {
        await repo.moveNote(n.id, folderId);
      } catch {
        /* 单条失败不阻塞初始化 */
      }
    }
  }
  const ciphertext = await packEnvelope(masterKey, {
    title: DEFAULT_FOLDER_NAME,
    content: INTRO_CONTENT,
    tags: [],
  });
  await repo.createNote({
    ciphertext,
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    folderId,
  });
}
