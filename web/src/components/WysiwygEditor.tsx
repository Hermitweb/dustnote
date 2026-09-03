/**
 * WYSIWYG 编辑器组件（TipTap）
 *
 * 作为 Markdown textarea 的替代编辑模式，提供富文本编辑体验。
 * 与现有 Markdown 内容双向转换。
 */

import { useEditor, EditorContent } from '@tiptap/react';
import TurndownService from 'turndown';
import { marked } from 'marked';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface WysiwygEditorProps {
  content: string; // Markdown 内容
  onChange: (markdown: string) => void;
  placeholder?: string;
}

/**
 * Markdown → HTML:marked 与预览渲染同一引擎(与只读视图所见一致);
 * XSS 由调用点 DOMPurify 兜底。
 */
function markdownToHtml(md: string): string {
  // wikilink 扩展不在本模块注册(marked 全局单例),先转成普通链接语法
  return marked.parse(md.replace(/\[\[([^\]]+)\]\]/g, '[$1](wikilink://$1)'), { async: false }) as string;
}

/**
 * HTML → Markdown:turndown(真 DOM 解析,消除正则互转的有损往返——
 * 此前表格/嵌套列表/h4-6 会被拍平,一次 WYSIWYG 编辑即破坏笔记结构)
 */
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndownService.keep(['del']);

function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

export function WysiwygEditor({ content, onChange, placeholder }: WysiwygEditorProps) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-surface-bg p-4 font-mono text-sm' } },
      }),
      Placeholder.configure({
        placeholder: placeholder || t('editor.wysiwyg_placeholder'),
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
