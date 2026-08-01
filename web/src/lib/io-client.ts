/**
 * 客户端导入/导出工具
 * 全部在浏览器端完成解密/打包，不向服务端泄露明文
 */

import type { NotePlaintext } from './store';

/** 把 File 读取为 ArrayBuffer */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    r.readAsArrayBuffer(file);
  });
}

/** 解析 .txt 笔记 */
function parseTxt(name: string, _buf: ArrayBuffer): NotePlaintext {
  const text = new TextDecoder('utf-8').decode(_buf);
  // 找第一行非空内容作为标题；若全文为空则回退到文件名（去掉扩展名）
  const firstLine = text.split('\n').find((l) => l.trim());
  const title = firstLine ? firstLine.slice(0, 80) : name.replace(/\.txt$/i, '');
  return {
    title,
    content: text,
    tags: ['导入'],
  };
}

/** 解析 .md 笔记 */
function parseMd(name: string, _buf: ArrayBuffer): NotePlaintext {
  const text = new TextDecoder('utf-8').decode(_buf);
  // 找第一个 # 标题
  const m = text.match(/^#\s+(.+)$/m);
  const title = m ? m[1]!.trim() : name.replace(/\.md$|\.markdown$/i, '');
  return {
    title: title.slice(0, 80),
    content: text,
    tags: ['导入', 'markdown'],
  };
}

/**
 * 解析 .docx（动态加载 mammoth 库）
 *
 * mammoth 体积较大（~150KB gzip），按需加载避免首屏开销。
 * mammoth.extractRawText 返回纯文本；convertToHtml 返回 HTML。
 * 这里使用 extractRawText 保证导入后可被 Markdown 编辑器处理，
 * 标题取首段非空文本。
 */
async function parseDocx(name: string, buf: ArrayBuffer): Promise<NotePlaintext> {
  let mammoth: typeof import('mammoth');
  try {
    // Vite 会把动态 import 拆成独立 chunk
    mammoth = await import('mammoth');
  } catch (e) {
    throw new Error('加载 .docx 解析器失败：请确认已安装 mammoth（pnpm add mammoth）');
  }
  const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      title: name.replace(/\.docx$/i, ''),
      content: '',
      tags: ['导入', 'docx'],
    };
  }
  // 首段非空作为标题
  const firstPara = trimmed.split(/\n+/).find((l: string) => l.trim()) ?? name;
  return {
    title: firstPara.slice(0, 80) || name.replace(/\.docx$/i, ''),
    content: trimmed,
    tags: ['导入', 'docx'],
  };
}

export type ParseFormat = 'txt' | 'md' | 'docx' | 'unknown';

export function detectFormat(name: string): ParseFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.docx')) return 'docx';
  return 'unknown';
}

/** 解析文件为 NotePlaintext */
export async function parseNoteFile(file: File): Promise<NotePlaintext> {
  const format = detectFormat(file.name);
  const buf = await readFileAsArrayBuffer(file);
  if (format === 'txt') return parseTxt(file.name, buf);
  if (format === 'md') return parseMd(file.name, buf);
  if (format === 'docx') return parseDocx(file.name, buf);
  throw new Error(`不支持的文件格式：${file.name}`);
}

/** 导出为 Markdown */
export function exportAsMarkdown(title: string, content: string): Blob {
  const md = content.startsWith('#') ? content : `# ${title}\n\n${content}`;
  // 添加 UTF-8 BOM，确保 Windows 记事本正确识别编码
  return new Blob(['\uFEFF', md], { type: 'text/markdown;charset=utf-8' });
}

/** 导出为 HTML */
export function exportAsHtml(title: string, content: string): Blob {
  // 极简转换：保留原文，用 <pre> 包装（实际可用 marked 客户端渲染）
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; line-height: 1.7; color: #333; }
  h1 { color: #4FB783; }
  pre, code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: "JetBrains Mono", monospace; }
  blockquote { border-left: 3px solid #A8E6CF; padding-left: 12px; color: #666; }
  hr { border: none; border-top: 1px dashed #ddd; }
</style>
</head>
<body>
${markdownToHtml(content)}
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

/** 极简 Markdown → HTML（同步） */
function markdownToHtml(md: string): string {
  let html = escapeHtml(md);
  // 标题
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // 粗体/斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // 链接：仅允许安全协议，阻止 javascript:/data: 等 XSS 向量
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text: string, url: string) => {
    if (!/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return m;
    return `<a href="${url}">${text}</a>`;
  });
  // 代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 引用
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  // 列表
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // 分隔线
  html = html.replace(/^---+$/gm, '<hr>');
  // 段落
  html = html
    .split(/\n{2,}/)
    .map((p) => {
      if (p.match(/^<(h\d|ul|ol|li|blockquote|hr|pre)/)) return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html;
}

/** 导出为 JSON（单条或全量） */
export function exportAsJson(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
}

/**
 * 打印笔记（通过浏览器原生打印引擎生成 PDF）
 *
 * 替代原先的 jsPDF 方案：jsPDF 默认 Helvetica 字体不含 CJK 字形，
 * 中文会全部乱码。改用浏览器原生打印 → "另存为 PDF"，完美支持中文。
 * 实现方式：隐藏 iframe 加载 HTML → 调用 print() → 用户选"另存为 PDF"。
 */
export async function printNote(title: string, content: string): Promise<void> {
  const htmlBlob = exportAsHtml(title, content);
  const blobUrl = URL.createObjectURL(htmlBlob);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  return new Promise<void>((resolve) => {
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        // 某些浏览器/WebView 可能阻止跨域 iframe 打印
      }
      // 打印对话框关闭后清理 iframe
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(blobUrl);
        resolve();
      }, 1000);
    };
    // 超时保护：10 秒后无论如何都 resolve
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(blobUrl);
      }
      resolve();
    }, 10000);
  });
}

/** 触发下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
