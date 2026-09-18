/**
 * 移动端斜杠命令
 */

export interface SlashCommand {
  id: string;
  label: string;
  icon: string;
  insert: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'date', label: '插入日期', icon: 'calendar', insert: '{{date}}' },
  { id: 'datetime', label: '日期时间', icon: 'clock-plus', insert: '{{date}} {{time}}' },
  { id: 'heading', label: '标题', icon: 'file-text', insert: '## ' },
  { id: 'list', label: '列表', icon: 'layers', insert: '- ' },
  { id: 'todo', label: '待办', icon: 'check-square', insert: '- [ ] ' },
  { id: 'code', label: '代码块', icon: 'code', insert: '```\n\n```' },
  { id: 'quote', label: '引用', icon: 'quote', insert: '> ' },
  { id: 'divider', label: '分割线', icon: 'minus', insert: '\n---\n' },
  {
    id: 'table',
    label: '表格',
    icon: 'table',
    insert: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| | | |',
  },
  { id: 'link', label: '双向链接', icon: 'link', insert: '[[' },
];

export function resolveSlashCommand(insert: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]!;
  const time = now.toTimeString().split(' ')[0]!.slice(0, 5);
  return insert.replace(/\{\{date\}\}/g, date).replace(/\{\{time\}\}/g, time);
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(q) || cmd.id.includes(q));
}
