/**
 * Markdown 渲染结果的 HTML 白名单净化
 *
 * 使用 DOMPurify 替代自实现，配置白名单与原实现一致。
 * 公开分享页把渲染结果注入 dangerouslySetInnerHTML，必须净化防 XSS。
 */

import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a',
  'p',
  'br',
  'hr',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'i',
  'b',
  'del',
  's',
  'sup',
  'sub',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'img',
  'input',
];

const ALLOWED_ATTR = [
  'href',
  'title',
  'target',
  'rel',
  'src',
  'alt',
  'width',
  'height',
  'start',
  'colspan',
  'rowspan',
  'align',
  'type',
  'checked',
  'disabled',
  'class',
];

const config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpeg|gif|webp|svg\+xml)|\/|#)/i,
};

// 外链统一断开 opener（防 tabnabbing）；任务列表复选框强制只读
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type')?.toLowerCase() !== 'checkbox') {
      node.parentNode?.removeChild(node);
      return;
    }
    node.setAttribute('disabled', '');
  }
});

export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    return html.replace(/</g, '&lt;');
  }
  return DOMPurify.sanitize(html, config) as string;
}
