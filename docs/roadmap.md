# DustNote 发展路线图（2026-09-25 起）

> 基线：`v2.5.45` / commit `5b9618b` / 分支 `fix/audit-2026-09-19`
> 依据：本机全量验证（typecheck / lint / test / format / 一致性脚本）、线上外网探测、
> 两轮审计台账（`audit-fixes-2026-09-19.md`、`audit-fixes-2026-09-21.md`）、CHANGELOG 与 docs/ 现状。
> 本文取代已下架的 `.trae/documents/roadmap.md`（M0–M8 里程碑全部已完成 ✅）。

---

## 0. 现状体检（体检结果决定优先级，所以放在最前面）

### 0.1 已经是绿的（不需要投入，需要的是"守住"）

| 项                      | 结果                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`             | 7/7 包 exit=0                                                                                                                                       |
| 单元测试                | **479 全绿**：shared 121 / client-core 79 / server 115 / web 133 / mobile 31                                                                        |
| `eslint`                | **0 error / 0 warning**（P0-6 已清零）                                                                                                              |
| `prettier format:check` | 全仓通过                                                                                                                                            |
| i18n 词典               | web 514 / mobile 467 / miniprogram 446，中英对称，无缺 key                                                                                          |
| 版本一致性              | README 徽章 = SW_VERSION = package.json = 2.5.44                                                                                                    |
| 发布产物                | v2.5.44 Release 12 个产物齐全（APK / Win x64+arm64 setup / MSI / portable / AppImage / DMG / server / web / mp-weapp / mp-h5）                      |
| UI 对比度门禁           | `e2e/a11y-contrast.ts` + `e2e/visual-baseline.spec.ts`：纯色底文字 AA **0 失败**；玻璃叠极光最坏情况 56 处记为阶段 3 待办（298 个文本样本纳入计算） |
| 流水线                  | Release ✅、CodeQL ✅；main 上最近 2 次 CI 失败原因已修（README 徽章校验），后续 workflow_dispatch 全绿                                             |

**结论：代码层面的工程质量已经高于同类个人项目平均水平。** 这意味着继续投"再多一个功能"的边际收益，
低于投"让用户敢把全部笔记交给你"的收益 —— 下面 6 条就是这个判断的依据。

### 0.2 体检发现的 6 个真实缺口（本路线图的主轴）

1. **线上拓扑与文档不一致**（实测）
   `docs/status.md` 与 README 全部指向 `http://154.217.234.125:8080/`，但外网探测结果：
   - `TCP 8080` → **不通**（同机 80/443 通，说明不是网络不可达）
   - `http://154.217.234.125/` → 200，但内容是**个人主页**（尘渊 · Hermitweb），不是 DustNote；该 vhost 的 `/api/*` → 404
   - `https://154.217.234.125/api/v1/health` → **200** `{"ok":true,"version":"2.5.44","db":"ok","uptime":54.2}`，
     但证书**不受信任**（自签/内部 CA），`nginx` 回源，HSTS 已开
     → 实际线上是"IP + 自签证书 + HTTPS"，文档写的是"IP:8080 + 明文 HTTP"。**任何按文档配置的客户端或监控都会判定失败。**
     另：探测时（01:33:48）`uptime` 仅 54 秒，而维护者本机正在改 `deploy/upgrade.sh`（01:38 保存，内容正是"v2.5.44 升级实战首撞：down 后 cwd 停在旧目录，裸 create 重建了旧容器"）—— 判定为**升级重启而非崩溃循环**；但也说明 `upgrade.sh` 的路径/项目名锚定修复尚未提交，且升级后 8080 端口映射消失（拓扑变化未被任何文档记录）。

2. **没有外部拨测，"服务状态"是自动化的假绿**
   `docs/status.md` 的"最近人工核对"日期由 `scripts/bump-version.mjs` 随发版自动归一 ——
   也就是说：**发版这个动作本身会把状态页刷成 🟢**，而不是探测结果。`operations-runbook.md §3.2`
   自己也把"外部拨测"列为待建设。单用户自托管产品，"你的服务器还在不在"是用户第一个问题。

3. **图片/附件是"单机私产"，跨设备/跨端/导出/分享全部丢图**（代码级证据）
   `web/src/lib/image-store.ts` 把正文里的 base64 抽到 **IndexedDB**，正文只留 `![alt](dustnote-img://id)`。
   全仓只有 `web/src/components/Editor.tsx` 在渲染前还原引用 ——
   - 联机同步到另一台设备：服务端只有密文正文，引用指向的字节对端不存在 → 空图
   - 导出 ZIP / JSON / HTML / PDF、在线分享页（`shares.title/content`）：引用原样带出去 → 空图
   - `mobile` 完全没有该协议实现；`miniprogram/src/lib/markdown.tsx:92` 明确"仅渲染 http(s) 外链，
     `dustnote-img://` 等本地引用不渲染" → 空图
     → 用户视角的"端到端加密笔记"，**带图片的笔记实际上是不可靠的**。这是当前最大的产品级数据风险，
     比审计台账里任何一条都严重。

4. **三个客户端包零单测**：`desktop` / `mobile` / `miniprogram` 的 `test` 脚本是 `echo [skip]`（审计 TEST-001 已知），
   `miniprogram` 连 `lint` 脚本都没有；e2e 只有 3 个 spec（`e2e/core-flow`、`folders-unfiled`、`online-flow`）。
   四端行为一致性目前靠"人肉核对 + 审计台账"维持 —— 这正是 `client-core` 想消灭的东西，但下沉还没做完
   （`ARCH-R01` 剩余、`i18n 三端合并`、`getDeviceId` 之外还有 crypto-polyfill / storage 适配层）。

5. **更新链路的信任根仍是服务器自己**：minisign 验签未落地（`security-model.md §2.5` 明说白名单防的是误配置，
   不是服务器被攻破）；Windows 无代码签名、macOS 未签名（README 让用户"右键打开"）。
   自动更新是 E2EE 产品最脆弱的供应链环节，目前是二流水准。

6. **巴士因子 = 1**：`status.md` 自述"单维护者项目，暂无对外 SLA 承诺"。
   所有决策、发布、运维、答疑集中于一人，任何长期路线都必须回答"这件事能不能自动化/能不能交给别人"。

---

## 1. 三条主轴

| 主轴                   | 内容                                                   | 时间窗    | 为什么排在这个位置                                       |
| ---------------------- | ------------------------------------------------------ | --------- | -------------------------------------------------------- |
| **A 可证明的稳定**     | 真实状态、拨测告警、真证书域名、更新验签、备份可恢复   | 0–3 个月  | 信任是 E2EE 产品的全部资产，且**投入小、可验证、见效快** |
| **B 结构债与回归保护** | 附件系统、三端下沉、测试层、巨型文件、依赖大版本窗口   | 3–6 个月  | 让"改一处不用核对四端"，把维护成本降到可持续             |
| **C 能力扩展与可持续** | 数据可移植、双链、协同/多人、iOS、AI、开放 API、商业化 | 6–18 个月 | 每一项都依赖 B 的附件/协同密钥设计与 A 的分发通道        |

**判断：** 功能面（6 端 × E2EE × 双模式 × 同步 × 分享 × 模板 × 语音 × 回收站 × 版本）已经不缺，
缺的是"可靠"与"可维护"。所以本路线图的顺序是 **先修可信，再修结构，最后扩能力**，
而不是按用户请求的到达顺序排。

---

## 2. R0 · 收尾与止血（`v2.5.45` → `v2.6.0`，1–2 周）

目标：**把"已经做到的"如实呈现出来，把会静默丢数据的先堵上。**

