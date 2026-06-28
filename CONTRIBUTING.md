# 贡献指南

感谢你考虑为 DustNote 做出贡献！本文档帮助你快速上手。

## 行为准则

本项目遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。参与即表示同意。

## 提 Issue

- **Bug 报告**：使用 [Bug 模板](./.github/ISSUE_TEMPLATE/bug.md)
- **功能建议**：使用 [Feature 模板](./.github/ISSUE_TEMPLATE/feature.md)
- **安全问题**：**不要**在公开 Issue 提及，详见 [SECURITY.md](./SECURITY.md)

## 提 PR

1. Fork 仓库
2. 从 `dev` 创建特性分支：`git checkout -b feature/your-feature`
3. 提交规范遵循 [Conventional Commits](https://www.conventionalcommits.org/)
   - `feat: 新增导出 PDF 功能`
   - `fix: 修复主题切换闪烁问题`
   - `docs: 更新 README`
   - `refactor: 重构主题引擎`
4. 确保本地通过：
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
5. 推送并创建 PR，**目标分支为 `dev`**

## 开发环境

```bash
# 要求
- Node.js 20 LTS
- pnpm 9.x
- Rust 1.75+ （仅桌面端）
- Android Studio（仅移动端）
- 微信开发者工具（仅小程序）

# 初始化
pnpm install
pnpm dev          # 启动后端 + Web
```

## 项目结构

```
dustnote/
├── server/        # Node.js 后端
├── web/           # Web 端
├── desktop/       # Tauri 桌面端
├── mobile/        # React Native
├── miniprogram/   # Taro 小程序
└── shared/        # 跨端共享
```

## 公共类型变更

修改 `shared/` 中的类型时，**必须**确认所有端（server / web / desktop / mobile / miniprogram）的 build 都通过。

## 安全敏感代码

涉及认证、加密、密钥管理的代码需 **2 人 review** 才能合并。详见 [security.md §12](./.trae/documents/security.md)。

## 文档

- 修改功能时同步更新 `.trae/documents/` 相关章节
- 新增主题需附预览截图
- 用户可见变更写入 [CHANGELOG.md](./CHANGELOG.md)
