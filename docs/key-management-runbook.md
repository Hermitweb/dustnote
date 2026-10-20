# 密钥保管与轮换手册（Key Management Runbook）

> 目标读者：运维 / 安全负责人 / 维护者。这是密钥类凭据（secret）的保管、轮换、失窃应急处置手册。
> 与 `update-signing-runbook.md`（更新信任根）互补：本文档管**运行期密钥**，那边管**签发侧私钥**。
>
> 覆盖四类：① `JWT_SECRET` ② argon2 pepper ③ 数据库字段加密 KEK（可选） ④ GCP 服务账号凭据（备份用）。
> 每类含：保管方式、轮换步骤、失窃应急、验证方法。

## 0. 密钥清单与保管总则

| 密钥                | 用途                                                          | 生成方式                              | 保管位置                                    | 泄露影响                                     |
| ------------------- | ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `JWT_SECRET`        | 会话签名（Access 2h + Refresh 30d 双 token，均其 HS256 签名） | `openssl rand -base64 48`（≥32 字符） | server 环境变量 / `.env`（gitignore）       | 伪造任意用户会话，全账户失守                 |
| argon2 pepper       | 密码哈希的额外盐（Argon2id 输入混合）                         | 部署时随机 32B                        | 同一环境变量文件                            | 离线爆破成本下降（已有 + 15 位密码强度兜底） |
| 数据库加密 KEK      | 可选：`notes.body` 字段 AES-GCM 主密钥                        | `openssl rand -hex 32`                | 独立于 JWT_SECRET 的环境变量                | 数据库被偷走可解密全量笔记正文               |
| GCP service account | 云备份目标（仅 `roles/storage.legacyBucketOwner`）            | GCP 控制台 JSON                       | `scripts/backup-cloud.mjs` 注入（不进 git） | 攻击者读写备份桶                             |

**总则**：

1. 一律放环境变量 / `.env`（已 gitignore），**绝不进 git、绝不在文档里写真实值**。
2. `.env` 文件 `chmod 600`，归属 `dustnote` 运行用户。
3. 密钥**最小权限**：备份 GCP 账号只给 backup-bucket 单桶 `legacyBucketOwner`，不给项目级。
4. 每次轮换在 `CHANGELOG.md` 记一行（脱敏，只记「已轮换」，不记密钥值）。

## 1. JWT_SECRET 轮换

### 1.1 何时轮换

- 服务器被入侵 / `.env` 泄露疑似；
- 维护者长期未换（建议 ≤ 12 个月一次例行）；
- 人员离职 / 凭据共享面扩大。

### 1.2 步骤（滚动生效，不停服）

```bash
# 1) 生成新密钥（先别删旧的）
NEW=$(openssl rand -base64 48)

# 2) 改 .env：旧 JWT_SECRET 改名为 JWT_SECRET_OLD，写入新值
#    server 启动时读两个变量（JWT_SECRET 优先，旧值降级校验用，见 §1.3 双密钥窗口）

# 3) 滚动重启（蓝绿或逐容器）：先起挂新密钥的副本、切流量、再停旧副本

# 4) 30 天观察窗口后删除 JWT_SECRET_OLD 与 server 侧旧密钥降级逻辑
```

### 1.3 双密钥窗口（graceful）

server 在窗口期内接受两种签名的 token：新 `JWT_SECRET` 签发的全部 + 旧 `JWT_SECRET_OLD` 签发的存量。

- 已有用户 Refresh Token 最长 30 天，窗口内旧 token 仍有效；
- 30 天后全部存量 token 已过期，可安全收掉旧密钥；
- **切勿** 窗口内直接删旧密钥——会把未刷新的 30 天内活跃用户全部踢下线。

### 1.4 验证

```bash
# 用旧密钥签的 token 在窗口内仍应 200；窗口后应 401
# 用新密钥签的 token 全程 200
curl -fsS -X POST https://<host>/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"***"}' | jq '.accessToken'
```

## 2. argon2 pepper 轮换

### 2.1 何时轮换

- 数据库文件外泄（即使密码已用 Argon2id 哈希，pepper 丢失 + 密码字典会降低成本）；
- 例行 ≤ 12 个月。

### 2.2 步骤

pepper 参与每次登录的哈希输入，**无法用双密钥窗口**——换 pepper 等价于所有密码重新哈希。

```bash
# 1) 生成新 pepper：NEW_PEPPER=$(openssl rand -hex 32)
# 2) 后台迁移任务：逐用户 用 masterKey 解出明文密码 → 用新 pepper 重哈希 → 落库
#    （必须在线持有用户密码明文做重哈希，仅在数据库外泄事件下执行，且要告知用户「密码强度策略不变」）
# 3) 迁移完成后 72h 内完成；迁移期间旧 pepper 仍生效（双读）
# 4) 收掉旧 pepper
```

> 数据库外泄事件下，优先按 `operations-runbook.md` §故障处理 先**备份 + 隔离**，再评估是否值得重哈希
> （若已有 15 位密码强度兜底且 pepper 未单独泄露，可仅轮换 JWT 而保留 pepper）。

## 3. 数据库加密 KEK 轮换（启用字段加密后）

仅在 `DUSTNOTE_DB_ENCRYPTION_ENABLED=true` 时存在此密钥。轮换需**全量重加密**：

1. 新 KEK 生成；
2. 后台任务逐行解密 `notes.body` → 用新 KEK 重加密 → 落库；
3. 完成后切换环境变量、删除旧 KEK。

- 不可中断：重加密期间旧 KEK 必须保留（双读）；
- 单库规模大时分片 + 限速，避免打满 DB 连接池。

## 4. GCP 备份服务账号轮换

1. GCP 控制台新建 service account + 重新下载 JSON；
2. `scripts/backup-cloud.mjs` 更新注入；
3. 旧 JSON 立即 Revoke（GCP 控制台 → Service accounts → 删除或 Disable）；
4. 验证下一轮 cron 备份成功落桶。

## 5. 失窃应急（Runbook）

| 场景                     | 立即动作                                                                      | 后续                         |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------- |
| `.env` 文件泄露          | ① 隔离 server ② 轮换 JWT_SECRET（双密钥窗口） ③ 审计 `users` 表是否有异常会话 | 72h 后复盘访问日志           |
| 数据库 + pepper 同时泄露 | ① 全量备份 ② 隔离 ③ 转 `operations-runbook.md` 故障处理 ④ 视情况 §2 重哈希    | 通知受影响用户（若政策要求） |
| GCP 备份账号泄露         | ① Revoke 旧 JSON ② 检查备份桶 ACL 是否被改                                    | 新账号注入并验证             |

**原则**：密钥事件一律先**止损**（隔离 / 轮换 / Revoke），再复盘根因；不在事件进行中改业务代码。

## 6. 例行检查清单

- [ ] `.env` 是否 `chmod 600`、归属正确？
- [ ] `git log --all -- .env` 是否从未有过 `.env` 提交？
- [ ] `git grep` 确认无密钥值出现在仓库内（搜 `JWT_SECRET=`、真实 hex 段）？
- [ ] 上次轮换距今是否 ≤ 12 个月？（CHANGELOG 有记录）
- [ ] GCP 备份账号 IAM 是否仅单桶最小权限？
