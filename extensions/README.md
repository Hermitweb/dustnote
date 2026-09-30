# extensions · 浏览器扩展

目前只有一个 **web-clipper**（网页剪藏）：在浏览器里选中内容，一键存成笔记。

## 文件

| 文件                        | 职责                            |
| --------------------------- | ------------------------------- |
| `web-clipper/manifest.json` | MV3 清单                        |
| `web-clipper/popup.html`    | 弹窗界面                        |
| `web-clipper/popup.js`      | 抓取 → 转 Markdown → 调主栈 API |

## 三条边界

1. **权限按需申请**。`host_permissions` 曾经是 `<all_urls>`，
   已收紧为「服务器 origin + 当前标签页」。加回通配要先想清楚威胁模型。
2. **明文不出本机以外**：扩展把正文发给服务器前，走与 Web 端相同的信封加密；
   服务器只见密文这条底线不因扩展而破。
3. **只走 https**。扩展里出现 `http://` 的目标会被拒（审计 PLAT-005 的收口）。

## 装（开发者）

```bash
# chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extensions/web-clipper
```

它不在 `pnpm verify` 的构建链里（无构建步骤，纯静态三件套），
所以改动要手工加载验证。
