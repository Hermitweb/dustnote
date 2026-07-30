# DustNote 生产就绪审计报告

> 审计时间：2026-07-30
> 当前版本：v2.1.3（即将发布 v2.2.0）
> 审计基准：[docs/production-checklist.md](./production-checklist.md)、[.trae/documents/roadmap.md](../.trae/documents/roadmap.md)、[CHANGELOG.md](../CHANGELOG.md)
> 审计视角：可上线生产产品

---

## 一、开发进度对比

### 1.1 里程碑完成度（roadmap.md）

| 里程碑 | 版本 | 主题 | 状态 |
| --- | --- | --- | --- |
| M0 | v0.1.0 | 项目骨架 | ✅ |
| M1 | v1.0.0 | Web 端 MVP | ✅ |
| M2 | v1.1.0 | 导入导出 | ✅ |
| M3 | v1.2.0 | 分享 | ✅ |
| M4 | v1.3.0 | 桌面端 Tauri | ✅ |
| M5 | v1.4.0 | Android RN | ✅ |
| M6 | v1.5.0 | 小程序 Taro | ✅ |
| M7 | v1.6.0 | 完善（E2EE/i18n/可访问性） | ✅ |
| M8 | v2.0.0 | 双模式架构 | ✅ |
| — | v2.1.0 | 生产就绪补强（8 项 P1） | ✅ |
| — | v2.1.1 / v2.1.2 / v2.1.3 | 安全加固 / Android 修复迭代 | ✅ |
| — | v2.2.0 | 本次发布：GDPR + 设备管理 + Nginx 加固 | ⏳ 进行中 |

**整体进度**：M0\~M8 + v2.1.0 + v2.1.1\~v2.1.3 共 11 个里程碑全部完成，与文档 100% 一致。

### 1.2 本次会话已落地修补

| 修补项 | 文件 | 类别 |
| --- | --- | --- |
| GDPR Article 17 账户删除 | `server/src/routes/account.ts` | 合规/功能 |
| GDPR Article 20 数据导出 | `server/src/routes/account.ts` | 合规/功能 |
| 设备管理 API（列表/吊销/登出其他） | `server/src/routes/devices.ts` | 安全/功能 |
| Nginx 安全头（HSTS/CSP/X-Frame/Permissions-Policy） | `deploy/nginx.conf` | 安全 |
| Nginx 速率限制（API 20r/s + burst 30） | `deploy/nginx.conf` | 安全 |
| Nginx TLS 1.3 only + SSL 配置 | `deploy/nginx.conf` | 安全 |
| ForceUpdateOverlay i18n 化 | `web/src/components/ForceUpdateOverlay.tsx` | 界面/i18n |
| i18n key 补齐（force_update/banner_subtitle/loading） | `web/src/lib/i18n.ts` | 界面/i18n |
| 路由挂载（devicesRouter / accountRouter） | `server/src/app.ts` | 框架 |

### 1.3 production-checklist.md 完成度

| 章节 | 总项 | 已完成 | 待补齐 |
| --- | --- | --- | --- |
| §0 文档自检 | 8 | 5 | 3（user-guide 截图、self-hosting 跑通、faq 覆盖） |
| §1 合规与法务 | 7 | 7 | 0 ✅ |
| §2 代码质量 | 7 | 6 | 1（关键路径 E2E 测试覆盖 100%） |
| §3 安全 | 16 | 12 | 4（SBOM、渗透测试、备份恢复演练、日志脱敏中间件待验证） |
| §4 性能 | 9 | 0 | 9（未做 Lighthouse 与压力测试） |
| §5 功能验证 | 19 | 17 | 2（设备管理 UI、多端实时同步） |
| §6 兼容性 | 5 | 3 | 2（iOS、macOS/Linux 真机） |
| §7 部署 | 14 | 7 | 7（域名/证书/状态页/告警/异地备份） |
| §8 监控与告警 | 8 | 0 | 8（Prometheus/Grafana/PagerDuty 未接入） |
| §9 用户支持 | 7 | 5 | 2（On-call 值班表、邮件自动回复） |
| §10 上线决策 | 4 | 0 | 4（四角色签字） |
| §11 上线后 7 天 | 6 | 0 | 6（待上线后跟踪） |

**代码层就绪度**：约 80%。**生产基础设施就绪度**：约 40%（依赖实际部署环境）。

---

## 二、不足清单与改进建议

### 2.1 功能（Functionality）

