# 维护者交接手册（Handover）

> 目标：把「巴士因子 = 1」的恢复时间从"只有作者知道"降到"照着本文能独立跑"。
> 配套阅读：[CONTRIBUTING.md](../CONTRIBUTING.md)（门禁总表与来历）·
> [operations-runbook.md](./operations-runbook.md)（服务器运维）·
> [update-signing-runbook.md](./update-signing-runbook.md)（签名/验签实施）·
> [architecture.md](./architecture.md)（系统结构）。
>
> ⚠️ **授权缺口（本文无法用文档解决的部分）**：GitHub 仓库 Admin、服务器 SSH、
> 域名 DNS、各签名私钥目前只有维护者一人持有。backup maintainer 就位时，
> 按 §6 的清单逐项移交/共享；在此之前，本文是唯一的事故恢复路径
> （至少让接手者知道**去哪里找、找什么**）。

## 1. 角色与能做的决定

| 职责                        | 谁可做                                 | 依据                                    |
| --------------------------- | -------------------------------------- | --------------------------------------- |
| 代码合并到 main（非安全类） | 维护者；PR 经 CI 全绿后合并            | CONTRIBUTING「提 PR 的流程」            |
| 安全敏感代码合并            | **2 人 review**                        | CONTRIBUTING「安全敏感代码」            |
| 发布新版本                  | 持有 tag push 权限者                   | §2 流程 + release.yml 的 tag 一致性检查 |
| 服务器升级/回滚             | SSH 持有者                             | operations-runbook §6                   |
| 安全报告处置                | Private Vulnerability Reporting 收件人 | SECURITY.md                             |

## 2. 发版全流程（从零开始照做）

前置：本机装 Node 20/22/24 + pnpm 9（PowerShell 跑 pnpm，Git Bash 垫片已知损坏——
或直接 `node 'C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js' <cmd>`）。

```
1. 确认待发内容：git log 梳理 + CHANGELOG 草稿
2. pnpm verify                    # 18 条门禁本地全绿（与 CI 同款）
3. 写 CHANGELOG.md 新条目（人工写，脚本不代笔）
4. pnpm bump <新版本>             # 同步约 26 处版本位点并自检残留
5. pnpm verify                    # bump 后必须复跑（readme:check / sw:check 会查版本一致性）
6. git commit -m "chore(release): v2.5.x" && git tag v2.5.x && git push --tags
7. 等 Release workflow（~20 分钟）：五个构建 job 全 success 才会 Create Release
   ——任一失败即整体不发布（防下载 404），修复后删 tag 重打
8. 线上验证：
   - GitHub Release 产物齐全（exe/msi/portable/appimage/dmg/apk/web zip/server zip/mp 包）
   - 服务器 /opt/dustnote-downloads/ 更新产物 → curl /api/v1/update-manifest
     确认 latestVersion 与 hash 已更新（覆盖同版本重发时 hash 缓存按 mtime 自动重算）
   - 客户端「检查更新」走一遍完整升级
```

**tag 一致性红灯怎么办**：release.yml `Verify tag matches versions` 校验
tag == package.json == tauri.conf.json == build.gradle versionName 四处一致，
漏 bump 一处直接红——`pnpm bump` 就是为这个存在的，回退 §2.4 重跑。

## 3. 关键资产清单（接手者第一周核对）

| 资产                 | 位置                                                                                              | 备注                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 生产服务器           | SSH（IP 见 1Password/密码管理器条目 `dustnote-server`）                                           | /opt/dustnote-server-v\<ver\>/ 每版本一目录               |
| 服务器 .env          | `/opt/dustnote-server-v<ver>/.env`                                                                | JWT_SECRET / WEB_ORIGIN / BACKUP_ENCRYPTION_KEY           |
| 域名 DNS             | iniess.cn 注册商                                                                                  | napi.iniess.cn → 服务器；hermitweb.github.io 为官网 Pages |
| 备份卷               | docker 命名卷 `<project>_dustnote-backups`                                                        | 滚动 30 份；恢复见 runbook §10                            |
| Android keystore     | GitHub Secrets: `ANDROID_KEYSTORE_BASE64` + 密码 secrets；本地 mobile/android/keystore.properties | **丢失 = 无法再发布可覆盖安装的 APK**，离线备份必须存在   |
| CI secrets 总览      | repo Settings → Secrets                                                                           | 见 §6 移交清单                                            |
| update-minisign 私钥 | （update-signing-runbook §1.1 落地后）维护者离线保管                                              | 公钥在仓库                                                |
| Windows 代码签名证书 | （§2.2 落地后）Azure Trusted Signing / PFX                                                        | 同上                                                      |
| Apple Developer 证书 | （§3 落地后）APPLE_CERTIFICATE secret + p12 离线备份                                              | 同上                                                      |

## 4. 事故响应快速索引

| 症状                   | 先看                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 服务不可用             | runbook §4.1（docker compose ps / logs → OOM / 磁盘满）                               |
| 拨测告警开 issue       | runbook §3（health 端点 + compose 状态）                                              |
| 升级后起不来           | runbook §6.2 回滚；注意 compose project 名随版本目录变化                              |
| 客户端升级失败报校验错 | update-manifest 的 hash 与产物不匹配（覆盖重发未重算？检查日志）→ 正常会按 mtime 自愈 |
| 安全事件               | SECURITY.md 私密披露流程；先止损（停容器/吊销）再溯源                                 |
| WS 大量 401            | 客户端旧版仍在用 query token（v2.5.3 协议变更），提示升级                             |

## 5. 「规矩为什么长这样」的最短路径

新人不需要读完所有历史，按这个顺序 2 小时建立全貌：

1. `CONTRIBUTING.md` 门禁总表——每条后面是哪次事故
2. `docs/architecture.md`——包分层与加密边界
3. `docs/roadmap.md` §0.2——六个真实缺口及状态（本文件写成时：S-M1 已修、
   minisign/签名有实施手册、巴士因子即本手册）
4. `docs/audit-report-2026-10-07.md` + `-10-10.md`——最近两轮审计结论与挂账
5. `docs/adr/`——五个不可回退决策的理由

判断一条"奇怪"的代码能不能改：先搜它附近的中文注释（本仓库惯例是**注释里写事故编号
和理由**），再查 `docs:check` 覆盖的文档。改门禁前读 CONTRIBUTING「文化：变异验证」
——新门禁必须先故意改坏验证它会红。

## 6. backup maintainer 就位移交清单

- [ ] GitHub：仓库 Admin 或至少 Release + Actions write 权限；Secrets 只读不可见，
      需要轮换的项单独走密钥共享
- [ ] 服务器：SSH 公钥加入；演示一次升级 + 一次回滚（实机）
- [ ] 密码管理器共享库：服务器凭据、Android keystore、各签名私钥（分条目最小授权）
- [ ] 域名：DNS 服务商邀请为协作者（不必转移注册商）
- [ ] 一起发一个版本（§2 全流程，交接人旁观）
- [ ] 一起演练一次备份恢复（runbook：better-sqlite3 .backup 提取 → 解密 → 起临时容器验证）
- [ ] 在本文件 §1 表格补上第二列的名字与日期

## 7. 修订

- 2026-10-11：初版。发版流程按 release.yml 实测（tag 触发、五 job 门控、四处版本一致性校验）。
