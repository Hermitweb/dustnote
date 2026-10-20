/**
 * web/src/components/WysiwygEditor.tsx 单测
 *
 * TipTap 在 jsdom 下行为不稳，这里 mock 掉 @tiptap/react（useEditor/EditorContent）
 * + turndown + marked，聚焦验证组件的 Markdown↔HTML 转换布线 + 外部内容同步 effect。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// turndown mock：turndownService.turndown(html) 做标记性转换
const hoisted = vi.hoisted(() => {
  const turndownMock = (html: string) => `MD:${html}`;
  const turndownInstance = {
    keep: () => {},
    turndown: (html: string) => turndownMock(html),
  };
  return { turndownInstance };
});
vi.mock('turndown', () => ({
  __esModule: true,
  default: function TurndownService() {
    return hoisted.turndownInstance;
  },
}));

// marked mock：parse(md) → 标记性 html
vi.mock('marked', () => ({
  marked: { parse: (md: string, _opts?: unknown) => `HTML:${md}` },
}));

// @tiptap/react mock
let editorOptions: any;
const editorCommands = { setContent: vi.fn() };
const editorContent = {
  getHTML: () => '<p>current</p>',
  commands: editorCommands,
};
vi.mock('@tiptap/react', () => ({
  useEditor: (opts: any) => {
    editorOptions = opts;
    return editorContent; // 已就绪的 editor（非 null，走 effect）
  },
  EditorContent: ({ editor }: { editor: unknown }) => (
    <div data-testid="editor-content" data-has-editor={editor ? '1' : '0'} />
  ),
}));

// sanitize-html：组件内 import 的真实纯函数可保留（DOMPurify jsdom 支持），不 mock
// i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => `__${k}__`,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
}));

import { WysiwygEditor } from './WysiwygEditor';
import { render } from '../test/render';

describe('WysiwygEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.turndownInstance.keep = () => {};
    hoisted.turndownInstance.turndown = (html: string) => `MD:${html}`;
    editorContent.getHTML = () => '<p>current</p>';
    editorContent.commands.setContent = vi.fn();
  });

  it('渲染 EditorContent 且把 Markdown 经转换喂给 TipTap content', () => {
    const { getByTestId } = render(<WysiwygEditor content="[[目标]]" onChange={() => {}} />);
    // useEditor 收到 content = markdownToHtml('[[目标]]')：先 wikilink 替换再 marked.parse
    // mock marked.parse 原样返回 → 'HTML:[](wikilink://目标)'
    expect(editorOptions).toBeTruthy();
    expect(editorOptions.content).toContain('wikilink://');
    expect(getByTestId('editor-content').getAttribute('data-has-editor')).toBe('1');
  });

  it('onUpdate → onChange(转换后 markdown)', () => {
    render(<WysiwygEditor content="x" onChange={() => {}} />);
    const onChange = vi.fn();
    // 重新渲染传 onChange
    const { unmount } = render(<WysiwygEditor content="x" onChange={onChange} />);
    // 手动模拟 onUpdate 回调（component 内 onUpdate: ({editor}) => onChange(htmlToMarkdown(getHTML()))）
    const finalOpts = editorOptions;
    finalOpts.onUpdate({ editor: editorContent });
    expect(onChange).toHaveBeenCalledWith('MD:<p>current</p>');
    unmount();
  });

  it('外部 content 变化且与当前不一致 → setContent(markdownToHtml(content))', () => {
    editorContent.getHTML = () => '<p>old</p>'; // htmlToMarkdown = 'MD:<p>old</p>'
    const { unmount, rerender } = render(<WysiwygEditor content="a" onChange={() => {}} />);
    // 初次 render：content='a'，getHTML='<p>old</p>' → current='MD:<p>old</p>' ≠ 'a' → setContent 已调
    expect(editorContent.commands.setContent).toHaveBeenCalled();
    rerender(<WysiwygEditor content="b" onChange={() => {}} />);
    unmount();
  });
});
