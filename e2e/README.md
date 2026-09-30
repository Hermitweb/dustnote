# e2e · 端到端与视觉回归

Playwright 用例，配置在仓库根的 `playwright.config.ts`（chromium 单浏览器、
workers=1、自动起后端与 Web，用独立临时库避免污染开发库）。

## 跑

```bash
pnpm exec playwright test                     # 会自己拉起 server + web
pnpm exec playwright test e2e/visual-baseline # 只跑视觉基线
pnpm exec playwright test --headed            # 肉眼看
```

本地想用已在跑的 dev 服务：`playwright.local.config.ts`。

## 用例分工

| 文件                      | 覆盖                                              |
| ------------------------- | ------------------------------------------------- |
| `core-flow.spec.ts`       | 单机模式主流程：设置主密码 → 建笔记 → 检索 → 导出 |
| `online-flow.spec.ts`     | 联机流程：真实 API、同步、分享                    |
| `folders-unfiled.spec.ts` | 文件夹 / 未分类的移动与计数                       |
| `a11y-contrast.ts`        | **对比度门禁**：正文与主色在亮暗两档都要过阈值    |
| `visual-baseline.spec.ts` | 视觉基线截图比对                                  |
| `helpers.ts`              | 公共夹具                                          |

## 改这里的规矩

- **不要顺手 `--update-snapshots`**。基线变了要么是有意的（PR 里说清并附前后图），
  要么是 bug。让基线静默跟着改，等于把视觉回归关掉。
- 新增用例优先覆盖「构建与单测看不见」的那类：布局在窄屏重叠、材质被盖住、
  对比度不达标。这三类都真出过事故，而 lint / typecheck / 单测全绿。
- 用例里不写 emoji 图标断言（与产品同一口径，见 `../docs/ui-icon-map.md`）。
