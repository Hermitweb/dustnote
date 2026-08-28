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
  { id: 'date', label: '插入日期', icon: '📅', insert: '{{date}}' },
  { id: 'datetime', label: '日期时间', icon: '🕐', insert: '{{date}} {{time}}' },
  { id: 'heading', label: '标题', icon: '📝', insert: '## ' },
  { id: 'list', label: '列表', icon: '📋', insert: '- ' },
  { id: 'todo', label: '待办', icon: '✅', insert: '- [ ] ' },
  { id: 'code', label: '代码块', icon: '💻', insert: '```\n\n```' },
  { id: 'quote', label: '引用', icon: '💬', insert: '> ' },
  { id: 'divider', label: '分割线', icon: '➖', insert: '\n---\n' },
  { id: 'table', label: '表格', icon: '📊', insert: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| | | |' },
  { id: 'link', label: '双向链接', icon: '🔗', insert: '[[' },
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
  return SLASH_COMMANDS.filter(
    (cmd) => cmd.label.toLowerCase().includes(q) || cmd.id.includes(q)
  );
}