| #    | 动作                                                                                                                                                                                                                                                                 | 依据 / 落点                                                                                  | 验收                                                                  | 量  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --- |
| P0-1 | 核清线上真实拓扑，改 `docs/status.md` + README + `DEPLOY.md` 的示例地址；把"人工核对"与自动归一解耦（改由探测结果写入，或至少标注"自动归一"）                                                                                                                        | 0.2-① 实测                                                                                   | 文档里每个 URL 外部可达，且脚本不再无脑刷 🟢                          | S   |
| P0-2 | 加**外部拨测**（UptimeRobot / 自建 cron 探 `https://<host>/api/v1/health`，断言 `version` == 最新 tag），并把 `METRICS_ENABLED=true` + `deploy/prometheus/rules.yml` 真接上 Alertmanager                                                                             | `operations-runbook §3.2`、`server/src/metrics.ts`                                           | 主动拔容器能在 2 分钟内收到告警（演练记录归档）                       | S   |
| P0-3 | **图片止血**：① 编辑器插入图片时若当前为联机模式 → 显式提示"图片暂不跨设备同步"；② 导出/备份前把 `dustnote-img://` 还原为 base64（`restoreNoteImages` 已具备）；③ 单机 ZIP 备份包含 IndexedDB 图片本体；④ 分享页与 mobile/miniprogram 渲染缺失引用时显示占位而非空白 | `web/src/lib/image-store.ts`、`web/src/lib/io-client.ts`、`miniprogram/src/lib/markdown.tsx` | 一条带图笔记：导出 ZIP 再导入另一设备 → 图在；分享页 → 图在或明确占位 | M   |
| P0-4 | 给 OBS-R03 上报补**设置页开关**（代码注释已把它列为"后续项"），并把采集从 mobile 扩到 web/desktop（复用同一 `/diagnostics/reports` 契约）                                                                                                                            | `mobile/src/lib/diagnostics.ts:16`、`server/src/routes/diagnostics.ts`                       | 设置页可关；关闭后无网络上报（有测试）                                | S   |
| P0-5 | 审计台账里"本环境可验证"的剩余项落地：`SEC-R07` Tauri CSP 运行时注入、`A11Y-R05` weapp 减弱动效开关、`PLAT-R02` 小程序极光层每页化、`API-R01` OpenAPI 从路由生成、`LIFE-R03/R04` 文档与引导                                                                          | `audit-fixes-2026-09-21.md §七`                                                              | 每项有 commit + 本地验证记录                                          | M   |
| P0-6 | 仓库卫生：关闭 GitHub 上 7 个重复 issue（#2–#8「Android build: APK not generated」，v2.5.44 产物里 APK 已正常）；删 README「项目结构」里残留的 `.trae/documents/` 行（DOC-001 同源漏网）；清 14 个 lint warning；补 `miniprogram` 的 `lint` 脚本                     | `gh issue list`、README:~205                                                                 | issue 列表 0 open；`pnpm lint` 0 warning；七包都有 lint               | S   |
| P0-7 | 提交 `deploy/upgrade.sh` 的 `compose -f/-p` 锚定修复（目前只在工作区，未提交）；并让 `upgrade.sh` 收尾时回写 `docs/status.md` 的**实际可达地址**（探测所得 origin，不沿用文档旧值）                                                                                  | 0.2-①                                                                                        | 升级一次之后，文档里的地址与外部真实可达地址完全一致                  | S   |

**R0 不做**：任何新功能、任何大重构、任何依赖大版本升级。

---

## 3. R1 · 可信交付（`v2.6.x`，1–2 个月）

目标：**让"敢用"有客观凭据：域名 + 真证书 + 验签更新 + 可恢复备份。**

| 主题         | 动作                                                                                                                                                                                                                                  | 说明 / 依赖                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| HTTPS 收口   | 域名解析 → ACME（Caddy 或 nginx+certbot）→ 强制 HTTPS → HSTS preload；**80 上只留重定向**（当前 80 是个人主页，需要明确二者关系）                                                                                                     | 中国大陆访问需 **ICP 备案**（审计已列为"外部资源类"阻塞项，**至少提前 30 天启动**）；无备案则明确只服务非大陆用户或走海外节点 |
| 更新验签     | `tauri signer generate` → 私钥进 CI secret、公钥进 `tauri.conf.json` + 编译进 Rust 常量；下载后**先验 minisign 再落盘**；`allowed_prefixes` 改 Rust 硬编码；重定向策略只跟随仍匹配白名单的 origin                                     | 消除 0.2-⑤「服务器被攻破即可投毒」；Android APK 侧同步补 manifest 签名校验                                                    |
| 安装包签名   | Windows OV/EV 代码签名证书；macOS Developer ID 签名 + notarize（需一台 Mac 或云 Mac CI）                                                                                                                                              | 现在 README 教用户"右键打开"绕过 Gatekeeper，是对信任的消耗；Android 已有 keystore，补发布说明与 SHA-256 公示                 |
| 备份可恢复   | 只以加密 `.enc` 为默认产物 → off-site（对象存储 / rclone）；把"从零恢复"做成一条可重复执行的演练脚本 + 季度提醒                                                                                                                       | `security-model.md §2.4`、`deploy/deploy.sh` 已生成 `BACKUP_ENCRYPTION_KEY`；缺的是 off-site 与演练                           |
| 明文链路     | 客户端在**公网 http** 上继续弹窗，但升级为"默认拒绝 + 需显式确认并记录"；文档把"局域网自托管"与"公网自托管"分成两条部署路径                                                                                                           | 保持 0.2-② 的自托管取舍，但把知情成本交给用户，而不是默默承受                                                                 |
| 强制升级出口 | 去掉 `version-check.ts` 里硬编码的 `https://dustnote.app/download`，改 `config.webOrigin` / `DOWNLOAD_PAGE_URL`；`BETA_TRAFFIC_RATIO` 默认 0，未配置通道回退 stable                                                                   | 审计 `LIFE-008/009`，很小但直接影响线上升级行为                                                                               |
| 供应链       | `pnpm pin-digests` 落地 `FROM ...@sha256:`；关键 Actions pin full SHA；SBOM 随 Release 产出；CI 的 audit job 失败要**显式红灯**（本机 registry 为 npmmirror 时 `pnpm audit` 直接无 endpoint，本地不可验证 —— 文档要写明只能在 CI 跑） | 审计 `TEST-007/008`、`DEP-001`（`lodash-es ^4.18.1` 需上游存在性核验）                                                        |

**R1 验收（SLO 化）**：

- 外部拨测月可用率 ≥ 99.5%，且状态页由拨测结果驱动
- `https://` 真证书可达，明文 http 访问被重定向
- 篡改更新包 1 字节 → 客户端拒绝安装（有自动化测试）
- 从 `.enc` 备份完成一次真实恢复演练，全程 ≤ 30 分钟，记录归档

---

## 4. R2 · 结构债与回归保护（`v2.7.0`，3–6 个月）

目标：**把"四端一致"从人肉纪律变成机器保证；把附件这个数据模型缺口正式补上。**

### 4.1 附件系统 v1（本阶段最大功能项，也是 P0-3 的最终解）

```
notes ──(1:N)── attachments(id, note_id, dek_wrapped_blob_meta, size, mime, sha256, created_at)
                  ├─ 文件体：服务端磁盘/对象存储，只存 AES-256-GCM 密文（客户端加密）
                  └─ 引用：![](dustnote-att://<id>)，渲染时按 id 拉密文→本地解密
```

- 分块上传（单文件目标 ≤ 100MB，绕开 `express.json` 10mb 上限）、断点续传、内容寻址去重（同用户内）
- 四端渲染统一（web/desktop/mobile/miniprogram），**导出 ZIP/在线分享/单机备份**都走同一条解析路径
- 迁移：把存量 `dustnote-img://`（IndexedDB 内 base64）一次性上传为附件；失败时保留本地回退
- 前置 ADR：附件 DEK 与 masterKey 的关系（复用笔记 AAD 还是独立 HKDF info）、配额、回收站与彻底删除的清理时机

### 4.2 下沉与测试层

| 动作                                                                                                                                                                                                                 | 落点                                                               | 验收                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| 三端"无模拟器可测"的最小层：`mobile/src/lib/*`、`miniprogram/src/lib/*` 全部改造成**注入式适配器**后用 vitest 覆盖（fake storage / fake Taro / fake RN）；`desktop` 直接复用 web 组件测试（`ARCH-R02` 已打通包边界） | 三个 `echo [skip]` 脚本必须消失                                    | 三包各 ≥ 60 个用例，CI 出覆盖率曲线             |
| 巨型文件拆分：`web/components/Sidebar.tsx` 1595、`mobile/screens/SettingsScreen.tsx` 1585、`web/lib/i18n.ts` 1416、`web/lib/slices/data-slice.ts` 1151、`miniprogram/pages/index` 1152、`pages/note/edit` 1045       | 按现有 `slices/` 模式切；`ARCH-006`                                | ESLint `max-lines` 只对新增代码生效（阈值 500） |
| `ARCH-R01` 全端 token 单一源：mobile / miniprogram 玻璃色从 shared 模块派生内联 style                                                                                                                                | web 端已完成                                                       | 三端主题改一处生效                              |
| i18n 三端合并为单一资源包（`shared/src/locales` 或新 `packages/i18n-assets`），`check-i18n.mjs` 从"三端对称"升级为"单一源 + 用量报告"                                                                                | 审计 `DOC-009/ARCH-007`                                            | 词条数下降，缺 key 不可能发生                   |
| e2e 扩到 12 条：核心 CRUD、离线重放、409 冲突裁决、standalone↔online 迁移、恢复码、分享密码 + 锁定、导入导出含图、TOTP 登录、设备吊销、强制升级、多设备同步                                                          | `e2e/`                                                             | 每条对应一个真实回归事故                        |
| 依赖大版本专项窗口：Taro 3.6 → 4（顺带根治 request/swiper/vm2/tough-cookie 旧链）、RN 0.74 → 当前、ESLint 8 → 9                                                                                                      | 各开独立分支 + 完整回归                                            | 三个升级各自可回滚                              |
| 性能预算真实化：1 万条笔记的同步/搜索/首屏基准，纳入 CI（超预算 exit 1）                                                                                                                                             | `NotesListScreen.tsx:153` 主线程逐条解密是已知点；考虑 worker/批量 | 有基线数字与趋势                                |

