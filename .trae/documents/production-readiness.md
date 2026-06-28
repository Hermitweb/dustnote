# DustNote 生产投产就绪状态（Production Readiness）

> 文档版本：v1.0.0
> 适用产品：DustNote · 尘心笔记
> 状态：**P0 全部完成，等待 P1 与 GA**

---

## 0. 投产决策矩阵

| 等级 | 含义 | 投产前必须 |
|------|------|-----------|
| P0 | 阻塞上线 | ✅ 全部完成 |
| P1 | 影响留存与口碑 | 一个月内 |
| P2 | 长期演进 | v1.1+ |

---

## 1. P0 完成清单

### 1.1 仓库门面 ✅

- [x] [LICENSE](../../LICENSE) — MIT
- [x] [README.md](../../README.md) — 快速开始 + 文档导航
- [x] [CONTRIBUTING.md](../../CONTRIBUTING.md) — 贡献指南
- [x] [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — 行为准则
- [x] [SECURITY.md](../../SECURITY.md) — 安全披露流程
- [x] [CHANGELOG.md](../../CHANGELOG.md) — 变更日志

### 1.2 工程基础设施 ✅

- [x] [package.json](../../package.json) — monorepo 根
- [x] [pnpm-workspace.yaml](../../pnpm-workspace.yaml) — 工作区配置
- [x] [.gitignore](../../.gitignore) — 忽略规则
- [x] [.editorconfig](../../.editorconfig) — 编辑器规范
- [x] [.prettierrc.json](../../.prettierrc.json) — 格式化
- [x] [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — CI（lint/typecheck/test/audit/build/docker）
- [x] [.github/workflows/release.yml](../../.github/workflows/release.yml) — 发版（SBOM + 二进制）
- [x] [.github/dependabot.yml](../../.github/dependabot.yml) — 依赖自动更新

### 1.3 法务文档 ✅

- [x] [docs/privacy-policy.md](../../docs/privacy-policy.md)
- [x] [docs/terms-of-service.md](../../docs/terms-of-service.md)
- [x] [docs/cookie-policy.md](../../docs/cookie-policy.md)

### 1.4 用户文档 ✅

- [x] [docs/user-guide.md](../../docs/user-guide.md) — 用户使用手册
- [x] [docs/faq.md](../../docs/faq.md) — 常见问题
- [x] [docs/self-hosting.md](../../docs/self-hosting.md) — 自托管指南
- [x] [docs/status.md](../../docs/status.md) — 服务状态

### 1.5 运维文档 ✅

- [x] [docs/operations-runbook.md](../../docs/operations-runbook.md) — 应急响应
- [x] [docs/compatibility-matrix.md](../../docs/compatibility-matrix.md) — 兼容矩阵
- [x] [docs/production-checklist.md](../../docs/production-checklist.md) — 上线检查单

### 1.6 GitHub Issue 模板 ✅

- [x] [.github/ISSUE_TEMPLATE/bug.md](../../.github/ISSUE_TEMPLATE/bug.md)
- [x] [.github/ISSUE_TEMPLATE/feature.md](../../.github/ISSUE_TEMPLATE/feature.md)
- [x] [.github/ISSUE_TEMPLATE/security.md](../../.github/ISSUE_TEMPLATE/security.md)
- [x] [.github/ISSUE_TEMPLATE/question.md](../../.github/ISSUE_TEMPLATE/question.md)
- [x] [.github/ISSUE_TEMPLATE/config.yml](../../.github/ISSUE_TEMPLATE/config.yml)

---

## 2. P1 一个月内补齐

| 项 | 计划 | 负责人 |
|----|------|--------|
| i18n 框架接入（中英双语首发） | M1.5 | 前端 |
| 笔记历史版本 | M1.6 | 后端 + 前端 |
| 全文搜索 v2（密文本地索引） | M1.7 | 客户端 |
| 键盘快捷键 Cheatsheet（F1 唤起） | M1.5 | 前端 |
| 模板系统 | M1.8 | 前端 |
| 移动端生物识别解锁 | M2.1 | 移动端 |
| 桌面系统托盘 + 全局快捷键 | M1.9 | 桌面端 |
| 产品官网（hero + 截图） | M1.2 | 设计 + 前端 |
| Logo 与品牌视觉 | M1.1 | 设计 |
| 短 onboarding 视频 | M1.5 | 市场 |
| 自托管一键部署脚本 | M1.4 | 运维 |
| 错误监控接入（Sentry 自托管） | M1.2 | 运维 |

---

## 3. P2 长期演进（v1.1+）

| 类别 | 项目 | 版本 |
|------|------|------|
| 高级编辑 | Vim 模式、表格编辑器、数学公式 | v1.3 |
| 知识组织 | 双向链接、知识图谱 | v1.5 |
| 协作 | CRDT 实时协同 | v2.0 |
| 扩展 | 浏览器扩展、移动桌面 Widget | v1.4 |
| 生态 | 公开 API、Webhook、插件 | v2.0 |
| AI | 写作润色、智能问答 | v2.0 |
| 迁移工具 | Evernote/Notion/OneNote 导入 | v1.3 |
| 商业化 | 家庭共享、付费主题 | v2.0 |

---

## 4. 实际投产仍需现场补齐（v0.1.0 → v1.0.0 GA 路上）

> 以下是"文档层面"已完成，但"运行时层面"必须由实施团队现场完成的事项：

### 4.1 域名与证书
- [ ] 购买 dustnote.app / dustnote.cn（如未注册）
- [ ] DNS 配置 A/AAAA 记录
- [ ] Let's Encrypt 证书签发
- [ ] HSTS Preload 提交
- [ ] 域名 WHOIS 隐私保护

### 4.2 邮件基础设施
- [ ] 邮件服务（Postmark / SES / 自建 Postfix）
- [ ] hello@dustnote.app / security@dustnote.app / oncall@dustnote.app
- [ ] DKIM / SPF / DMARC 配置
- [ ] 自动回复

### 4.3 监控基础设施
- [ ] Prometheus + Grafana 部署
- [ ] UptimeRobot / BetterStack 状态页
- [ ] PagerDuty / 飞书 / 钉钉 Webhook
- [ ] 日志聚合（Loki / ELK）

### 4.4 服务器
- [ ] VPS / 云主机采购（推荐 2 核 4GB 起）
- [ ] 操作系统初始化（Ubuntu 22.04 LTS）
- [ ] SSH 密钥 + fail2ban
- [ ] 防火墙配置
- [ ] 自动安全更新

### 4.5 第三方账号
- [ ] GitHub 组织 / 仓库
- [ ] Apple Developer 账号（iOS / macOS）
- [ ] Google Play 开发者账号（Android）
- [ ] 微信小程序账号
- [ ] 域名注册商账号

### 4.6 实体与备案
- [ ] 公司主体（或个体工商户）
- [ ] ICP 备案（如服务器在中国大陆）
- [ ] 公安备案
- [ ] 支付接入（如未来商业化）

---

## 5. 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| 主密码弱 + 设备未锁 | 高 | UI 引导、强度提示、自动锁屏 |
| 跨平台同步延迟 | 中 | 已实施 WebSocket，1s 内 |
| 客户端被 root 注入 | 中 | 服务端仅存密文 |
| 主密码遗忘 + 恢复码丢失 | 高 | 首次强引导抄写，提供导出备份兜底 |
| 小程序审核驳回 | 中 | 提前研究《小程序运营规范》 |
| iOS 端后台 WS 断连 | 低 | 进入前台立即补偿 |
| TLS 1.2 客户端兼容 | 低 | 内部接口强制 TLS 1.3，公网保留 1.2 |

---

## 6. 投产里程碑

- ✅ **v0.1.0**（2026-06-27）— 项目骨架 + 完整文档体系 + P0 检查单
- ⏳ **v0.5.0**（计划 4 周后）— Web 端 MVP + 主题系统 + 主密码
- ⏳ **v0.9.0**（计划 8 周后）— RC 候选 + 完整功能 + 全量测试
- ⏳ **v1.0.0 GA**（计划 10 周后）— 公开发布
- ⏳ **v1.1.0**（计划 14 周后）— 导入导出 + 分享
- ⏳ **v1.2.0**（计划 18 周后）— 桌面端

详见 [roadmap.md](./roadmap.md)

---

## 7. 签字栏

| 阶段 | 责任人 | 状态 | 日期 |
|------|--------|------|------|
| 文档完整性 | PM + Tech Lead | ✅ | 2026-06-27 |
| 工程实现 | 开发团队 | ⏳ 进行中 | - |
| 安全审计 | 安全负责人 | ⏳ 待安排 | - |
| GA 决策 | 全员 | ⏳ 待 v1.0.0 | - |
