/**
 * Logo 组件 — 带 emoji 回退的 DustNote 图标
 *
 * 桌面端构建时 logo.png 从 web/public 拷贝到 dist/（见 desktop/vite.config.ts 的 publicDir）。
 * 万一图片加载失败（路径问题、打包遗漏等），回退到 🌿 emoji 而非显示裂图。
 */

import { useState } from 'react';

interface LogoProps {
  className?: string;
  alt?: string;
}

export function Logo({ className = 'h-8 w-8', alt = 'DustNote' }: LogoProps) {
  const [error, setError] = useState(false);

  if (error) {
    return <span className={`${className} flex items-center justify-center`}>🌿</span>;
  }

  return <img src="/logo.png" alt={alt} className={className} onError={() => setError(true)} />;
}