#### 不足
1. **设备管理 API 无前端对接**：`server/src/routes/devices.ts` 已实现 GET/DELETE，但 Web/Mobile 端无对应 UI，用户无法看到登录设备列表。生产中账号被盗后用户无法自救。
2. **账户删除无前端入口**：`DELETE /account` 已实现，但设置页没有"删除账户"按钮。
3. **mobile / miniprogram 功能不对齐**：roadmap §8 已知缺口——搜索、分享创建、导入导出、历史、模板 5 项能力未在移动端实现。
4. **mobile 端零测试**：`mobile/src/**/*.test.{ts,tsx}` 不存在，关键路径（ErrorBoundary、解锁流程、生物识别降级）无回归保护。CI 的 `build-android` job 设为 `continue-on-error: true`，失败也不阻塞合并。
5. **分享创建仅 Web 端可用**：Mobile/Miniprogram 端无法创建分享，仅可访问公开链接。
6. **数据导出格式不完整**：`/account/export` 仅导出元数据 + 密文，用户无法在客户端一键还原（缺少配套的客户端导入流程）。
7. **审计日志无独立测试**：`audit_log` 表存在但 `server/src/**/*.test.ts` 未覆盖，删除/恢复/锁定事件无回归保护。

#### 建议
- **P0**：在 Web 端设置页补齐"设备管理"与"账户删除"UI（即使最简列表 + 二次确认对话框），让 GDPR 能力真正可用。
- **P1**：补齐 mobile 端 ErrorBoundary 与解锁流程的最小测试集（mock keychain + 生物识别降级）。
- **P2**：v2.3.0 起逐步对齐 mobile 5 项缺失能力。
- **P2**：为 `audit_log` 增加 `server/src/routes/audit.test.ts`，覆盖 recover / 账号锁定 / 永久删除事件。

### 2.2 界面（Interface）

#### 不足
1. **i18n 不完整**：本次补齐了 ForceUpdateOverlay，但移动端、小程序端尚未接入 i18n 框架（roadmap §8 已知缺口）。Web 端 284 keys 全覆盖 ✅。
2. **设备管理 / 账户删除 UI 缺失**（见 2.1）。
3. **无加载骨架屏**：`common.loading` 已定义但未统一应用，列表/详情加载仍显示空白或 spinner。
4. **无空状态插画**：笔记/收藏/回收站空状态仅文字提示，缺少引导性视觉。
5. **暗色模式对比度未审计**：production-checklist §3 要求 AA 对比度，但未做自动化审计。

#### 建议
- **P1**：补齐设备管理与账户删除 UI（与 2.1 P0 合并实现）。
- **P2**：移动端在 v2.3.0 接入 i18n，与 Web 共用 key 命名空间。
- **P2**：引入 Storybook + 对比度自动审计（axe-core）。

### 2.3 安全（Security）

#### 已落地（强项）
- Argon2id（m=64MB, t=3, p=4）参数合规
- JWT EdDSA / Ed25519 非对称签名（向后兼容 HS256）
- E2EE 分享（AES-256-GCM + AAD 绑定 + URL fragment 传密钥）
- 账号锁定 6/15min + IP 限流（auth 15min/20 次，全局 1min/600 次）
- 分享密码爆破锁定
- 密钥 zeroize()
- XSS 防护（sanitize-html 白名单）
- Tauri 防截屏（set_content_protected）
- 单机模式客户端锁定
- Nginx HSTS / CSP / X-Frame-Options / Permissions-Policy（本次补齐）

#### 不足
1. **JWT_SECRET 弱默认值**：`server/src/env.ts:30` 默认 `'dev-secret-change-me-32plus'`，生产若忘记设置会被攻破。建议启动时强制校验：生产环境下未设置 JWT_SECRET 拒绝启动。
2. **未生成 SBOM**：production-checklist §3 要求 SBOM，CI 未集成 `syft` / `cyclonedx` 生成。
3. **未启用 Dependabot / CodeQL**：`.github/` 下无 dependabot.yml / codeql workflow，依赖漏洞无自动告警。
4. **CORS 允许 `!origin`**：`server/src/app.ts:62` 注释说"允许无 Origin（curl）"，但生产中应禁止。建议仅 development 放行无 Origin 请求。
5. **audit_log 未做去标识化**：`account.ts` 注释提到"应由独立任务定期匿名化"，但无对应 cron / 迁移任务。
6. **`/account/export` 未限流**：导出全量数据是重 IO 操作，无单独限流。建议每用户每 5 分钟 1 次。
7. **未做日志脱敏中间件验证**：production-checklist §3 要求"日志脱敏中间件工作正常"，未在测试中验证。

