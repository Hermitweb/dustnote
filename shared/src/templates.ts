/**
 * 预设模板（客户端 bundled 副本）
 *
 * 与 server/src/migrations.ts id=10 的 seed 数据保持一致，
 * 让单机模式（无服务器）也能使用预设模板。
 *
 * 联机模式下，客户端会从服务端 GET /templates 拉取（含预设 + 用户自定义）；
 * 单机模式下，客户端直接使用此 bundled 列表。
 */

import type { Template } from './types.js';

/** 预设模板固定 ID（与服务端 seed 一致，便于去重） */
export const PRESET_TEMPLATE_IDS = [
  'tpl-blank',
  'tpl-journal',
  'tpl-meeting',
  'tpl-todo',
  'tpl-reading',
  'tpl-project',
] as const;

/**
 * 预设模板列表。
 *
 * 注意：content 是明文 Markdown，与 NotePlaintext.content 格式一致。
 * 客户端创建笔记时直接写入（再用 masterKey 加密成密文信封）。
 */
export const PRESET_TEMPLATES: Template[] = [
  {
    id: 'tpl-blank',
    userId: null,
    name: '空白笔记',
    description: '从零开始',
    category: 'blank',
    icon: '📄',
    content: '',
    isPreset: true,
    sortOrder: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tpl-journal',
    userId: null,
    name: '每日日记',
    description: '记录今天的所思所感',
    category: 'journal',
    icon: '📔',
    content:
      '# {{date}} 日记\n\n## 今日心情\n\n\n## 三件感恩的事\n1. \n2. \n3. \n\n## 自由书写\n\n',
    isPreset: true,
    sortOrder: 2,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tpl-meeting',
    userId: null,
    name: '会议记录',
    description: '结构化的会议纪要',
    category: 'meeting',
    icon: '🗓️',
    content:
      '# 会议主题\n\n- **时间**：\n- **地点**：\n- **参会**：\n\n## 议题\n\n1. \n2. \n\n## 决议\n\n- \n\n## 待办（Owner / 截止）\n\n- [ ]  /  \n',
    isPreset: true,
    sortOrder: 3,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tpl-todo',
    userId: null,
    name: '待办清单',
    description: '可勾选的任务列表',
    category: 'todo',
    icon: '✅',
    content:
      '# 待办清单\n\n## 今天\n- [ ] \n- [ ] \n\n## 本周\n- [ ] \n- [ ] \n\n## 已完成\n- [x] \n',
    isPreset: true,
    sortOrder: 4,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tpl-reading',
    userId: null,
    name: '阅读笔记',
    description: '读书摘要与思考',
    category: 'reading',
    icon: '📚',
    content:
      '# 《书名》\n\n- **作者**：\n- **进度**：\n- **评分**：⭐⭐⭐⭐⭐\n\n## 摘要\n\n\n## 关键观点\n1. \n2. \n\n## 我的思考\n\n',
    isPreset: true,
    sortOrder: 5,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'tpl-project',
    userId: null,
    name: '项目计划',
    description: '项目目标与里程碑',
    category: 'project',
    icon: '🚀',
    content:
      '# 项目名称\n\n## 背景与目标\n\n\n## 范围\n- **包含**：\n- **不包含**：\n\n## 里程碑\n| 里程碑 | 截止日期 | 状态 |\n| ------ | -------- | ---- |\n|        |          |      |\n\n## 风险\n- \n',
    isPreset: true,
    sortOrder: 6,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
];

/**
 * 替换模板内容中的占位符（如 {{date}}）。
 *
 * @param content 模板原文
 * @returns 替换后的内容（客户端创建笔记时写入）
 */
export function fillTemplatePlaceholders(content: string): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  return content.replace(/\{\{date\}\}/g, dateStr);
}
