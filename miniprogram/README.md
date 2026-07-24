# DustNote 小程序 (Taro 3)

> 基于 Taro 3.6 + React 18 的 DustNote 小程序端

## 支持平台

| 平台       | 命令                                    |
| ---------- | --------------------------------------- |
| 微信小程序 | `pnpm dev:weapp` / `pnpm build:weapp`   |
| 支付宝     | `pnpm dev:alipay` / `pnpm build:alipay` |
| 抖音       | `pnpm dev:tt` / `pnpm build:tt`         |
| 百度       | `pnpm dev:swan` / `pnpm build:swan`     |
| QQ         | `pnpm dev:qq` / `pnpm build:qq`         |
| 京东       | `pnpm dev:jd` / `pnpm build:jd`         |
| H5         | `pnpm dev:h5` / `pnpm build:h5`         |

## 开发

```bash
# 安装依赖
pnpm install

# 启动微信小程序开发模式（产物输出到 dist/，用微信开发者工具打开）
pnpm dev:weapp
```

## 平台特性

| 特性      | 实现                                                  |
| --------- | ----------------------------------------------------- |
| E2EE 加密 | 复用 `@dustnote/shared`（受限：crypto.subtle 不完整） |
| 状态管理  | zustand                                               |
| 网络请求  | Taro.request                                          |
| 本地存储  | Taro.storage                                          |

## 已知限制

- **小程序端加密强度有限**：JS 环境没有完整的 WebCrypto API
- **真正的 E2EE 方案**：见 [security.md §5.7](../../.trae/documents/security.md)，需要后端代理 + 同声传译
- **iOS 端后台限制**：进入后台后 WS 可能断开，回到前台需手动刷新

## 提交审核

构建 `pnpm build:weapp` 后，将 `dist/` 目录内容作为小程序代码包提交微信开发者工具。

### 提审材料

- 服务类目：工具 → 效率
- 隐私协议：引用 [privacy-policy.md](../../docs/privacy-policy.md)
- 备案：域名 ICP 备案 + 公安备案
- 内容安全：所有内容用户自创建，无需预审

## 目录结构

```
miniprogram/
├── config/                      # Taro 配置
│   └── index.ts
├── src/
│   ├── app.tsx                  # 小程序入口
│   ├── app.scss                 # 全局样式
│   ├── pages.json               # 路由注册
│   ├── state/
│   │   └── auth.ts              # 鉴权状态
│   └── pages/
│       ├── index/index.tsx      # 笔记列表
│       ├── setup/index.tsx      # 创建主密码
│       ├── unlock/index.tsx     # 解锁
│       ├── note/edit.tsx        # 笔记编辑
│       ├── settings/index.tsx   # 设置
│       └── share/index.tsx      # 公开分享查看
└── package.json
```
