/**
 * 剪贴板工具
 *
 * navigator.clipboard 仅在安全上下文（HTTPS / localhost）可用，
 * 用户经 http://<公网IP> 访问时 navigator.clipboard 为 undefined，
 * 直接调用会抛 TypeError。此处降级到 document.execCommand('copy')。
 */

/** 复制文本到剪贴板，返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  // 优先 Clipboard API（安全上下文）
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走降级方案
    }
  }

  // 降级：隐藏 textarea + execCommand('copy')（非安全上下文可用）
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 是否支持读剪贴板（仅安全上下文） */
export function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
}
