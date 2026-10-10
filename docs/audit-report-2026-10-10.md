# 探针式复检审计报告（2026-10-10）— v2.5.52

> 范围：根工程 / shared / server / web / desktop / mobile / miniprogram / site / client-core。
> 性质：**复检 + 探针**——10-07 全端审计（`audit-report-2026-10-07.md`）修复落地后的独立复核，
> 不重复上一轮的逐函数走查，重点验证「修复是否真实在位」与「基线是否仍然全绿」。
> 方法：全部结论来自本机实跑（tsc / vitest / 13 条一致性门禁脚本 / git 取证），无抄录旧数字。

## 一、基线复跑（全部实跑，非引用旧值）

| 检查                                                      | 结果                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| shared `tsc --noEmit`                                     | ✓ 0 错误；vitest **135/135**               |
| server `tsc --noEmit`                                     | ✓ 0 错误；vitest **119/119**（15 文件）    |
| web `tsc -p tsconfig.app.json` + `tsc -b`                 | ✓ 均 0 错误；vitest **177/177**（20 文件） |
| desktop / mobile / miniprogram / site / client-core `tsc` | ✓ 各 0 错误                                |
| mobile vitest                                             | **37/37**                                  |
| miniprogram vitest                                        | **46/46**                                  |
| git 工作树                                                | **0 未提交 / 0 未跟踪**，main @ f617cf6    |

一致性门禁实跑 13 条全绿：`sw:check`（SW_VERSION=2.5.52）· `i18n:check`（mobile 413 / mp 416 key，内嵌 emoji 0）· `readme:check` · `docs:check`（54 md / 232 链接 / 孤儿 0）· `env:check`（40 变量双向一致）· `errtext:check` · `ui:check` · `api:check`（57 路由）· `workflows:check`（6 份）· `security:headers`（6 location）· `action:pins` · `docker:check` · `test:monitoring`（0 fail）。

## 二、10-07 审计修复项「在位」验证

| 修复项                           | 复核证据                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `@types/better-sqlite3` 补回     | `server/package.json` devDeps 含 `^7.6.10`；server tsc 0 错误（TS7016 不复现）               |
| WS 子协议鉴权（防 token 进日志） | `sync-ws.ts` 实装 `Sec-WebSocket-Protocol: "dustnote, <token>"` 解析，query token 分支不存在 |
| 设备吊销 WS 补库查               | upgrade 路径 `refresh_token_hash IS NOT NULL` 校验在位（verifyToken 只验签名，此处兜底）     |
| WS DoS 防护                      | 单帧 64KB / 单用户 5 连接 / 10 msg·s⁻¹ 令牌桶 / 30s 心跳踢出，四项均在码                     |
| 生产 JWT_SECRET 强校验           | `env.ts` 生产环境拒绝默认值 + 长度 ≥32，启动期抛错                                           |
| web 测试 168→177                 | 实跑 177 ✓（flushQueue 9 条 + graceUnlock 4 条回归在内）                                     |

## 三、本轮新发现（均为低危 / 卫生项）

| #   | 发现                                                                                          | 处置建议                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-1 | `server/src/migrations.ts` 迁移 id 跳号：1–15 之后直接 17（无 16），现最高 21                 | **非缺陷**：`runMigrations` 用 `_migrations` 表按 id 精确匹配 applied 集合，跳号不影响执行与幂等（迁移测试 3 条通过）。仅建议在文件头注释标注「16 已弃用」防后来者补位 |
| N-2 | 根目录 `ISSUE_server-missing-better-sqlite3-types.md` 未被 git 跟踪，其描述的问题已修复并验证 | 建议删除或移入 `docs/archive/`（若保留需入索引，否则 `docs:check` 不拦根目录但会成视线噪音）                                                                           |
| N-3 | `server/data/` 遗留 6 个测试 db（app-test / diagnostics-test / e2e 等 +shm/-wal）             | 已被 gitignore，无泄漏风险；可在下次清理时删除（运行时会重建）                                                                                                         |
| N-4 | `shoot.mjs` 自述「临时工具，未入库」，screenshots/ 存 23MB 历史截图（均被 ignore）            | 维持现状即可；若不再重跑效果图可归档                                                                                                                                   |
| N-5 | `desktop/src-tauri/target` 5.7GB Rust 产物在盘                                                | 已正确 ignore，属正常构建缓存，无动作                                                                                                                                  |

## 四、与 10-07 报告遗留项的对照（维持原判）

- **S-M1 auth 限流单桶**（unlock/recover/refresh 共用 20 次/15min）：本轮确认 `version-check.ts` 与 auth 路由现状未变，**维持「R1 需部署验证窗口再改」的判断**。
- **W-L1~8** web 错误文案 errorText 统一、**S-L1** asyncHandler 一致性、**MP-L1/L2** 小程序两处 LOW：均未回归、维持挂账。
- roadmap §8 度量表数字已过时（写 607 单测，当前实测 **514**=135+119+177+37+46 拆包口径不同 + desktop 29 + site 24 + client-core 79 ≈ 646，口径需按季度对照约定刷新）——不影响判断，留季度维护时一并更新。

## 五、结论

v2.5.52 的工程质量**高于 10-07 审计时的状态**：上轮全部高危/中危修复确认在位，全包类型与测试实跑零失败，
仓库工作树干净，敏感路径（db / env / 备份 / 构建产物）的 ignore 覆盖经 `git ls-files` 反向取证无一处泄漏。
当前无新增必修项；遗留项与 10-07 报告的优先级序完全一致。