---

## 5. R3 · 能力扩展（`v3.0.0`，6–12 个月，按依赖排序）

> 顺序不是"哪个更酷"，而是"哪个是另一个的前置"。

1. **数据可移植性优先**：与 Joplin / Obsidian / 纯 Markdown 目录的双向导入导出（含图片附件、文件夹、标签）。
   _理由_：E2EE 自托管产品最大的反对意见是"锁死"，先拆掉这个反对意见，后面所有功能才有人愿意试。
2. **客户端全文检索增强**：同义词/拼音/语义向量索引（仍在本地），并解决"多设备索引重建"策略。
   _红线_：**绝不做服务端明文检索**（会直接毁掉零明文承诺，见 §7）。
3. **双向链接与关系图**：`web/src/lib/wikilinks.ts` 已有雏形 → 反链面板 + 图谱视图（桌面优先）。
4. **协同（分两步）**：
   - 4a 多人**只读**分享 + 评论（服务端仍只见密文，密钥通过一次性分享链接下发）
   - 4b **CRDT 协同编辑**（Yjs over WebSocket，服务端只存密文 update log + 快照）
     _前置 ADR_：E2EE 下的协作者密钥协商 —— 每加一人需对其 re-wrap，**主密码泄露半径会扩大到协作者集合**，
     这是产品定位级别的决定，必须先写 ADR 再写代码。
5. **家庭 / 团队版**：多用户 + 组密钥 + 管理员与审计（同 4b 的密钥协商），也是 §6 商业化的载体。
6. **iOS 正式发布**：RN 代码已就绪，阻塞项是 Mac 硬件 + Apple 开发者账号；顺带解决 macOS 桌面构建实测（README 目前 `continue-on-error`）。
7. **AI 能力（最后做，且规则先行）**：写作润色、自动标签、基于本地索引的问答。
   _红线_：默认只在本地/自建推理；任何"明文离开设备"的路径必须显式确认、可在设置里永久关闭、
   并同步写进 `docs/security-model.md` 的取舍表。**不做静默上云摘要。**
8. **开放能力**：REST API（读为主）+ PAT 令牌 → 只读 Webhook → 沙箱插件（自定义块/主题）。
   _顺序理由_：API 会立刻产生"用户依赖"，必须在 HTTPS 与验签稳定后（R1）才暴露。

---

## 6. R4 · 可持续与商业化（12 个月+）

| 方向      | 具体                                                                                                                       | 与开源承诺的边界（必须写清，否则口碑反噬）                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 托管版    | "我帮你运维，服务端仍然零明文"的 SaaS，按存储/席位数计费                                                                   | **自托管永久免费、功能不阉割**；阉割只发生在"运维价值"（备份、域名、多端推送、SLA） |
| 家庭/团队 | 席位付费（承接 R3-5 的组密钥）                                                                                             | 个人单机/联机版永久免费                                                             |
| 生态收入  | GitHub Sponsors、付费主题包、付费模板包                                                                                    | 主题 token 单一源（R2）落地后成本极低                                               |
| 社区健康  | 公开 ADR 目录、roadmap 用 issue 承载、`good-first-issue` 标签、双周发布节奏、**至少 1 名 backup maintainer**               | 目标：把"发版 + 一线答疑"从单人不可中断变成可交接                                   |
| 合规      | GDPR 导出/删除已具备（`routes/account.ts`），补 DPA 模板；微信小程序隐私合规年度复审（`docs/wechat-privacy-checklist.md`） | 面向企业客户前必做                                                                  |

---

## 7. 明确不做（反路线，用来挡需求）

- ❌ 服务端明文搜索 / 服务端可读的任何"智能功能"
- ❌ 用"官方云"取代或弱化自托管路径
- ❌ 承诺 Taro 全 7 端（支付宝/百度/QQ/京东/头条）：收敛到 **微信小程序 + H5** 两端，其余保留构建但不承诺兼容演进
- ❌ 32 位系统、Android ≤8、Windows 7/8.1、macOS ≤10.15（沿用 `compatibility-matrix.md §10`）
- ❌ 无用户开关的遥测/崩溃上报（现有 OBS-R03 必须按 P0-4 补开关后才算合规）
- ❌ 静默 AI 上云
- ❌ 为"多设备实时协同"牺牲 E2EE（宁可推迟 4b，也不做"服务端可信"的版本）

---

## 8. 度量口径（每阶段用同一把尺，避免自欺）

| 维度     | 指标                                    | 当前                       | 目标                             |
| -------- | --------------------------------------- | -------------------------- | -------------------------------- |
| 可用性   | 外部拨测月可用率                        | 未测                       | ≥ 99.5%                          |
| 故障发现 | 从宕机到告警的分钟数                    | 未知（靠用户反馈）         | ≤ 3 min                          |
| 稳定性   | 诊断上报的崩溃事件 / DAU-设备           | 通道刚建成，无数据         | 建立基线后逐月下降               |
| 同步     | 保存 → 对端可见 P95                     | 文档宣称 < 1s，未测        | 拨测端持续埋点                   |
| 解锁     | 移动端 KDF+解锁 P95                     | 未测                       | 建立基线（100k PBKDF2 取舍校准） |
| 质量     | 单测总数 / 覆盖率                       | 399 / web 24%、server 未标 | R2 末 ≥ 700，三端不再是 0        |
| 前端     | Web JS 包体积                           | CI 有预算门禁              | 维持，并加首屏 LCP 预算          |
| 交付     | 发版前置时间（commit → 全平台产物就绪） | Release 流水线 ~18–22 min  | ≤ 25 min，且可单端重出           |
| 可持续   | 能独立完成发版的人数                    | **1**                      | ≥ 2                              |

---

## 9. 风险登记表（Top 6）

| 风险                       | 影响                                                        | 概率           | 缓解                                      | 触发信号                          |
| -------------------------- | ----------------------------------------------------------- | -------------- | ----------------------------------------- | --------------------------------- |
| 巴士因子 = 1，维护者不可用 | 停更、无人响应安全报告                                      | 高             | R4 社区线：ADR + 文档 + backup maintainer | issue 首响超过 7 天               |
| 图片附件模型缺陷被用户遇到 | 数据丢失感知，口碑崩塌                                      | 高（现在就有） | P0-3 止血 → R2 附件 v1                    | 诊断/反馈出现"图片不见了"         |
| 公网明文 / 自签证书        | 凭据与结构被窃听（正文仍是密文）                            | 中             | R1 HTTPS 收口 + 公网 http 默认拒绝        | 用户报"证书不安全"                |
| 更新通道被攻破即投毒       | 全设备沦陷（端到端加密也救不了）                            | 低但致命       | R1 minisign + 白名单硬编码 + fail-closed  | 任何 hash 校验绕过                |
| Taro/RN/ESLint 大版本欠账  | 旧 CVE 链无法根治（request/vm2/tough-cookie），生态兼容漂移 | 中             | R2 专项升级窗口，逐包可回滚               | `pnpm audit` 出现无法闭合的 high  |
| SQLite 单库 + 附件入库     | 库体积 → 备份/恢复/同步全链路变慢                           | 中             | 附件走文件系统/对象存储，库只存元数据     | `dustnote_db_size_bytes` 增长斜率 |

---

## 10. 如果只做三件事

