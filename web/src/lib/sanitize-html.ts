/**
 * Markdown 渲染结果的 HTML 白名单净化
 *
 * 为什么需要：笔记正文是用户内容（还可能来自 .md/.docx 导入），marked 默认
 * 透传原始 HTML。公开分享页把渲染结果注入 dangerouslySetInnerHTML，等于让
 * 任意访客在 DustNote 自己的源上执行笔记里的脚本。
 *
 * 实现用浏览器自带的 DOMParser：解析出来的文档是惰性的（不执行脚本、不加载
 * 资源），我们在把节点搬进真实文档之前做白名单过滤。不引第三方依赖。
 */

/** 允许保留的标签（marked 默认输出集 + 任务列表复选框） */
const ALLOWED_TAGS = new Set([
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
]);

/** 每个标签允许保留的属性；未列出的标签一律清空属性 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  ol: new Set(['start']),
  th: new Set(['colspan', 'rowspan', 'align']),
  td: new Set(['colspan', 'rowspan', 'align']),
  input: new Set(['type', 'checked', 'disabled']),
  code: new Set(['class']),
  span: new Set(['class']),
  div: new Set(['class']),
  pre: new Set(['class']),
};

/** 只允许这些协议出现在 href/src 里 */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i;
/** 内联图片仅放行常见位图，挡掉 data:image/svg+xml（SVG 里能塞脚本） */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** C0 控制字符 + 空白，用于剥离 `java\0script:` / `java\tscript:` 这类绕过 */
// eslint-disable-next-line no-control-regex
const STRIPPED_IN_URL = /[\x00-\x20]/g;

function isSafeUrl(value: string, allowDataImage: boolean): boolean {
  if (allowDataImage && SAFE_DATA_IMAGE.test(value.trim())) return true;
  return SAFE_URL.test(value.replace(STRIPPED_IN_URL, ''));
}

function scrubElement(el: Element): void {
  const tag = el.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();

  // 倒序遍历：removeAttribute 会改动实时的 attributes 集合
  for (let i = el.attributes.length - 1; i >= 0; i--) {
    const attr = el.attributes[i];
    if (!attr) continue;
    const name = attr.name.toLowerCase();

    if (!allowed.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value, name === 'src')) {
      el.removeAttribute(attr.name);
    }
  }

  // 任务列表的复选框一律只读，避免它成为可交互控件
  if (tag === 'input') {
    if (el.getAttribute('type')?.toLowerCase() !== 'checkbox') {
      el.remove();
      return;
    }
    el.setAttribute('disabled', '');
  }

  // 外链统一断开 opener，防 tabnabbing
  if (tag === 'a' && el.getAttribute('target')) {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * 净化 HTML 片段，返回只含白名单标签/属性的字符串。
 *
 * 不在白名单里的元素会被「解包」（丢标签、保留其文字内容），
 * 但 script/style/iframe 这类元素连内容一起丢弃——它们的文本本身就是代码。
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof DOMParser === 'undefined') {
    // 非浏览器环境（SSR/测试）保守处理：不渲染任何标签
    return dirty.replace(/</g, '&lt;');
  }

  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, 'text/html');
  const body = doc.body;

  // 先整棵丢掉「内容即代码」的元素
  body
    .querySelectorAll('script, style, iframe, object, embed, link, meta, base, form')
    .forEach((el) => {
      el.remove();
    });

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const all: Element[] = [];
  while (walker.nextNode()) all.push(walker.currentNode as Element);

  const unwrap: Element[] = [];
  for (const el of all) {
    if (!el.isConnected) continue;
    if (ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
      scrubElement(el);
    } else {
      unwrap.push(el);
    }
  }

  // 从最深的开始解包，避免父节点先被替换导致子节点脱离文档
  for (const el of unwrap.reverse()) {
    el.replaceWith(...Array.from(el.childNodes));
  }

  return body.innerHTML;
}
