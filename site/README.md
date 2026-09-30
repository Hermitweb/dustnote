# site · 项目官网

**一句话**：发布到 GitHub Pages 的单页官网。复用产品的设计令牌与主题种子，
正文是**全静态 HTML**（关掉 JavaScript 也能读全部内容）。

线上地址：<https://hermitweb.github.io/dustnote/>

## 结构

| 文件                  | 职责                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `index.html`          | 页面本体。所有文案与结构都在这儿，不是运行时拼出来的                |
| `src/content.ts`      | **页面规格**：特性、平台表、安全结论、工程承诺、文档卡片、外链      |
| `src/content.test.ts` | 24 条守卫：断言页面没有悄悄说谎                                     |
| `src/html-balance.ts` | 标签配对检查（构建与 lint 都不校验 HTML 结构）                      |
| `src/styles.css`      | 只 @import 设计令牌 + 写本站种子，不另立色值                        |
| `src/main.ts`         | 仅增强：版本回填、移动菜单、复制、scroll-spy                        |
| `vite.config.ts`      | `base` 默认 `/dustnote/`（Pages 项目页前缀），可用 `SITE_BASE` 覆盖 |

## 跑

```bash
pnpm dev:site       # 本地预览（注意 base 前缀）
pnpm build:site     # 产物 site/dist/，CI 断言资源带 /dustnote/ 前缀
pnpm preview:site
pnpm --filter @dustnote/site test
```

## 部署

CI 的 `site` job 构建并上传 Pages 产物，`deploy-site` 部署——两者
**只在 `refs/heads/main` 上跑**。Pages 源是 workflow，所以改完要合进 main
才看得到线上效果。

## 这个页面为什么带 24 条测试

官网写歪比没有官网更糟。测试不测渲染，测的是「页面有没有悄悄说谎」：

- 版本三处一致（根包 / 站点包 / 页面显示）；
- 平台表与 README 逐行对齐；
- 安全结论与工程承诺逐条在页（不许只写「我们有 CI」）；
- 文档卡片指向的仓库文件真实存在、站内锚点都有落点；
- **零第三方请求**：任何绝对 URL 的主机都必须在自有名单内（外链字体与徽章是最常见后门）；
- 配色与 `shared/src/theme-seeds.ts` 逐条同源，品牌中文名由 `web/src/lib/i18n.ts` 拼出；
- HTML 标签配对、中文句子中间不夹空格（HTML 换行会渲染成一个空格）。

## 改这里的规矩

- 改文案就改 `index.html`；改**事实性声明**必须同时改 `content.ts`，二者由测试绑定。
- 加一条工程承诺 = 加一条断言。想写却没有门禁支撑的事，别写。
- 中文句子必须待在同一行，或放进 `<!-- prettier-ignore -->`：prettier 按宽度折行，
  折在两个中文字之间就会在页面上凭空多出一格。
- 图标一律内联 SVG，不用 emoji（与产品同一口径）。
