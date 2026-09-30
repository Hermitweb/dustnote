# web · Web 端（也是桌面端的界面层）

**一句话**：React 18 + Vite + Tailwind + Zustand。桌面端（`desktop/`）
直接复用这里的 `dist/`，所以这里的改动会同时进两个发行渠道。

## 结构

| 目录                          | 职责                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/screens/`                | 六个整屏：Setup / Unlock / StandaloneSetup / StandaloneUnlock / StandaloneRecover / PublicShareView |
| `src/components/`             | 38 个组件（导航轨、舞台三态、编辑器、设置、部署管理…）                                              |
| `src/lib/`                    | 非组件逻辑：仓库、加密调用、i18n、诊断、自动备份、错误上报                                          |
| `src/lib/slices/`             | Zustand 状态切片                                                                                    |
| `public/sw.js`                | Service Worker：离线壳与更新；版本由 `pnpm sw:check` 钉住必须跟发布走                               |
| `public/manifest.webmanifest` | PWA 安装元数据                                                                                      |

## 跑

```bash
pnpm dev:web            # http://localhost:5173（后端另起 pnpm dev:server）
pnpm --filter @dustnote/web test
pnpm build:web          # 产物 web/dist/，桌面端与 Docker 镜像都取这份
```

## 界面规矩（改 UI 前必读）

- **文案里不许出现 emoji 形式的图标**。图标走 `../docs/ui-icon-map.md` 的 SVG 体系，
  `pnpm i18n:check` 把内嵌 emoji 上限设为 0。
- 材质三条硬约束（来历见 `../CONTRIBUTING.md`）：文字不得直接压在极光上；
  含文字容器必须落 `glass-1` / `glass-2` 或实色；底色挂 `html` 而不是 `body`。
- 布局是**导航轨 + 舞台三态**（概览 / 列表 / 详情），左侧保持树状结构。
  方案与效果图在 `../docs/ui-optimization.md`，不要绕过它另起一套。
- 视觉改动必须**看渲染结果**。构建、lint、类型检查、单测全都对「390px 上文字重叠」
  和「极光被盖掉」无感。

## 测试

- 单测：`vitest`（`src/**/*.test.ts`）。
- e2e：仓库根的 `e2e/`，`pnpm exec playwright test`；含视觉基线，
  改样式前先想清楚基线该不该更新，不要顺手 `--update-snapshots`。
