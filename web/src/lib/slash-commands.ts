/**
 * 斜杠命令系统
 *
 * 在编辑器中输入 `/` 时弹出命令菜单，快速插入内容。
 */

export interface SlashCommand {
  id: string;
  label: string;
  labelEn: string;
  icon: string;
  description: string;
  descriptionEn: string;
  /** 插入的内容（支持 {{date}}、{{time}} 占位符） */
  insert: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'date',
    label: '插入日期',
    labelEn: 'Insert date',
    icon: '📅',
    description: '插入当前日期',
    descriptionEn: 'Insert current date',
    insert: '{{date}}',
  },
  {
    id: 'datetime',
    label: '插入日期时间',
    labelEn: 'Insert date & time',
    icon: '🕐',
    description: '插入当前日期和时间',
    descriptionEn: 'Insert current date and time',
    insert: '{{date}} {{time}}',
  },
  {
    id: 'heading',
    label: '标题',
    labelEn: 'Heading',
    icon: '📝',
    description: '插入二级标题',
    descriptionEn: 'Insert heading',
    insert: '## ',
  },
  {
    id: 'list',
    label: '列表',
    labelEn: 'List',
    icon: '📋',
    description: '插入无序列表',
    descriptionEn: 'Insert unordered list',
    insert: '- ',
  },
  {
    id: 'todo',
    label: '待办',
    labelEn: 'Todo',
    icon: '✅',
    description: '插入待办事项',
    descriptionEn: 'Insert todo item',
    insert: '- [ ] ',
  },
  {
    id: 'code',
    label: '代码块',
    labelEn: 'Code block',
    icon: '💻',
    description: '插入代码块',
    descriptionEn: 'Insert code block',
    insert: '```\n\n```',
  },
  {
    id: 'quote',
    label: '引用',
    labelEn: 'Quote',
    icon: '💬',
    description: '插入引用块',
    descriptionEn: 'Insert blockquote',
    insert: '> ',
  },
  {
    id: 'divider',
    label: '分割线',
    labelEn: 'Divider',
    icon: '➖',
    description: '插入水平分割线',
    descriptionEn: 'Insert horizontal rule',
    insert: '\n---\n',
  },
  {
    id: 'table',
    label: '表格',
    labelEn: 'Table',
    icon: '📊',
    description: '插入表格模板',
    descriptionEn: 'Insert table template',
    insert: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| | | |',
  },
  {
    id: 'link',
    label: '双向链接',
    labelEn: 'Wikilink',
    icon: '🔗',
    description: '插入笔记链接 [[标题]]',
    descriptionEn: 'Insert note link [[title]]',
    insert: '[[',
  },
];

/**
 * 处理斜杠命令占位符替换
 */
export function resolveSlashCommand(insert: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]!;
  const time = now.toTimeString().split(' ')[0]!.slice(0, 5);
  return insert.replace(/\{\{date\}\}/g, date).replace(/\{\{time\}\}/g, time);
}

/**
 * 过滤斜杠命令列表
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.labelEn.toLowerCase().includes(q) ||
      cmd.id.includes(q)
  );
}