1. **今天**：核清线上真实拓扑（8080 不通 / 443 自签 / 80 是个人主页），把 `status.md` 与 README 的地址和"自动绿"改掉。
2. **本周**：外部拨测 + 告警接线；同时做图片跨设备丢失的止血（提示 + 导出内联 + 备份含图）。
3. **本迭代**：写附件系统 v1 的 ADR，并落地 minisign 更新验签 —— 前者解决最大的数据风险，后者解决最大的安全风险。

---

## 附：本路线图与既有审计台账的关系

`audit-fixes-2026-09-19.md` / `-09-21.md` 里仍挂账的项目**已按阶段吸收**：

- R0 P0-4 / P0-5：`OBS-R03` 开关、`SEC-R07`、`A11Y-R05`、`PLAT-R02`、`API-R01`
- R1：`PLAT-001 残余`（minisign/白名单）、`SEC-R05`（clipper E2EE）、`LIFE-R01/R02`（off-site 与恢复演练）、
  `TEST-007/008`（pin digest / Actions SHA）、`LIFE-008/009`
- R2：`ARCH-R01` **已关闭**（`theme-engine` + `theme-seeds` 成为四端唯一真相源；web/desktop 运行时注入、mobile 走 `paletteFor()`、小程序走生成脚本 + CI 防漂移）
  、`ARCH-006/007`（巨型文件与 i18n 合并）、`DEP-004/006/005`（Taro4 / RN / ESLint9）、`TEST-001`（mobile 已消，desktop / miniprogram 待消）
- UI 专项：**A11Y-R01/R02/R03 从「手工调对比度」升级为「引擎构造保证」** —— 见同日第三落
- R3/R4：外部资源类（Apple 签名、代码签名证书、ICP 备案）与协同/AI 的产品级决定

> 维护约定：每季度末对照本文档，把"已完成"删除、把"改变判断的新证据"追加到 §0.2，
> 并在本文档顶部更新基线版本号。路线图失效比不精确更危险。

---

## 复测与进度（2026-09-25，同日）

### §0.2-① 拓扑结论已被证伪（改变 R1 判断，必须纠正）

§0.2-① 与 §1 P0-1 的前提"线上是 IP + 自签证书 + 明文 8080，文档全错"经本机
当日复测不成立。当前真实拓扑（`curl` + `openssl s_client` 实测）：

| 探测目标                                    | 结果                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `http://154.217.234.125:8080/api/v1/health` | **HTTP 200**（8080 可达，非"不通"）                 |
| `https://154.217.234.125/api/v1/health`     | HTTP 200                                            |
| `https://napi.iniess.cn/api/v1/health`      | HTTP 200，证书 `issuer=C=US,O=Let's Encrypt,CN=YR2` |

即 **`napi.iniess.cn` 已是 Let's Encrypt 受信证书 + HTTPS 可达**（`WEB_ORIGIN`
早已切到该域名，见部署记忆）。§0.2-① 描述的"自签/不受信任"针对的是
**裸 IP 的 443 默认 vhost**，与规范访问域名不是一回事。

**对 R1 的影响**：R1「HTTPS 收口」不是从零建设，而是**收尾**——真证书已在
`napi.iniess.cn`；待办收窄为「文档统一改用该域名、80/8080 明文入口重定向或
关闭、评估 HSTS preload、ICP 备案」。P0-1 的"改文档地址"部分据此调整。
（`80` 端口是否仍是个人主页 vhost 需业务确认后再决定重定向策略。）

### 已完成项（本分支 fix/audit-2026-09-19 上）

- **P0-4（部分）**：`OBS-R03` 诊断通道移动客户端已建 + 设置页开关**未做**；
  采集扩到 web/desktop **未做**。mobile vitest 基建落地（`b00fe2a`），
  顺带揪出两个生产 bug（401 静默刷新自 v2.5.18 起是死代码；诊断队列
  memQueue 冷启动覆写丢积压）——**这把 §0.2-④ "三端零单测" 的 mobile 部分先补了**。
- **P0-7（部分）**：`deploy/upgrade.sh` 的 `-f/-p` 锚定修复**已提交**（`91349ad`，
  非仅工作区）；收尾回写实际可达地址**未做**。
- **P0-6（大部分）**：7 个重复 APK issue（#2–#8）已关闭；13 处 `no-unused-vars`
  warning 清零（FTextInput 迁移残留的 9 个 `TextInput` import + voice 死类型 +
  KDF_PARAMS + app.test 的 beforeEach）；desktop 1 处 exhaustive-deps 已用带理由的
  disable 注释收口。**未做**：miniprogram 的 `lint` 脚本补齐。
- **CI 触发面**：`ci.yml` 的 `push.branches` 补 `fix/**`（此前 fix 分支上 CI 从不
  运行，与 dev/\*\* 同源陷阱）。
- README `.trae/documents/` 残留（§0.2 未列，属 P0-6"仓库卫生"同类）已删。
- **P0-3 图片止血（同日第二落，四动作全落地）**：
  ① web 编辑器联机插图即时提示「仅存本机」（会话级一次防打扰）；
  ② 单条导出（MD/HTML/PDF/JSON）与 Sidebar 快捷导出/文件夹 ZIP 全部
  经 `restoreNoteImages` 还原为内联 data URL——"导出再导入另一设备→图在"
  验收达成；③ 全量备份 JSON 逐条还原（auto-backup 已死，备份=这条通道）；
  ④ 缺图占位统一：web 渲染出口（Editor 预览/分享页 PublicShareView/历史
  预览 NoteHistoryDialog）经 `replaceMissingImageRefs` SVG 占位，mobile
  MarkdownView 新增图片块（http/https/data: 渲染、本地引用占位——此前
  `![x](url)` 会渲染成 `!`+链接的怪样），小程序端本就有占位口径。
  **顺带修复**：image-store 存储端只存 base64 段、还原端硬编码 `image/png`
  → 改存完整 data URL，jpeg/webp MIME 不再损坏（旧存量按 png 前缀兼容）。
  新增 image-store 纯函数单测 ×5。附件系统 v1（R2）仍是根治方向。

### UI 专项：定稿并开工阶段 1（同日第三落）

四条方向性决定已用高保真原型逐屏确认，写进 `ui-optimization.md` §2：
**主色蓝 #2563EB / 玻璃保留并默认开启（设置可关）/ 首屏概览替代空白 / 两栏 = 导航轨常驻树 + 舞台三态**。
布局经四轮修订才收敛：三栏 → 两栏把导航藏进下拉 → 树常驻但降为无容器的轨道 → 列表与正文合并为舞台。

阶段 1「地基」已落地部分：

| 项                     | 落点                                                                                                  | 说明                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.2 / 1.3 token 生成器 | `shared/src/theme-engine.ts`、`shared/src/theme-seeds.ts`                                             | 98 个手写色值收敛为种子表 + 32 个派生语义 token；纯函数、无依赖、四端共用。遗留 7 键逐字节透传（有测试锁定），所以接入后界面不变 |
| 对比度改为构造保证     | 同文件的 `ensureContrast()` / `walkToward()`                                                          | 文字色与状态色对每一层承载面取最差值、自动推到达标；新增 `accent-strong`（主按钮底）与 `accent-text`（强调色当文字用）两档       |
| web 接入               | `web/src/lib/theme.ts`（不再持有任何色值）、`web/src/index.css`、`web/tailwind.config.js`             | 顺带修掉切主题后上一套玻璃变量残留在 :root 的 bug                                                                                |
| 1.1 图标层             | `web/src/components/Icon.tsx`（lucide 封装：语义名 + 五档尺寸 + currentColor）、`docs/ui-icon-map.md` | 顶栏 5 个 emoji 已迁移作为参考实现；映射表按 A/B/C/D 分类，B 类（i18n 串里内嵌 emoji）必须先拆文案再换图标                       |
| 1.5 排版尺度           | `--mn-text-*` / `--mn-space-*` / `--mn-measure: 68ch` + `max-w-measure`                               | 密度同时改字号 + 行高 + 间距（此前只改行高，切换几乎无感）                                                                       |
| 步骤 0 视觉基线        | `e2e/visual-baseline.spec.ts`、`e2e/a11y-contrast.ts`                                                 | 4 屏 × 明暗两态；纯色底 AA 硬失败，玻璃最坏情况记账不阻塞                                                                        |

这套门禁当场抓到的真实缺陷（都不是本次引入的，是一直存在但没人能看见）：

