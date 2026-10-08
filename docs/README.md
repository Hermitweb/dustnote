# 文档索引

这里是全部文档的入口。README 的文档表太长时会失真，所以**这份索引是唯一权威**：
`pnpm docs:check` 会检查每篇文档都被这里提到（孤儿文档等于不存在），也会检查链接可达。

| 分类   | 文档                                                    | 是什么                                       |
| ------ | ------------------------------------------------------- | -------------------------------------------- |
| 用户   | [用户使用手册](user-guide.md)                           | 五端通用操作、快捷键、导入导出、模式切换     |
| 用户   | [常见问题](faq.md)                                      | 加密、同步、账号恢复、锁屏等行为解释         |
| 用户   | [安装与卸载](installation-guide.md)                     | 各平台安装、静默部署、自动更新通道           |
| 用户   | [兼容性矩阵](compatibility-matrix.md)                   | 系统版本要求与已知限制                       |
| 自托管 | [自托管指南](self-hosting.md)                           | 引导式路径：Docker / 手动 / 反代 / HTTPS     |
| 自托管 | [服务端部署文档](../DEPLOY.md)                          | 完整参考手册（与 self-hosting 的分工见下文） |
| 自托管 | [上线检查单](production-checklist.md)                   | 部署前后必须逐项确认的清单                   |
| 自托管 | [运维手册](operations-runbook.md)                       | 备份恢复、升级回滚、监控与故障定位           |
| 自托管 | [Android 签名](android-signing.md)                      | keystore、密钥托管与轮换                     |
| 自托管 | [微信隐私合规清单](wechat-privacy-checklist.md)         | 小程序上架所需的隐私说明                     |
| 参考   | [API 一览](api.md)                                      | 由代码生成的端点清单（含认证要求）           |
| 参考   | [OpenAPI 规范](openapi.yaml)                            | 部分端点的机器可读定义                       |
| 参考   | [安全模型](security-model.md)                           | 密钥派生、威胁模型与已知取舍                 |
| 参考   | [图标语义映射](ui-icon-map.md)                          | 图标与语义对应表，禁止再往文案塞 emoji       |
| 参考   | [Cookie 政策](cookie-policy.md)                         | 用到的存储项与用途                           |
| 参考   | [隐私政策](privacy-policy.md)                           | 本产品收集什么、不收集什么                   |
| 参考   | [服务条款](terms-of-service.md)                         | 使用条款                                     |
| 工程   | [架构总览](architecture.md)                             | 包分层、数据流、同步与加密边界               |
| 工程   | [client-core 下沉记录](client-core-migration.md)        | 跨端内核迁移的取舍与遗留                     |
| 工程   | [工程目录规范](note-system-folder-structure-spec.md)    | 目录结构与命名约定                           |
| 工程   | [发展路线图](roadmap.md)                                | 阶段目标、度量口径、明确不做清单             |
| 工程   | [UI 优化方案](ui-optimization.md)                       | 设计系统地基、两栏舞台、可量化验收           |
| 工程   | [决策记录（ADR）](adr/README.md)                        | 重要技术决策的背景与后果                     |
| 归档   | [安全审计整改（9-19）](audit-fixes-2026-09-19.md)       | 逐条 finding 与整改结果                      |
| 归档   | [安全审计整改（9-21）](audit-fixes-2026-09-21.md)       | 第二轮复核与遗留项                           |
| 归档   | [全端审计（10-07）](audit-report-2026-10-07.md)         | 探针式全端审计 + 页面截屏核对，修复台账      |
| 归档   | [生产就绪度审计](archive/production-readiness-audit.md) | 早期全量审计，保留作历史参照                 |

## 三份部署文档怎么分工

- `self-hosting.md`：**引导式**，从零到跑起来的一条路径，读它办事。
- `DEPLOY.md`（仓库根）：**参考手册**，逐项参数、Nginx/Caddy、备份、升级、排障；
  它留在根目录是因为发版流程会把它复制进部署包（见 `.github/workflows/release.yml`），
  不是随手放的——移动它要先改发版脚本。
- `production-checklist.md`：**上线前打勾用的清单**，不解释原理。

## 工程文档与历史文档

`architecture.md` 与 `adr/` 记的是「现在为什么这样」；`audit-fixes-*` 与 `archive/` 记的是
「当时发生过什么」。后者是历史叙述，**不会为了让链接好看而改写**——里面出现过的死链
一律降级成行内代码（文字保留，不再假装能点开），这也正是 `docs:check` 能长绿的前提。

## 想知道某个目录的事，看哪儿

文档分两层：**这份索引管「为什么与怎么办」**，各目录的 README 管「那里有什么、怎么跑、
改它要连带改什么」。两边不重复内容，只互相指路。

| 位置           | 文档                                                                                    | 回答的问题                                       |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `shared/`      | [shared/README.md](../shared/README.md)                                                 | 哪些算法/契约是五端共用的？改加密参数会牵连谁？  |
| `client-core/` | [client-core/README.md](../client-core/README.md)                                       | 同步、冲突合并、仓库层现在只有一份在哪儿         |
| `server/`      | [server/README.md](../server/README.md)                                                 | 路由怎么挂、环境变量在哪读、端点清单从哪生成     |
| `web/`         | [web/README.md](../web/README.md)                                                       | 界面规矩（图标、材质、两栏舞台）与桌面端复用关系 |
| `site/`        | [site/README.md](../site/README.md)                                                     | 官网为什么带 24 条测试、怎么发布到 Pages         |
| `scripts/`     | [scripts/README.md](../scripts/README.md)                                               | 每条门禁对应哪次事故、门禁自己归谁测             |
| `e2e/`         | [e2e/README.md](../e2e/README.md)                                                       | 视觉基线与对比度断言怎么跑、什么不许顺手更新     |
| `extensions/`  | [extensions/README.md](../extensions/README.md)                                         | 网页剪藏扩展的权限与明文边界                     |
| `deploy/`      | [deploy/README.md](../deploy/README.md) · [monitoring/](../deploy/monitoring/README.md) | 部署包结构；监控栈与告警链路                     |
| 全局           | [CONTRIBUTING.md](../CONTRIBUTING.md)                                                   | 门禁总表与来历、提交与 PR 流程、变异验证文化     |

## 一条判断标准

写文档前先问：**这条信息变了会不会有人挨打？**
会——它该是门禁（`scripts/` 里一条带测试的脚本），而不只是一段话；
不会——它才留在文档里。这两天反复出现的「全绿但线上炸」，根因都是本该是门禁的东西
只写成了文字。