#### 建议
- **P0**：生产环境强制校验 JWT_SECRET 长度 ≥ 32 且不等于默认值。
- **P1**：CI 集成 `cyclonedx/bom` 生成 SBOM，附加到 Release。
- **P1**：添加 `.github/dependabot.yml` + `.github/workflows/codeql.yml`。
- **P1**：为 `/account/export` 加单独限流（5min/1次）。
- **P2**：补 audit_log 去标识化 cron（保留 90 天后匿名化 user_id / device_id）。

### 2.4 逻辑（Logic）

#### 不足
1. **`/account/export` 不含 note_versions 与 shares**：导出遗漏历史版本与分享记录，不完整。
2. **`/account/export` 笔记字段不完整**：`SELECT id, user_id, is_pinned, ...` 缺少 `folder_id`、`tags` 关联，无法在客户端重建。
3. **设备吊销不踢当前 access token**：注释已说明，但用户预期"立即下线"。建议在 `authMiddleware` 中校验 `refresh_token_hash IS NOT NULL`，吊销后 access token 短期内仍可用但无法续签。
4. **`devices.ts` 不更新 `last_active_at`**：与 `auth.ts:touchDevice` 逻辑分离，列表中 `last_active_at` 仅在登录时更新，日常请求不刷新。建议在 `authMiddleware` 中按分钟节流更新。
5. **`countUserData` 直接拼接表名**：`server/src/routes/account.ts:47` 用字符串拼接 `${t}`，虽然 `tables` 是常量数组（安全），但模式不规范，应使用白名单校验。
6. **`force_update_title` 已修复**（本次会话）：i18n 解析脚本不跳过 `//` 注释，已移除注释。

#### 建议
- **P0**：补全 `/account/export` 字段（folder_id、note_versions、shares、templates）。
- **P1**：`authMiddleware` 增加 `refresh_token_hash IS NOT NULL` 校验，让吊销立即生效。
- **P1**：`authMiddleware` 节流更新 `devices.last_active_at`（每分钟 1 次）。
- **P2**：`countUserData` 改用白名单 Set 校验表名。

### 2.5 框架（Framework）

#### 强项
- monorepo + pnpm workspace + hoisted node-linker（兼容 RN）
- shared 层抽象 DataRepository 接口，所有端共享类型契约
- 单机/联机双模式架构清晰，模式切换显式触发
- CI 完整：lint / typecheck / test / audit / 5 平台 build / native-compat / docker
- Tauri 2 + Velopack 自动更新（Windows）
- 测试覆盖：shared 57 + server 71 + web 67 = 195 项

#### 不足
1. **miniprogram/desktop/mobile 端零测试**：仅 web/server/shared 有测试。mobile 测试框架（Jest）已配置但无测试文件。
2. **无 .gitattributes**：导致 Windows checkout 时 LF→CRLF，本地 `format:check` 报 206+ 文件，开发者体验差（CI Linux 上正常）。
3. **release.yml RELEASE_TAG fallback 写死 v2.1.3**：每次发版需手动同步，易遗漏。建议改为从 `package.json` 读取。
4. **env.ts 默认版本 2.1.1**：与 package.json 2.1.3 不一致，应改为 `__APP_VERSION__` 注入或 build-time 读取。
5. **无 E2E 测试框架**：production-checklist §2 要求"关键路径 E2E 测试覆盖 100%"，未集成 Playwright / Detox。
6. **`pnpm audit --prod` 忽略 GHSA-hmx5-qpq5-p643**（swiper）：技术债，Taro 3.6 升级前无法解决。

#### 建议
- **P0**：添加 `.gitattributes`（`* text=auto eol=lf`）+ 一次性 `git add --renormalize`。
- **P1**：release.yml RELEASE_TAG fallback 改读 `package.json` version。
- **P1**：env.ts 默认版本号改为 `2.2.0` 并保持与 package.json 同步。
- **P2**：v2.3.0 引入 Playwright 覆盖 Web 关键路径；mobile 引入 Detox。

### 2.6 细节（Details）

#### 不足
1. **TODO/FIXME 残留 19 处**：production-checklist §2 要求"无 TODO/FIXME 残留（除非带 issue 编号）"。
   - `web/src/components/AdminConfig.tsx`（5 处）
   - `mobile/src/screens/StandaloneRecoverScreen.tsx`（4 处）
   - `shared/src/crypto.ts`（2 处）