1. 浅色主按钮「新建笔记」白字对 #3B82F6 只有 **3.68:1** → 已由 `accent-strong` 修掉。
2. 强调色直接当文字用（链接、标签、分区标题）**7 处 3.27–3.68:1** → 已由 `accent-text` 修掉。
3. `dark:bg-mint-900/30`、`bg-mint-900/40` 这类写法**一直静默失效**：`index.css` 的影子类只匹配裸类名，
   带 `dark:` / `hover:` 变体的匹配不上，而 `mint.800` / `mint.900` 在 `tailwind.config.js` 里根本没定义
   → 暗色下的强调色底纹成片缺失（约 15 处调用点）。现在 config 补齐 50–900 全标度并映射到语义变量，
   同时把该陷阱写进 `index.css` 注释防复发。
4. `--mn-fg-muted` 在樱粉浅色主题的页面底上只有 **4.41:1**（在卡片上 4.60 达标）→ 生成器改为按最差承载面
   判定，这类只按 card 算的漏网被构造性排除。
5. 玻璃叠暗色遮罩的最坏情况仍有 **56 处**不足 AA（设置弹窗最多）→ 属阶段 3 的玻璃三档规矩，
   数量进报告作为可下降指标，不靠放宽阈值蒙过去。

阶段 1 已全部完成（含原计划推迟的 1.4）：

- **1.4 影子类清除**：339 处 `mint-*` 调用点按「当文字用 → `accent-text`、当底色用 → `accent-strong`」
  一次性 codemod 迁移；`index.css` 桥接段与 `tailwind.config.js` 的 `mint` 标度删除；
  语义色表提到 `shared/tailwind-colors.mjs`、静态令牌提到 `shared/styles/tokens.css`，
  web 与 desktop 共用同一份（desktop 复用 web 组件，本来就不允许两套色名）。
  **迁移后 e2e 对比度与截图零回归**（纯色底失败 0、玻璃最坏情况仍为 56）。
- **`ARCH-R01` 关闭**：mobile 的 98 个手抄 hex 全部改由引擎派生（`paletteFor()`），
  小程序的 30 个手写色值改由 `scripts/gen-mp-tokens.mjs` 从种子生成 `theme-tokens.scss`，
  并在 CI 加 `pnpm tokens:check` 防漂移。迁移前后差值有测试锁定（12 个主题×模式组合逐字节一致），
  唯一被纠正的是本来就该纠正的漂移，见 `ui-optimization.md` §2.3。
- 新增缺陷 6：`toHex()` 解析 `'255 255 255 / 0.5'` 时按空白拆分会把 `/` 当成分量，
  alpha 被算成 0 → 输出 `#ffffff00`。由新写的 hex 往返测试抓到并修复。

阶段 1 有意未做（理由见 `ui-optimization.md` §5）：

- B 类 emoji 拆分（`⚡ 分屏`、`👁 预览` 等在 i18n 串里）：牵动三端词典与 `check-i18n` 键表，
  与阶段 2 的文案改动一起做更划算。
- 舞台三态的实际布局改造（2.8）：地基已稳，下一步才动骨架。

### 同日第四落：1.1 机制 + 2.8 首块 + 小程序类名去历史化

**1.1 B 类（i18n 串里内嵌 emoji）拆出机制**：`components/Icon.tsx` 新增 `LABEL_ICON`（i18n key → 图标名）
与 `<IconText k label />`，词典只留文字、图标由这张表提供。已迁移编辑器视图切换（编辑 / 分屏 / 预览 /
所见即所得）与侧栏批量操作（移动 / 置顶 / 取消 / 收藏 / 恢复 / 彻底删除 / 删除 / 退出选择）——
zh + en 共 18 条文案去掉前导 emoji。

**棘轮而不是硬清零**：`scripts/check-i18n.mjs` 新增第 5 节，统计三端词典里以 emoji 开头的标签串
（当前 **310 条**：web 118 / mobile 46+46 / 小程序 51+49），写死为上限，**只许减少不许增加**。
一次性清 310 条要动三端词典与全部渲染点，风险远高于收益；但绝不允许新增 —— 这条规则上线当轮
就抓到我自己写的未定义 key（`common.untitled`）。

**顺带修掉一个测试工具的坑**：`web/src/test/render.tsx` 的 `getByText` 在没有纯文本叶子时
按文档序返回匹配，于是按钮里一放 `<svg>` 图标，查询就退到外层 dialog div，点击静默失效。
改为取"最内层匹配"（与 @testing-library 行为一致）。**不修这个，后续每次图标迁移都会踩一遍。**

**2.8 首块：概览态落地**。`web/src/components/Overview.tsx` 替代原先"整屏空白 + 一个 📝"，
含统计（笔记 / 收藏 / 标签，只数未删除）、最近编辑 5 条（倒序、排除回收站、点击打开）、
快捷操作与快捷键提示。跨组件动作走 App 已有的 `app:new-note` / `app:import-export` /
`app:open-shares` 事件，不为此把 state 往下钻。5 个组件测试钉住行为（e2e 的 setupStandalone
会自动打开一篇笔记，覆盖不到"未选中"这一态，所以必须有单测）。

**小程序类名去历史化**：`mint-btn / mint-card / mint-input / mint-textarea` 等 13 个类名
（145 处，含 app.scss 与 15 个页面）改为 `btn / card / input / textarea` 及修饰符；
`BatchBtn` 的 `variant="mint"` 一并改为 `variant="accent"`。这些是小程序自己的 BEM 类名，
与 Tailwind 影子类无关，但名字一直在误导。产物已验证：`app.wxss` 里 0 个 `mint-`、新类名齐全。

**验证**：typecheck 10/10、lint 6/6、测试 459 全绿（shared 121 / client-core 79 / server 115 /
web 113 / mobile 31）、web 与小程序构建通过、e2e 基线 4 passed（纯色底 AA 失败 0、玻璃最坏 56 不变）、
`format:check` 全仓通过、`tokens:check` 通过。

### 同日第五落：2.8 契约层 + 1.1 棘轮继续推进

**1.1 继续清**：再迁移 20 个 key × 中英 = **40 条**常驻界面标签（设置里的检查更新 / 安装为桌面应用 /
服务器地址，错误页三个按钮，分享管理标题与批量吊销，部署管理三个 tab 与保存/下载，迁移向导导入导出，
回收站只读徽章，未分类），`Icon.tsx` 补 `device / save / rotate` 三个语义图标。
`check-i18n` 棘轮上限随之从 **310 降到 270**。
剩下的 270 条绝大多数是 `✅ 已保存` 这类**瞬时提示**，它们的风险不在"换图标"而在"去掉后状态提示变弱"，
要连着 toast 的样式一起看，所以留给后续按棘轮逐步清，不硬凑数字。

**2.8 契约层落地**：`web/src/lib/stage.ts` 舞台状态机（纯函数 + 12 个测试）+ `Stage.tsx` 路由与
`Esc` 逐级回退（8 个测试）+ `searchQuery` 从 Sidebar 局部 state 提到 store。
`App.tsx` 不再直接渲染 `Editor`，改由舞台决定。

**明确没做**：把笔记列表从 `Sidebar` 的文件夹树里搬进舞台。这是 2.8 最后一块，
也是唯一需要**盯着运行中的应用**改的地方 —— 树里嵌着笔记叶子、批量选择、拖拽、右键菜单，
盲改 1595 行组件的风险高于收益。`list` / `search` 两态的契约与测试已就位，
列表一搬进来就是接上而不是重写。

**验证**：typecheck 10/10、lint 6/6、测试 **479** 全绿（shared 121 / client-core 79 / server 115 /
web 133 / mobile 31）、web 构建通过、e2e 基线 4 passed（纯色底 AA 失败 0）、`format:check` 全仓通过、
i18n 棘轮 270/270。

### 同日第六落：2.8 收口（列表进舞台）+ 瞬时提示 emoji 清零一批

**2.8 最后一块：笔记列表搬进舞台，四态全部接线。**

- `web/src/components/NoteList.tsx`（498 行）= 舞台的 `list` / `search` 态。
  笔记原先只以"文件夹树的叶子"存在，两栏改造后树只放导航，笔记统一在这里出现：
  标题 + 摘要 + 时间 + 标签的富信息行、批量条、右键菜单、重命名、移动、确认、渐进加载。
- `web/src/lib/note-scope.ts`（321 行）把「范围 / 排序 / 搜索索引 / 批量选择 / 移动 / 确认」
  从 Sidebar 收拢成唯一来源；`Sidebar.tsx` **1660 → 987 行**，只剩导航。
