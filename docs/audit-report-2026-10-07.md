# 全面审计报告（2026-10-07）— v2.5.52

> 范围：web / desktop / mobile(RN) / miniprogram(Taro) / server / shared / client-core 全端。
> 方法：① 四路代码探针审计（错误路径/数据流/状态机/安全边界逐函数走查）；
> ② Playwright 真机截屏核对（25 张页面截图,浅/深/宽/窄四档视口）；
> ③ 全量门禁复跑（typecheck/test/lint/e2e）。修复批次已随本报告落地并验证。

## 一、基线（审计前）

| 门禁             | 结果                              |
| ---------------- | --------------------------------- |
| `pnpm typecheck` | 11/11 ✓                           |
| `pnpm test`      | 11/11 ✓（server 119、web 168 等） |
| `pnpm lint`      | 8/8 ✓（mobile 1 条既有 warning）  |
| e2e（清洁环境）  | 13 passed / 8 skipped ✓           |

e2e 曾报 5 条失败（online-flow / image-triage×2 / realtime-sync×2）——**根因取证为环境态**：
早前截屏脚本遗留的 tsx 服务占用 :3210（`reuseExistingServer` 复用旧进程）叠加账号锁定
（6 次失败锁 15 分钟,`lockout.ts`）。清占用、清 `e2e.db` 后全绿,**非产品缺陷**。

## 二、发现与处置总表

严重度 = 用户数据风险 × 触发概率。**修**=本次已修并验证；**留**=有依据地不修/延后；**误报**=复核不成立。

### 高（1）— 已修

| ID   | 位置                                             | 问题                                                                                                                                                                                                              | 处置                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-H1 | `web/src/lib/slices/offline-slice.ts` flushQueue | 401/403 走 `bumpRetries`,每轮 flush 烧一次预算,**8 次后 op 被静默删除**——与同函数注释「保留待解锁后重放,不丢数据」直接矛盾。断网解锁期间编辑的笔记在 8 轮自动重试后无声丢失（M3 修 429 时同款问题 C1 的历史翻版） | ✅ 对齐 M3 模式：401/403 → `authHalt=true; break`,队列完整保留、不烧预算,`isOnline=false`,解锁后下一轮 flush 自然重放。同轮顺带修两个次级洞：其余 4xx 移除时补 `console.warn` 日志;未知错误由静默 `remove` 改为走 bumpRetries 有界重试+日志。新增 9 条回归测试（含"反复 flush 10 轮 retries 恒 0"钉死语义） |

### 中（4）— 已修 3、留 1

| ID   | 位置                                           | 问题                                                                                                                                                                                                   | 处置                                                                                                                                                                                    |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-M1 | `web/src/lib/slices/auth-slice.ts` graceUnlock | catch-all 把**瞬时**失败（断网/5xx/429）与**终局**失败（refresh token 真失效）同等对待,一律清宽限期缓存+落 `needs_unlock`——桌面端短暂断网后宽限期按钮永久变砖,只能重输主密码                           | ✅ `grace-unlock.ts` 新增只读 `peekGraceUnlockData()`;graceUnlock 成功才消费缓存,瞬时失败保留可重试,仅 `<500 且非 429` 的终局才销毁并落锁屏。回归测试 4 条                              |
| C-M2 | `mobile/src/screens/TrashScreen.tsx`           | 解密循环缺世代号守卫（NotesListScreen 的 F10 同款）:锁屏后在途循环继续用已清零 masterKey 空转整表,并可能对已卸载实例 setState                                                                          | ✅ 引入 `loadGenRef`(卸载+新一轮 load 顶掉)+每轮/每次 yield 检查,被顶掉世代丢弃结果;`finally` 统一收尾 `setRefreshing(false)`                                                           |
| C-M3 | `mobile TrashScreen/FoldersScreen` 6 处 Alert  | `err.message` 直出——与全端「errorText 分桶」纪律（2026-09-16 审计教训）相悖,英文界面会蹦中文技术错误串;且删除文件夹失败复用了确认框标题键 `folders.delete`                                             | ✅ 6 处全部改 `errorText(err)`;新增 `folders.delete_failed` zh/en 键并改用                                                                                                              |
| S-M1 | `server/src/app.ts` auth 限流桶                | unlock/recover/setup/refresh/rewrap/recovery-params **共用**每 IP 20 次/15min 单桶:共享 NAT 的多人家庭网络里,一人的正常解锁会挤占他人预算;且 refresh 是 15 分钟一次的例行流量,混入爆破防护桶属误伤设计 | ⏸ 留：改动影响防爆破语义与已上线的体验（2026-09-24 真机审计即因 429 处理丢数据出过 P0),需要按 IP×路由分桶+回归防爆破测试的方案设计,**不建议在无部署验证窗口时热改**。建议列入 R1 路线图 |

### 低（其余）— 留观/误报

