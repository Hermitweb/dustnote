/**
 * 首次使用初始化（与 web/mobile 端 ensureDefaultContent 语义一致，幂等）：
 * 无任何文件夹时创建默认文件夹「关于尘渊笔记」+ 引导笔记，并迁移未分类笔记。
 */

import { encryptNote } from '@dustnote/client-core';
import Taro from '@tarojs/taro';
import { useAuthStore } from '../state/auth';
import { useModeStore } from './mode-store';
import { getRepo } from './get-repo';

export const DEFAULT_FOLDER_NAME = '关于尘渊笔记';
/** 种子标记（按模式区分）：创建过一次初始内容后不再重生——
 *  否则用户删光文件夹后会被误判为「首次使用」再次注入引导内容 */
const SEED_KEY_PREFIX = 'dustnote_seeded_';
const INTRO_CONTENT = `## 欢迎使用尘渊笔记

尘渊笔记是一款**极简、安全**的跨端个人笔记系统。

- **端到端加密**：笔记在本地加密后才同步，服务器也看不到内容
- **多端同步**：Web / Windows / 安卓 / 小程序全端覆盖
- **离线可用**：断网也能正常记录，联网后自动同步

### 快速上手

1. 在首页选择或新建**文件夹**，笔记必须归属某个文件夹
2. 点击右下角 + 新建笔记，支持 Markdown 语法
3. 输入 / 呼出快捷命令菜单（日期 / 列表 / 待办等）

*本文件夹为初始引导内容，可以随意修改或删除。*`;

/**
 * 并发单飞：首页 useEffect 与 useDidShow 会同时触发 load(),并发的
 * ensureDefaultContent 都读到「0 文件夹」会各建一份初始内容。
 * 内部自行 loadAll 取最新快照,串行重入由 folders 检查挡住。
 */
let inFlight: Promise<void> | null = null;

export async function ensureDefaultContent(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runEnsure().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnsure(): Promise<void> {
  const masterKey = useAuthStore.getState().masterKey;
  if (!masterKey) return;
  const mode = useModeStore.getState().mode;
  const seedKey = SEED_KEY_PREFIX + (mode ?? 'x');
  // 已播种过（即使文件夹被用户删光）不再重生
  try {
    if (Taro.getStorageSync(seedKey)) return;
  } catch {
    /* ignore */
  }
  const repo = getRepo();
  const snapshot = await repo.loadAll();
  if ((snapshot.folders ?? []).length > 0) {
    try {
      Taro.setStorageSync(seedKey, true);
    } catch {
      /* ignore */
    }
    return;
  }

  const folderId = await repo.createFolder({ name: DEFAULT_FOLDER_NAME, parentId: null });
  for (const n of snapshot.notes) {
    if (!n.deletedAt && !n.folderId) {
      try {
        await repo.moveNote(n.id, folderId);
      } catch {
        /* 单条失败不阻塞初始化 */
      }
    }
  }
  const { json: cipherJson } = await encryptNote(masterKey, {
    title: DEFAULT_FOLDER_NAME,
    content: INTRO_CONTENT,
    tags: [],
  });
  await repo.createNote({
    ciphertext: cipherJson,
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    folderId,
  });
  try {
    Taro.setStorageSync(seedKey, true);
  } catch {
    /* ignore */
  }
}
