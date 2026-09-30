import { defineConfig } from 'vite';

/**
 * 项目官网构建配置。
 *
 * base 必须是 /dustnote/：GitHub Pages 项目站的资源前缀不是根路径，写死成 '/' 时
 * 站点在 hermitweb.github.io/dustnote/ 下会 404 掉所有 css/js —— 这类错只在真实
 * 部署后暴露，所以在这里连同部署 URL 一起写清楚（.github/workflows/pages.yml）。
 * 将来若绑自定义域名，用 SITE_BASE=/ 覆盖即可，不必改代码。
 */
const base = process.env.SITE_BASE || '/dustnote/';

export default defineConfig({
  base,
  // 资源不带 hash 会让 Pages 缓存刷新变得玄学，保持默认 hash 命名
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { port: 4180 },
});
