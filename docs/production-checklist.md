# MintNote 生产上线检查单

> 适用版本：v1.0.0 GA
> 使用：每次发版前必跑，逐项打勾
> 责任：开发 + 运维 + 安全 各角色分头负责

## 0. 文档自检

- [ ] README.md 中快速开始已更新
- [ ] CHANGELOG.md 已写入本版本
- [ ] [.trae/documents/PRD.md](../.trae/documents/PRD.md) 与实际功能一致
- [ ] [.trae/documents/tech-architecture.md](../.trae/documents/tech-architecture.md) 与代码一致
- [ ] [.trae/documents/security.md](../.trae/documents/security.md) §15 安全清单全部勾选
- [ ] [docs/user-guide.md](./user-guide.md) 截图与 UI 一致
- [ ] [docs/self-hosting.md](./self-hosting.md) 跑通一次
- [ ] [docs/faq.md](./faq.md) 覆盖本期变更
- [ ] [docs/status.md](./status.md) 已部署

## 1. 合规与法务

- [ ] [docs/privacy-policy.md](./privacy-policy.md) 文案与代码行为一致
- [ ] [docs/terms-of-service.md](./terms-of-service.md) 已生效
- [ ] [docs/cookie-policy.md](./cookie-policy.md) 与实际 Cookie 一致
- [ ] LICENSE 文件（MIT）存在
- [ ] CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md 完整
- [ ] GitHub 仓库描述、Topics、Website 链接已配置
- [ ] 第三方依赖 License 全部 MIT / Apache 2.0 / BSD（无 GPL 污染）

## 2. 代码质量

- [ ] `pnpm lint` 0 错误
- [ ] `pnpm typecheck` 0 错误
- [ ] `pnpm test` 全部通过
- [ ] `pnpm audit --prod` 0 high / critical
- [ ] 关键路径单元测试覆盖 ≥ 80%
- [ ] 关键路径 E2E 测试覆盖 100%
- [ ] 无 TODO / FIXME 残留（除非带 issue 编号）

## 3. 安全

- [ ] Argon2id 参数合规：m=64MB, t=3, p=4
- [ ] JWT_SECRET 已轮换且 ≥ 32 字符
- [ ] 数据库文件权限 600，容器以非 root 运行
- [ ] TLS 1.3 only
- [ ] HSTS 头存在
- [ ] CSP 头存在且严格
- [ ] CORS 白名单配置
- [ ] 限流配置生效
- [ ] 日志脱敏中间件工作正常
- [ ] 错误响应不泄漏内部信息
- [ ] .env 不在仓库中
- [ ] 密钥、Token 不硬编码
- [ ] SBOM 已生成
- [ ] 渗透测试报告无 P0 / P1
- [ ] 主密码恢复流程已演练
- [ ] 备份恢复已演练

## 4. 性能

- [ ] Web 首屏 LCP < 1.5s（3G Fast）
- [ ] API P95 < 300ms
- [ ] WebSocket 通知 P95 < 300ms
- [ ] 编辑器打字 60fps
- [ ] 1k 笔记列表滚动 60fps
- [ ] 打包后 Web 体积 < 500KB gzip
- [ ] 桌面安装包 < 20MB
- [ ] Android APK < 30MB
- [ ] Lighthouse 评分 ≥ 90（性能 / 可访问性 / 最佳实践 / SEO）

## 5. 功能验证

- [ ] 主密码设置 / 修改 / 解锁 / 忘记密码
- [ ] 恢复码使用流程
- [ ] 笔记 CRUD（含移动端、PC 端、Web 端）
- [ ] Markdown 编辑器常用语法
- [ ] 图片 / 附件上传下载
- [ ] 标签 / 收藏 / 置顶
- [ ] 搜索
- [ ] 回收站
- [ ] 主题切换（6 主题 × 2 模式）
- [ ] 字体与密度
- [ ] 导入 .txt / .md / .docx
- [ ] 导出 MD / HTML / PDF / JSON
- [ ] 全量备份与恢复
- [ ] 创建 / 访问 / 吊销分享
- [ ] 分享密码与过期
- [ ] 多端实时同步（WebSocket）
- [ ] 离线编辑 + 联网自动同步
- [ ] 设备管理
- [ ] 数据导出 / 账户删除

## 6. 兼容性

- [ ] Chrome / Edge / Safari / Firefox 最新版
- [ ] 桌面：Windows / macOS / Ubuntu
- [ ] Android：API 28+ 真实设备
- [ ] iOS：16+ 真实设备
- [ ] 小程序：微信 / 支付宝 / 抖音

详见 [compatibility-matrix.md](./compatibility-matrix.md)

## 7. 部署

- [ ] 生产域名 DNS 解析正常
- [ ] TLS 证书 ≥ 90 天有效期
- [ ] HSTS Preload 申请已提交
- [ ] 镜像已推送至 ghcr.io / 阿里云
- [ ] docker-compose 已在 staging 跑通
- [ ] Nginx 反代配置（TLS 1.3 / CSP / Upgrade）已部署
- [ ] 健康检查 `/api/v1/health` 返回 200
- [ ] 状态页 status.mintnote.app 已配置
- [ ] 告警通道（PagerDuty / 飞书）已测试
- [ ] 监控（Prometheus + Grafana）已接入
- [ ] 备份 cron 已配置
- [ ] 异地备份已配置
- [ ] 防火墙仅开放 22/80/443
- [ ] SSH 密钥登录 + 禁用密码登录
- [ ] fail2ban 已启用

## 8. 监控与告警

- [ ] 登录失败率告警
- [ ] 5xx 错误率告警
- [ ] API P95 延迟告警
- [ ] 磁盘 / 内存 / CPU 告警
- [ ] 备份失败告警
- [ ] 证书过期告警（提前 30 天）
- [ ] 域名过期告警
- [ ] 同步冲突率告警

## 9. 用户支持

- [ ] 反馈邮箱已配置（hello@mintnote.app）
- [ ] 安全邮箱已配置（security@mintnote.app）
- [ ] 邮件自动回复已设置
- [ ] GitHub Issues 模板已配置
- [ ] Issue 标签体系已建立
- [ ] On-call 值班表已排定
- [ ] 应急响应 Runbook 已就位（[operations-runbook.md](./operations-runbook.md)）

## 10. 上线决策

- [ ] 产品负责人审批
- [ ] 技术负责人审批
- [ ] 安全负责人审批
- [ ] 运维负责人审批

**全部勾选后方可上线。**

## 11. 上线后 7 天关注

- [ ] 错误日志中无 P0 / P1
- [ ] 监控指标在阈值内
- [ ] 用户反馈已及时响应
- [ ] 备份每日成功
- [ ] 状态页可用率 ≥ 99.9%
- [ ] 灰度发布无回滚

---

**签字栏**

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| 产品 | | | |
| 技术 | | | |
| 安全 | | | |
| 运维 | | | |