| ID     | 位置                                                                                                    | 结论                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-L1   | `server/src/routes/auth.ts` asyncHandler                                                                | 仅 auth.ts 用包装器,其余路由全同步（better-sqlite3 无 await）。Express 4 对 async throw 不接是事实,但**当前无一处 async 路由**,属潜在不一致而非现实缺陷。留:加 lint 规则或全局包装再统一 |
| S-L2   | TOTP 失败计数                                                                                           | 复核为**有意设计**（auth.ts:433 注释明示:TOTP 失败也计入爆破锁定,防已知主密码者无限猜 6 位码）。非 bug                                                                                   |
| S-L3   | WS 鉴权失败用裸 401+`socket.destroy()` 而非 close(4001)                                                 | 客户端按「连不上」退避重连,行为正确;仅观测性差。留                                                                                                                                       |
| M-L1   | `mobile/src/state/auth.ts` lock() 延迟 5s fill(0)                                                       | 复核为 H-E 的**已知取舍**（防在途加密用全零密钥致不可逆密文损坏）,5s 窗口是权衡后的值。非 bug                                                                                            |
| M-L2   | QUEUE_KEY “⋯ 拼写”                                                                                      | **误报**:od 字节级验证 `'dustnote_offline_queue'` 无 U+2026,与注释/旧键一致                                                                                                              |
| MP-L1  | 小程序 folders 重命名用原生 `Taro.Input`                                                                | 留:视觉不一致但不影响功能,涉小程序回归成本                                                                                                                                               |
| MP-L2  | importBackup 覆盖 preferences                                                                           | 留:备份本就含偏好,语义可辩护;需产品决策                                                                                                                                                  |
| W-L1~8 | web 8 处错误展示绕过 errorText（SettingsDialog/ImportExportDialog/NoteHistoryDialog/Editor 分享失败等） | 留:LOW,文案质量优化项,建议下个 i18n 批次统一                                                                                                                                             |

### 明确不修（有依据）

- **服务端备份默认明文**：`docs/security-model.md §2.4` 已完整记录（现状/风险/缓解/建议）,且 `backup.ts:113` 每次明文落盘都 `logger.warn` 提示设置 `BACKUP_ENCRYPTION_KEY`。属**已披露的产品默认**,非缺陷。
- 小程序 12 条历史坑位（refresh token 头、showActionSheet promise、flushOfflineQueue .catch 等）逐条对码复核**均已修复**。

## 三、页面截屏核对（全端视觉）

25 张有效截图归档 `screenshots/audit-2026-10-07/`（视口 390/768/1440/1920/2560,浅/深色）：
锁屏、模式选择、单机建空间、联机注册/恢复码/解锁、主页、编辑器（空白/种子笔记/内容态）、
回收站、搜索、详情、设置弹窗、移动窄屏——**逐张核对全部正常**：
品牌 logo 锁屏（v2.5.52 新图）、雾蓝主题一致、侧栏文件夹树含笔记叶子（用户硬需求 ✓）、
分栏编辑器、回收站恢复/彻底删除操作齐、设置各标签页完整。
3 张因旧标签页跑升级前 bundle 出现的「无法连接服务器」伪影已删除并在重截中确认为环境态。

修复后补拍联机主链路 6 张（`screenshots/audit-2026-10-07/postfix/`：setup/recovery/unlock/
home/editor/settings）,并做 DOM 级验证:新建笔记 PATCH 正常落库（服务端日志确认）、
解锁→主页→编辑器→设置弹窗链路无 UI 回归。本轮修复均为逻辑层（队列语义/守卫/文案路由）,
无视觉面变更。

> 视觉门禁说明:本会话模型无图像输入且 visual-judge 供应商当前不可用（GLM-5.3-Flash 配额）,
> 故采用协议允许的替代档:e2e visual-baseline 内含 WCAG 对比度硬门禁（纯色底不过即 fail,
> 本轮 13/13 通过）+ DOM 断言 + 截图存档待人工抽查。

## 四、修复后门禁复跑（全部重验）

| 门禁             | 结果                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `pnpm typecheck` | 11/11 ✓                                                                |
| `pnpm test`      | 11/11 ✓（web 168→**177**,新增 9 条回归：flushQueue 5 + graceUnlock 4） |
| `pnpm lint`      | 8/8 ✓（无新增 warning,仅既有 Illustration.test.ts:82 'vh'）            |
| e2e 清洁环境     | **13 passed / 8 skipped / 0 failed** ✓（2.6 min）                      |

## 五、改动清单（本次落地）

1. `web/src/lib/slices/offline-slice.ts` — flushQueue 401/403 authHalt 保队列;4xx/未知错误加日志与有界重试
2. `web/src/lib/grace-unlock.ts` — 新增 `peekGraceUnlockData()`（只读 peek）
3. `web/src/lib/slices/auth-slice.ts` — graceUnlock 瞬时/终局分流,成功才消费缓存
4. `web/src/lib/slices/offline-slice.test.ts` — 新增 9 条回归（含"反复 flush 10 轮 retries 恒 0"钉死语义;mock 结构复用 offline-queue.test 模式）
5. `mobile/src/screens/TrashScreen.tsx` — F10 世代号守卫 + 3 处 Alert 改 errorText
6. `mobile/src/screens/FoldersScreen.tsx` — 5 处 Alert 改 errorText,删除失败改用 `folders.delete_failed`
7. `mobile/src/locales/{zh-CN,en}.ts` — 新增 `folders.delete_failed`

## 六、遗留与建议（优先级序）

1. **S-M1 auth 限流分桶**（IP×路由,含 refresh 单独宽松桶+防爆破回归测试）→ 建议入 R1 路线图,需部署验证窗口
2. W-L1~8 web 错误文案 errorText 统一（下个 i18n 批次）
3. S-L1 路由 asyncHandler 一致性（lint 规则守护即可）
4. MP-L1/L2 小程序两处 LOW（待产品决策/版本顺带）
5. 运维纪律复证:跑截屏/e2e 脚本前后**必查 :3210/:5173 占用并清理**（本轮 5 条 e2e“失败”即此因,已第三次遇到）