- **目的地模型**：`ViewMode` 增加 `'overview'` 并作为默认值。改前"冷启动"与"点了全部笔记"
  在 store 里是同一个状态，列表态没有稳定入口（上一轮截图看到的"列表态其实是概览"就是这个）——
  缺的是一个 bit 的事实，靠 `hasScope` 猜不出来。
- **优先级反转为 `detail > search`**：两栏合并后点开一条命中必须看到正文，否则结果列表会把它弹回去。
  配套 `setSearchQuery`：查询变非空时退出详情（"开始搜索 = 离开正文"），点开命中则保留查询词。
- **结果集活过卸载**：`stageOrder` 进 store（唯一写者 note-scope），详情态的 `StageHead`
  据此显示 `‹ 3/11 ›`，`←/→` 与按钮走同一个 `stepInSet`，**到边界停住不循环**。
- `StageHead` = §2.1 设计的 stagehead：返回目的地 + 文件夹链面包屑 + 位置 + Esc 提示。
- `main` 归一：舞台与 Editor 不再各写 `<main id="main-content">`（原先嵌套 main + 重复 id）。
- Esc 契约 `nextOnEscape` / `scopeBack`：详情 → 命中/列表 → 根列表 → 概览，
  **根列表与概览是终点**（在「全部笔记」按 Esc 跳到统计页只会让人觉得点坏了）。

**发现（待你定）**：全新单机空间会自动创建并打开欢迎笔记，所以"首屏"实际落在详情而非概览。
"未选中笔记时显示概览"这条决策本身没被违背，但零笔记用户看不到概览。要不要让首启不落正文，
是产品口径问题，没有替你改。

**1.1/2.x 文案：瞬时提示类 emoji 一批清零，棘轮 270 → 194。**

- 剥掉 76 条（值 = 语言数 × key 数）：web 29 key × 中英、mobile 5 × 2、miniprogram 4 × 2。
  范围只圈**瞬时提示**（toast / 状态条 / 一次性确认），不碰常驻标签。
- 依据：ToastContainer 本来就按 kind 渲染图标 + 底色，文案里的 `✅` 是叠在上面的第二个图标；
  三端状态条的**词**本身已经表意（保存中 / 已保存 / 解密失败 / 保存失败），`✅`/`❌` 不携带额外信息。
- 补偿（不然就是降级）：mobile 的"解密失败 / 已离线"改由 `danger` / `warn` 色承担，
  小程序"保存失败"加 `.save-indicator--error`；web toast 的 `✓ ⚠ ℹ` 文本符号换成 `<Icon>`
  （文本符号不吃 `currentColor`，暗色下会灰到看不见）。Editor 的 `✅ 已加密保存` 换成 §2.1 指定的
  `shield-check`。另有三处写在 JSX 里的 `✅`（门禁统计不到它们，但同样是瞬时提示）一并清掉。
- 剩下 194 条是常驻标签 / 徽章 / 章节标题类（`📥📤 导入导出`、`🔐 密码` 徽章、
  `👁 访问数`、`📱🔧` 管理面板小标题），要跟 2.1/2.6 的换图标批次一起做才划算。

**新门禁：web 词典中英对称**（此前只门禁 mobile / 小程序，web 反而没人管）。
上线即抓到三件事：解析器不容忍块注释（把注释后的第一条真实 key 吃掉 → 假报警，修解析器）、
一个只有 zh 有的死 key `notes`（全仓无 `t('notes')`，删）。现在 zh/en 各 638 key 对称。

**顺带**：`format:check` 的 glob 补 `mjs`/`mts`（门禁一直扫不到自己用的脚本，4 个脚本首次被格式化）；
两端 `index.css` 的 `@import tokens.css` 移到 `@tailwind` 之前（postcss 一直在告 `@import must precede`，
顺序错了这份 import 在某些打包路径下会被直接丢掉）。

**验证**：typecheck 10/10、lint 6/6、单测 **494** 全绿（shared 121 / client-core 79 / server 115 /
web 148 / mobile 31）、**e2e 11 passed**（视觉基线 5 含新增「舞台三态」链路 + 其余 6）、
纯色底 AA 失败 0（玻璃最坏情况 37/7/6 记账，阶段 3）、`format:check` 全仓通过、`tokens:check` 通过、
i18n：532 个使用 key 全定义 + 中英对称 + 棘轮 194/194。

### 同日第七落：2.1 阅读纸张 + 工具栏三段式 · 阶段 3 玻璃三档与极光

**首启口径先定下来**：全新空间自动创建并打开欢迎笔记 —— **保留**（概览仍是"未选中笔记"的落点）。

**① §2.1 详情态骨架落地**（`web/src/components/Editor.tsx`）

- **工具栏三段式**：左 = 视图模式 segmented（选中实底）· 中 = Markdown 格式工具，
  **只在编辑 / 分屏出现** · 右 = 状态（`shield-check` + 已加密保存，12px 次要色）
  - 4 个常驻动作（置顶 / 收藏 / 移动 / 分享）+ `⋯` 溢出（历史 / 存为模板 / 剪贴板插入 / 删除标 danger）。
    原先 13 个按钮全平铺、主次不分（§1 U-6），图标全是写在 JSX 里的 emoji。
- **行内 emoji 清零一批**：` ❝ </> 📌 ⭐ 📁 🔗 📜  📎 ️ ↩️` 全改 `<Icon>`；
  这些**不在 i18n 棘轮口径里**（写在组件里），所以顺手把 121 处硬编码状态色
  （`text-red-600 dark:text-red-400` 这类）也换成语义令牌 —— 它们同样绕开了引擎的 AA 保证。
- **阅读纸张**：`.paper-sheet` = `68ch + 88px` 落 `glass-2`；分屏 `2 × 46ch` 且内边距对半；
  <1024 铺满、内边距 20px。正文区自己那层 `p-6` 去掉（纸张已给边距）。
- 导航轨按设计收到 **216px**；目的地四按钮在该宽度下横排压字，改 2×2 网格。

**② 阶段 3 玻璃三档 + 极光默认值**（§2.2 已改写为实况）

- 材质与主题**解耦**：`html[data-effect='glass'|'flat']` + `.glass-1` / `.glass-2` 按角色挂，
  弹窗按 `role="dialog"` 统一。原来 160 行玻璃 CSS 挂在 `data-theme='liquid-glass'` 上、
  把 `.bg-surface-card` / `input` / 滚动条全改半透明 —— 已从 `web/src/index.css` 删掉，
  材质层整体进 `shared/styles/tokens.css`（web 与桌面端共用一份）。
- **极光默认从"吃满"降到 .5（柔和）**，并给四档乘数（关 / 柔和 / 标准 / 浓郁）+ 设置页开关。
- **引擎把玻璃算进最差承载面**：`surfaces` 原先只有实心四层，导致"实心卡 AA、玻璃上掉档"
  （实测暗色弹窗 `退出登录` 3.04:1）。现在压入两档玻璃的最差情况，七套主题同时受益。
- 两条退路：`prefers-reduced-transparency` 与不支持 `backdrop-filter` 的引擎 → 停极光、面板回实色。
- 状态色**一直是哑的**：色表把状态色嵌在 `state` 下（类名应为 `text-state-danger`），
  而全仓写 `text-danger` / `bg-danger-soft` → Tailwind 生成不出规则。已拉平（`state-*` 零使用）。

**度量口径两处修正**（先确认量具没瞎，再看数字变好）

- 极光从 `body` 的 background 挪到 `body::before` 后，审计器沿 `parentElement` 走**看不见伪元素**，
  `glassWorstCase` 会假性归零 → `e2e/a11y-contrast.ts` 显式读取伪元素渐变并计入最坏情况。
- `out.unresolved += 1` 是笔误（对象上没这字段，样本数恒为 0；e2e 目录不在任何 tsconfig 里所以类型检查抓不到）→ 改回 `out.overGradient`。
- 修正后实测：**148 个文字样本按极光最坏情况判定，失败 0**（上一版 105 处失败）。

**顺带**：35 处主按钮 `hover:bg-accent-strong/90` 会让底色**变浅**、白字掉到 3.90:1
（悬停正是用户在读标签的时刻）→ 统一改 `hover:bg-accent-active`（压暗，白字 5.5:1）。