2. **`force_update_title` 在 i18n.ts 重复定义检测失效**：本次发现的 check-i18n.mjs 不跳过 `//` 注释的 bug。建议修复脚本而非 workaround。
3. **`audit_log` 表无 retention 策略**：无限增长，需定期清理。
4. **`devices.fingerprint` 字段语义模糊**：`touchDevice` 写入的是 `deviceId`，并非真正的设备指纹。
5. **`recovery_code_set` 字段语义**：v2 setup 时硬编码为 1，但 v1→v2 迁移用户可能未设置恢复码。

#### 建议
- **P1**：修复 `scripts/check-i18n.mjs` 跳过 `//` 与 `/* */` 注释。
- **P1**：清理 19 处 TODO/FIXME 或转为 GitHub Issue。
- **P2**：`audit_log` 增加 retention cron（保留 180 天）。
- **P2**：`devices.fingerprint` 改名 `device_fingerprint` 或写入真实指纹（UA + platform hash）。

### 2.7 用户习惯（User Habits）

#### 不足
1. **无"记住此设备"选项**：用户每次启动都需输密码，未提供"7 天内免输入"。
2. **无桌面端关闭确认**：直接关闭窗口可能丢失未保存内容（虽然有 `unsaved_warning`，但仅切换笔记时触发）。
3. **移动端无手势返回**：纯按钮导航，不符合 iOS/Android 用户习惯。
4. **无引导教程**：首次设置后无 onboarding，新用户不知道功能入口。
5. **回收站 30 天硬编码**：用户无法自定义保留期。
6. **无数据使用统计**：用户看不到自己有多少笔记/标签/分享。

#### 建议
- **P2**：设置页增加"回收站保留期"选项（7/15/30/90 天）。
- **P2**：首次解锁后显示 3 步 onboarding（创建笔记 / 设置主题 / 同步开关）。
- **P2**：移动端接入 `react-native-gesture-handler` 支持边缘滑动返回。
- **P3**：设置页"关于"区显示账户数据统计（笔记数 / 分享数 / 设备数）。

---

## 三、本次 v2.2.0 可落地范围

### 已完成（本次会话）
- ✅ GDPR Article 17 / 20（账户删除 + 数据导出）
- ✅ 设备管理 API（列表/吊销/登出其他）
- ✅ Nginx 安全加固（HSTS/CSP/限流/TLS 1.3）
- ✅ ForceUpdateOverlay i18n 化
- ✅ i18n 检查通过（284 keys）

### 不在本次范围（理由）
- **设备管理 UI / 账户删除 UI**：需要设计 + 联调 + 测试，建议作为 v2.2.1 单独迭代。
- **mobile 5 项功能对齐**：roadmap §8 已规划为 v2.3.0 主题。
- **SBOM / Dependabot / CodeQL**：基础设施改造，建议作为 v2.2.1 DevOps 任务。
- **Playwright E2E**：测试框架选型需评审，建议 v2.3.0。
- **Lighthouse 性能基线**：需部署到 staging 后测量，本地无法验证。

### 版本号决策
本次属于 **minor** 升级（新增 API 端点 + 安全加固 + i18n 补齐，无破坏性变更）：
- v2.1.3 → **v2.2.0**
- 数据库 schema 无迁移（沿用 v2.1.x 的 migrations id=11）
- 客户端 minClientVersion 维持 2.0.2（向后兼容）

---

## 四、签字与发布决策

| 维度 | 评估 | 决策 |
| --- | --- | --- |
| 代码质量 | lint / typecheck / test 全过；195 项测试 | ✅ 可发版 |
| 安全 | Argon2id / EdDSA / E2EE / 限流 / Nginx 头齐全 | ✅ 可发版 |
| 兼容性 | Web/桌面/Android/小程序 ✅；iOS/macOS/Linux 受限 | ⚠️ 部分支持 |
| 合规 | GDPR Article 17/20 已实现；隐私政策/ToS/Cookie 齐全 | ✅ 可发版 |
| 部署 | Docker / Nginx 配置完整；状态页/告警待部署后接入 | ⚠️ 部署侧补齐 |

**结论**：v2.2.0 可作为 **Beta Production** 发布。完全 GA 需在 v2.3.0 补齐设备管理 UI、mobile 功能对齐、SBOM、Playwright E2E 后达成。
