/**
 * WYSIWYG 编辑器组件（TipTap）
 *
 * 作为 Markdown textarea 的替代编辑模式，提供富文本编辑体验。
 * 与现有 Markdown 内容双向转换。
 */

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect } from 'react';

interface WysiwygEditorProps {
  content: string; // Markdown 内容
  onChange: (markdown: string) => void;
  placeholder?: string;
}

/**
 * 简单的 Markdown → HTML 转换（用于 TipTap 初始内容）
 * 不追求完美，覆盖常见语法
 */
function markdownToHtml(md: string): string {
  let html = md;
  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // 粗体/斜体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // 待办列表
  html = html.replace(/^- \[x\] (.+)$/gm, '<li data-checked="true">$1</li>');
  html = html.replace(/^- \[ \] (.+)$/gm, '<li data-checked="false">$1</li>');
  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // 引用
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // 分割线
  html = html.replace(/^---$/gm, '<hr />');
  // 段落（连续非空行）
  html = html.replace(/^(?!<[hluob]|<li|<hr|<pre|<blockquote)(.+)$/gm, '<p>$1</p>');
  // 换行
  html = html.replace(/\n\n/g, '');
  return html;
}

/**
 * TipTap 编辑器生成的 HTML → Markdown 转换
 */
function htmlToMarkdown(html: string): string {
  let md = html;
  // 标题
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
  // 粗体/斜体
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  // 链接
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  // 图片
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  // 代码块
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n');
  // 行内代码
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  // 待办列表
  md = md.replace(/<li[^>]*data-checked="true"[^>]*>(.*?)<\/li>/gi, '- [x] $1\n');
  md = md.replace(/<li[^>]*data-checked="false"[^>]*>(.*?)<\/li>/gi, '- [ ] $1\n');
  // 列表项
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  // 引用
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n');
  // 分割线
  md = md.replace(/<hr[^>]*\/?>/gi, '---\n');
  // 段落
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n');
  // 清理 HTML 标签
  md = md.replace(/<[^>]+>/g, '');
  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

export function WysiwygEditor({ content, onChange, placeholder }: WysiwygEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-surface-bg p-4 font-mono text-sm' } },
      }),
      Placeholder.configure({
        placeholder: placeholder || '开始编辑...',
      }),
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-mint-600 dark:text-mint-400 underline cursor-pointer' },
      }),
      Image.configure({
        HTMLAttributes: { class: 'max-w-full rounded-lg' },
      }),
    ],
    content: markdownToHtml(content),
    onUpdate: ({ editor: ed }) => {
      onChange(htmlToMarkdown(ed.getHTML()));
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none text-surface-fg dark:prose-invert focus:outline-none min-h-[200px] p-6',
      },
    },
  });

  // 外部内容变化时同步到编辑器（如切换笔记）
  useEffect(() => {
    if (!editor) return;
    const current = htmlToMarkdown(editor.getHTML());
    if (current !== content) {
      editor.commands.setContent(markdownToHtml(content));
    }
  }, [content, editor]);

  return (
    <div className="flex-1 overflow-y-auto">
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