**验证**：typecheck 10/10、lint 6/6、单测 **494 → 500**（web 154 含新增 effect 6 例 / shared 121 /
server 115 / client-core 79 / mobile 31）、**e2e 11 passed**、纯色底失败 0、玻璃最坏失败 0（样本 148）、
`format:check` 全仓通过、`tokens:check` 通过（引擎改动后小程序令牌已重新生成）、i18n 542 使用 key 全定义 + 中英对称 651 + emoji 棘轮 194/194。

### 同日第八落：阶段 2 余项 + 阶段 3 断点/拖拽全部收口（含 8 个新发现的缺陷）

用户口径："把所有的未做都处理完"。落点见 `docs/ui-optimization.md` §2.9（那张表也写了**仍然没做**的部分）。

**做了什么**

- **2.1 工具栏三段式 + 阅读纸张**（上一落）· **2.3 弹窗规范**：新增 `components/Modal.tsx`
  （遮罩 `black/55` + 模糊、面板 `radius-xl` + `shadow-2xl` + `max-h-[72vh]` 内滚、标题 20/600、
  关闭键带无障碍名），AboutDialog / Cheatsheet / ImportExportDialog 迁入，其余弹窗就地按规格改。
- **2.4 空状态四态**：新增 `components/EmptyState.tsx`（first-use / no-results / empty-scope / plain），
  文案随断点换（窄屏不提 Ctrl N）。
- **2.6 主题真实配色预览**：新增 `components/ThemeCard.tsx` —— accent 圆点 + 明暗两套"底/卡/文字"色带，
  选中态 2px 边框 + 右上 Check 徽标；移动端 `SettingsScreen` 同一套；两端 `THEMES[].emoji` 字段随之删除。
  主题名也进了词典（原先是硬编码中文，英文用户看到"尘心晨光"）。
- **2.7 小程序专项**：卡片双层描边删除、双 FAB 合并为"主 FAB + 工具条模板入口"、时间戳与 web 同源、
  暗色次要文字走 AA 档。
- **断点**：1024–1279 收成 **56px 图标轨**（`.rail-label` 隐藏、搜索与新建收成一枚图标按钮、`title` 兜 tooltip），
  <1024 转导航抽屉（阈值从 `sm` 提到 `lg`）。
- **拖拽投放**：列表行 `draggable` → 导航轨文件夹/未分类行接住，悬停行亮起；`dragNoteId` 放 store，不靠事件总线。
- **引擎补「实心状态底」**：`{success,warning,danger,info}-solid` + `on-*-solid` + `*-solid-hover`
  （保住色相后在"压暗配白字/提亮配墨字"里取改动小的一条），`auditContrast` 一并验；
  另加 `accent-strong-hover`（只会更深，白字对比度只升不降）。13 处硬编码 `bg-red-600`/`bg-emerald-600` 类换掉。

**新发现的 8 个缺陷（都不是"顺手美化"，前 4 个是四端同源被绕开）**

1. **小程序 app.scss 手写覆盖了 14 个暗色令牌 + 4 个亮色令牌**，把生成器的产物整段推翻 ——
   阶段 1 建的"单一真相源"在小程序端其实是摆设。现在 `--bg-elevated/--bg-sunken/--border/--primary-glow`
   全部进 `VAR_MAP` 派生，`app.scss` 已无一处硬编码色值。
2. **卡片双层描边**：基础 `.card` 已有 `1rpx var(--border)`，文件末尾又给同一批类叠一条白描边 + 内高光 —— 同一条边画两次。
3. **`--border` 直接发种子值 = 纯白**：`liquid-glass` 种子里 border 就是 `255 255 255`（玻璃高光的语义），
   发给小程序就是"白卡上的白描边"，彻底看不见；改发 `glass-line`（分隔那一档）才对。
4. **时间戳三端 19 处各写一套**，其中 6 处写死 `'zh-CN'`（英文用户看到中文日期），小程序还把秒也带上。
   现在 `shared/src/time-format.ts` 一份实现（不用 Intl —— 小程序运行时没有它），三端同一形状。
5. **状态色类名一直是哑的**：色表把状态色嵌在 `state` 下（类名应为 `text-state-danger`），全仓写的却是
   `text-danger` / `bg-danger-soft` → Tailwind 生成不出规则，11 处危险/警告色从来没生效。已拉平。
6. **35 处主按钮 hover 反而变浅**（`hover:bg-accent-strong/90` = 叠 10% 白）：白字掉到 3.90:1，
   而悬停正是用户在读标签。统一换成新令牌 `accent-strong-hover`（更深，5.5:1）。
7. **我自己造成的回归**：把导航轨的小标签从 `surface-muted` 改成 `text-tertiary`，而 tertiary 是引擎的
   **3:1 档** —— 11px 标签按 WCAG 需要 4.5，实测算出 4.34:1 被门禁拦下。改回 `text-secondary`。
8. **一个工具性 bug**：某次批量脚本的 `rep()` 助手只改内存、漏了落盘，于是 `data-rail` 与 `lg:` 抽屉阈值
   **从未真正写进文件**，脚本却打印了 "ok"。靠 e2e 的 `toBeHidden()` 断言才暴露。教训：批量改写后要读回文件核对。

**验证**：typecheck 10/10、lint 6/6、单测 **502** 全绿（web 157 / shared 121 / server 115 / client-core 79 / mobile 31）、
**e2e 14 passed**（视觉基线 8：新增图标轨 1120 / 空搜索结果 / 主题卡与材质档位三个用例）、
对比度 **530 个文字样本，纯色底失败 0，玻璃最坏情况样本 155 失败 0**、
`format:check` 全仓通过、`tokens:check` 通过（小程序令牌 22 个 × 2 模式）、
i18n：557 使用 key 全定义 · web 中英对称 674 · mobile 469 · 小程序 447 · emoji 棘轮 194/194。

### 同日第九落：UI 未做项清零（阶段 2 余项 · 阶段 3 断点/跨端 · emoji 归零）

用户口径："全部处理，不要给我留"。§2.9 那张表现在没有"没做的"那一栏了（改成"边界"）。

**1. i18n 内嵌 emoji：194 → 0，棘轮转为硬规则**

- 三端词典 206 条值剥净（`web 20 / mobile 82 / 小程序 92` 行），`EMOJI_LABEL_CEILING = 0`，
  门禁文案从"只减不增"改成"一条都不许再加"。
- 剥完发现 **20 个键整条值就是 emoji**，剥出来是空串——那是"按钮渲染出空白"的缺陷，逐个补：
  mobile 的 `editor.back/delete/share/templates/history/move` 补成真文字，同时删掉菜单里
  `📁 {t('editor.move')}` 的 JSX 侧 emoji（**以前是双份 emoji 并排**）；
  `notes.empty_emoji / error_emoji / locked_badge`、web 的 `settings.command_palette`
  是**全仓零引用的死键**，删；`shares.empty_icon` 删键并改渲染 `<Icon name="archive">`。
- 承载信息的位子在剥的同时补了图标：警告段落 `warning`、返回 `arrow-left`、密码徽章 `lock`、
  访问数 `preview`、部署管理三个小标题 `warning/device/code-block`。
- 图标尺寸不破例：徽章想用小一号的图标，答案是回到 14px 那一档，而不是给 `Icon` 开第 6 档。

**2. 断点与拖拽（§2.1 最后两块）**

- 1024–1279 收成 **56px 图标轨**：`.rail-label` 隐藏、搜索与新建收成一枚图标按钮、`title` 兜 tooltip；
  <1024 转导航抽屉（阈值 `sm`→`lg`）。
- **标签入口**：图标轨档放不下 chips，改成一枚标签按钮点开浮层（四种主题取值都带得上 `material-flat` 同理）。
- **拖拽投放**：列表行 `draggable` → 导航轨文件夹/未分类行接住，悬停行亮起。
- **滚动位置**：`NoteList` 用模块级 `Map<scopeKey, scrollTop>` 记忆——组件在详情态会卸载，
  存在组件里就失忆；也不进 store，视图记忆不该让订阅者重渲染。

**3. 材质开关跨端（§2.2 的"设置里可关"三端都通了）**

- web/桌面：`html[data-effect]` + `--mn-aurora` 乘数（上一落）。
- 移动端：`paletteFor(id, mode, material)` 关掉 RN 叠色 alpha，`GlassScreen` 在 flat 档不画极光，
  设置页加材质档；持久化到 AsyncStorage。
- 小程序：`useThemeStore.material` + 根类 `material-flat`（极光层 `display:none`、卡片回 `--card-solid`
  不透明值，后者进 `VAR_MAP` 由种子派生）。

**4. PublicShareView 不再是硬编码色岛**：17 处 slate/white 全换语义令牌，跟着主题与 AA 保证走。

**5. 小程序 lint 脚本（P0-6 余下）**：`miniprogram` 加 `lint` 脚本，turbo 从 6 个任务变 **7 个**。
首跑 20 条 warning，全部清零——其中一条不是 lint 噪音而是真 bug：
**批量删除/恢复/彻底删除/移动都算了 `fail` 却从不上报**，用户看到"已删除 3 条"时无失败提示。
现在 `fail > 0` 改口播报"完成 N 条，失败 M 条"；`share-mgr` 的 `batchBusy` 也真正接上禁用态
（原来批量吊销可以连点两下并发发两轮请求）。

**验证**：typecheck 10/10、lint **7/7**、单测 **502** 全绿、**e2e 14 passed**、
对比度 530 样本 · 纯色底失败 0 · 玻璃最坏情况 155 样本失败 0、
`format:check` 通过、`tokens:check` 通过（23 变量 × 2 模式）、
i18n：556 使用 key 全定义 · web 673 / mobile 469 / 小程序 447 对称 · **emoji 0/0**。

### 同日第十落：TEST-004 两端补齐 + P0-1 地址与状态页解耦 + P0-2 投递可证明

**1. TEST-004：desktop 与 miniprogram 从 `[skip]` 到有测试**

两端各建 vitest 基建，沿用 mobile 的口径：**只 mock 平台 I/O 边界，业务逻辑跑真身**。

- desktop（29 例）：`test/mocks/` 替掉 `@tauri-apps/api/{core,event}`、autostart、notification、
  以及 `@dustnote/web/i18n`。用例盯三类"错了不报错、只是静默走错分支"的东西：
  环境判断（`__TAURI_INTERNALS__` 决定 API 基址）、设备 id 稳定性、
  **`invokeWithTimeout` 在 Rust 不回话时按 `IPC timeout: <cmd>` 失败**（带上命令名，否则线上只看到一句 timeout）。
  更新链路另建 18 例，钉住审计 PLAT-001 的两条不变量：**白名单不得包含待校验 URL 自己的 origin**、
  **缺 SHA-256 必须拒下载并把空校验值挡在 IPC 之前**；另测版本比较 7 组、origin 归一化（`:443` 书写差异）、
  非 http(s) 的 serverUrl 不得污染白名单。
- miniprogram（42 例）：mock `@tarojs/taro`（存储/交互/事件总线）。
  用例覆盖 `parseServerDate`（iOS/JSC 对 SQLite 空格分隔串给 Invalid Date 的回归）、
  明文缓存（密文为键的失效语义 + LRU 上限 + 不落盘）、
  离线队列（`isNetworkError` 五类判定 + 真落 Taro 存储 + 存储写坏时安全回落 + 跨页单例）、
  搜索索引（中文二元组分词 + 标题>标签>内容 + `rebuild` 是替换而非追加）、
  主题与材质（`rootClassOf` 六种组合都要带 `material-flat`）。
- **过程中把两处实现缺陷修掉了，不是改测试绕过去**：
  `isNetworkError(null)` 会抛 TypeError（`Promise.reject()` 不带原因时就是 undefined）→ 两端补守卫；
  状态页测试最初复刻了一份类名拼接逻辑（那等于保护副本）→ 把 `rootClassOf` 下沉成真函数，测试打真身。
- mock 的存储改挂 `globalThis`：`vi.resetModules()` 会连 mock 一起重建，
  否则"冷启动后队列还在"这类断言永远测不到（第一版就是这么失败的）。

**2. P0-1：地址统一 + 状态页与发版动作解耦**

- 小程序引导地址 `http://154.217.234.125:8080` → **`https://napi.iniess.cn`**。
  裸 IP + 明文 HTTP 在 weapp 正式版根本过不了审核（request 需 HTTPS 白名单域），
  且让"E2EE"暴露在地址可被中间人改写的位置。审计 `PLAT-004` 的同一项，此前只改了文档没改代码。
- README 补官方 Web 端地址（原先只说"或直接访问部署好的 Web 端"，没有链接）。
- **`bump-version.mjs` 不再写状态页的"线上版本"和"最近人工核对：<今天>"** ——
  那是"没探测就把状态页刷绿"（历史上出现过页头 🔴 而组件表全 🟢 的自相矛盾）。
  发版只允许归一「客户端渠道表」（那是"我们发布了什么"的事实）。
- 反过来，`status-probe.mjs` 现在**生成整段状态**（`<!-- status-probe:start/end -->`）：
  banner + 探测项表格（health / update-manifest / web / share-api / 明文收口），
  线上版本取自 health 实际响应。新增 `share-api` 探测：原先打 `/s/<token>` 是 SPA 外壳，
  任何路径都回 200，等于什么都没测；改打 `/api/v1/share/public/<假 token>`，404 才证明路由活着。
  本次实测：线上 v2.5.45 = 期望，四项全绿，明文仍可服务（R1 待办，informational 不判红）。
- 状态页新增「拨测不覆盖的部分」一节：WebSocket 同步、`/metrics`、小程序发布、备份可恢复性
  **不在页上声明状态**——没人验证过就是猜测。
- 顺带清掉三处占位域名 `dustnote.app`（审计确认过它是无真实服务的占位）：
  **`ForceUpdateOverlay` 的兜底 URL**（强制升级时把用户送去死站 → 改回本机 origin，拿不到就不给链接）、
  `CODE_OF_CONDUCT.md` 的举报邮箱、`mobile/README.md` 的自托管说明（该处说明还写错了机制，已按代码改正）。
  并删除无引用的 `scripts/cleanup-docs.js`——它把 `mintnote.app` 映射成 `dustnote.app`，留着就是复播风险。

**3. P0-2：告警投递从"配置接好了"变成"可证明"**

链路的失败模式是静默的：bridge 无论 ntfy 成败都回 `{"ok":true}`，Alertmanager 认为已送达、
永不重试 —— topic 填错或 ntfy 不可达时，"有告警系统"悄悄变成"没有告警系统"。

- `bridge.mjs`：数着送达条数，**一条都没推出去就回 502**（让 Alertmanager 按自己的策略重试）；
  `GET /stats` 暴露 `received/published/failed/lastError`；`toNtfyMessages` 抽成纯函数导出。
- `bridge.test.mjs`（9 例，`pnpm test:monitoring`，已进 CI 的 lint job）：critical→priority 5、
  resolved→3、缺 annotations 不产出 "undefined" 文案、畸形载荷不炸、超长 description 截断、
  **全失败必须报零送达**、部分成功如实报数、空批次不算失败。
- `alert-drill.sh`：新增 `--smoke`（投一条合成告警走完整链路，**不动主栈**，日常用这个）；
  全量演练多一步「核对最后一跳」——比对 bridge `published` 增量，
  `DRILL_PASS` 现在要求 firing + 恢复 + **最后一跳已送达** 三者齐，不再靠人看手机。

**验证**：typecheck 10/10、lint 7/7、单测 **574** 全绿
（web 157 / shared 121 / server 115 / **miniprogram 42** / **desktop 29** / client-core 79 / mobile 31）、
`pnpm test:monitoring` 9 例通过、真实拨测通过（线上 v2.5.45）、`format:check` 通过、
i18n 556 使用 key 全定义 + 三端词典对称 + emoji 0/0、`bash -n` 演练脚本语法通过。

### 仍待办（下一轮起点）

UI 这条线（阶段 1 / 2 / 3 的可量化部分）与 P0-1、P0-2、P0-6、TEST-004 均已收口。剩下的：

1. **R1 供应链 / 签名 / 备案** —— 需要外部资源：代码签名证书、应用商店与推送的开发者账号、
   ICP 备案主体。不是能在这台机器上做完的事。
2. **R1 强制 HTTPS 收口**：拨测已把"明文仍可服务"记为 informational（不判红），
   收口动作（80/8080 → 301 到 443）在服务器侧，做完后把探针该项转为硬断言。
3. **阶段 3 的"打磨类"**：三态一致、动效 token、微排版。没有可量化口径，
   做法是每次改完看实机截图；已记在 `docs/ui-optimization.md` §2.9「边界」。
4. **图标轨档（56px）读标签名**：浮层已能用，但形态还可以更好（同上，属打磨）。
5. 备份**可恢复性**演练：`docs/operations-runbook.md` 有人工步骤，但没有自动化断言；
   状态页现在明确不声明它（见「拨测不覆盖的部分」）。
