# 从参考副本同步「修改且可用」的改动

## 目标
对比参考副本 `e:/workspace/dustnote/部分修改dustnote/dustnote/`（只读，不改动）与当前项目 `e:/workspace/dustnote/`，把其中**解耦、非破坏、可用**的修改同步进项目。参考副本本身不作为项目文件，仅作来源。

## 现状分析（Phase 1 结论）

- 参考副本位于 `部分修改dustnote/dustnote/`，git HEAD `91380c5` + **未提交的 v2 工作区改动**。
- 当前项目 HEAD `684abaa`（dev/setup-and-fixes，刚发布 v2.0.4），已是**双模式架构**（standalone + online，含 lockout、local-auth、repository 模式）。
- 共同 merge-base `11a57ac`；`91380c5` **不是** `684abaa` 的祖先，两支已分叉。
- 参考副本是一套**连贯的 v2 认证协议重写**，其中：
  - **v2 认证协议核心是破坏性的、与双模式架构冲突** → 排除（见下「明确排除」）。
  - 其余有 4 组解耦、可用的改动 → 同步。

### 关键不兼容点（为何排除 v2 认证核心）
1. `auth-protocol-v2` 迁移会 `DELETE FROM users WHERE auth_hash IS NULL` —— 当前项目**正是 v1**，升级会清空全部用户及笔记（外键 CASCADE）。
2. v2 `crypto.ts` 删除 `deriveMasterKey / deriveRecoveryKey / wrapMasterKey / unwrapMasterKey` —— 当前 `shared/src/local-auth.ts`（standalone 模式）依赖这些 v1 函数，替换会破坏单机模式。
3. 参考 `mobile/miniprogram state/auth.ts` 是**单模式 v2**，替换会**回退**刚发布的双模式（standalone+online+lockout）。

### 已验证的兼容性事实
- 当前 web store 已有 `notesPlain: Map<string, NotePlaintext>` ✅（SharesManager E2EE 改动可用）
- 当前 `server/src/auth/jwt.ts` 已有 `type: 'access'|'refresh'` 字段 ✅（sync-ws 收紧到 access-only 可用）
- 当前服务端**均未**有 trustProxy / 10mb body / CORS 403 / sync-ws 收紧 → 全部可直接应用
- 当前 `server/src/routes/shares.ts`、`SharesManager.tsx`、`sync-ws.ts`、`config-validate.ts`、miniprogram share 三页 = merge-base = 参考基线 → 参考差异可干净应用
- 当前迁移止于 `id:6 add-account-lockout-columns`（schema_version='6'）→ E2EE shares 迁移作为 `id:7`
- 当前根 `Dockerfile` 已是更高级的 web+API+nginx 一体镜像（含 supervisord、已用 `pnpm deploy`）→ 参考根 Dockerfile 差异**已过时，跳过**
- 当前 `deploy/nginx.conf` 已含 CSP 三头 → **跳过**

## 同步范围

### Group A — sanitize-html XSS 防护（直接可用，无认证依赖）
- **新增** `web/src/lib/sanitize-html.ts`：从参考副本原样复制（纯工具，DOMParser 白名单净化，无第三方依赖）。
- `web/src/components/Editor.tsx`：仅取 sanitize 部分 —— 新增 `import { sanitizeHtml } from '../lib/sanitize-html';`，把预览的 `dangerouslySetInnerHTML` 包成 `sanitizeHtml(marked.parse(...) as string)`。
  - 注意：参考的 Editor.tsx 差异**还含 E2EE 分享创建**，那部分归入 Group D，一并改。
- `web/src/screens/PublicShareView.tsx`：渲染处包 `sanitizeHtml`（随 Group D 的 E2EE 重写一起落地）。

### Group B — 服务端加固（直接可用，当前全部缺失）
- `server/src/env.ts`：新增 `trustProxy: Number.parseInt(getEnv('TRUST_PROXY','0'),10)` 及注释。
- `server/src/config-validate.ts`：schema 加 `trustProxy: z.number().int().nonnegative().max(10)`；生产环境改为 `jwtSecret === 'dev-secret-change-me' || jwtSecret.length < 32` 才报错（当前仅判等 dev 值，未真正校验长度）。
- `server/src/config-validate.test.ts`：加 trustProxy / jwtSecret 长度校验测试（参考差异）。
- `server/src/app.ts`（**适配，非整段替换**）：
  - 在任何限流中间件前加 `app.set('trust proxy', config.trustProxy);`
  - CORS `origin` 回调改为 `cb(null, !origin || allowedOrigins.includes(origin))`（拒绝时返回 403 而非抛错冒泡成 500）
  - body 限制 `60mb → 10mb`（json + urlencoded）
  - **跳过**参考里 `/api/v1/auth/recovery-params` 限流行（那是 v2 端点，不同步）
- `server/src/services/sync-ws.ts`：整体应用参考差异 —— 只接受 query `?token=<access>`，删掉 `dustnote_refresh` cookie 回落；`verifyToken` 后加 `payload.type !== 'access'` 拒绝。
- **跳过** `server/src/middleware/auth.ts` 的 `/auth/recovery-params` 白名单行（v2 端点）。

### Group C — Docker / 部署加固（适配）
- `server/Dockerfile`：应用参考差异（CI 仍用此文件）—— builder 加 `apk add python3 make g++`（better-sqlite3 musl 源码编译）、`COPY patches patches`（package.json 有 patchedDependencies）、`pnpm --filter @dustnote/server --prod deploy /prod-server`、运行阶段 `COPY --from=builder /prod-server ./`、去掉 `sqlite` apk、加 `ENV DB_PATH=/app/data/dustnote.db`。
- `docker-compose.yml`（**适配**，当前是一体镜像 compose）：`JWT_SECRET` 改为 `${JWT_SECRET:?请在 .env 中设置 JWT_SECRET（≥32 字符随机串）}`（当前是 `:-dev-secret-change-me` 弱默认）；新增 `TRUST_PROXY=${TRUST_PROXY:-1}`。
- `.env.example`：新增 `JWT_SECRET=`（必填，附 `openssl rand -base64 48` 注释）与 `TRUST_PROXY=1`；当前 `JWT_SECRET=change-me-to-a-32-char-random-string` 改为空+注释。
- `.github/workflows/ci.yml`：docker build `file: server/Dockerfile` → `file: Dockerfile`（对齐根一体镜像，与 docker-compose 一键部署一致）。**复核点**：若当前发布策略刻意保留 API-only 镜像，则此项跳过；否则应用。
- **跳过**根 `Dockerfile`（当前已更高级，参考差异已过时）；仅复核当前根 Dockerfile 是否 `COPY patches patches`（若缺则补，否则 better-sqlite3 patch 构建会失败）。

### Group D — E2EE 分享（适配到 v1 crypto，不碰认证协议）
核心思路：E2EE 分享只需「内存中有一把 masterKey」来包装 shareKey，**与 masterKey 如何派生无关**，因此可在 v1 架构上启用。仅需在 `crypto.ts` **新增**两个非破坏别名函数。

- `shared/src/crypto.ts`：**新增** `wrapKey(kek, key)` = `encrypt(kek, key, 1)` 与 `unwrapKey(kek, wrapped)` = `decrypt(kek, wrapped)`。**保留全部 v1 函数**（deriveMasterKey / wrapMasterKey / deriveRecoveryKey 等），不动 standalone 模式。
- `shared/test/crypto.test.ts`：加 wrapKey/unwrapKey 往返测试。
- `server/src/migrations.ts`：**新增迁移 `id:7, name:'e2ee-shares'`**（参考的 e2ee-shares 迁移，schema_version→'7'）：`DROP TABLE shares` 后重建含 `ciphertext TEXT`、`wrapped_share_key TEXT`、`password_hash`、`expires_at`、`view_count`、`revoked`、`created_at`（无 title/content）。迁移内对已有 shares 计数并 `logger.warn` 后随 DROP 丢弃（旧明文快照无法转密文）。**不新增** auth-protocol-v2 迁移。
- `server/src/routes/shares.ts`：应用参考差异 —— `CiphertextSchema`、`CreateShareSchema` 改 `ciphertext`+`wrappedShareKey`、INSERT/SELECT 去掉 title/content 改用 ciphertext/wrapped_share_key、公开端点只回 `ciphertext`。
- `web/src/components/Editor.tsx` ShareDialog：应用参考差异的 E2EE 部分 —— 校验 `masterKey`、本地 `randomBytes(32)` 生成 shareKey、`encryptString(shareKey, JSON.stringify({title,content}))`、`wrapKey(masterKey, shareKey)` 上传 `ciphertext`+`wrappedShareKey`、链接拼 `#<toBase64Url(shareKey)>`、加「密钥在 # 后」提示。
- `web/src/components/SharesManager.tsx`：应用参考差异 —— `Share` 接口加 `wrappedShareKey`、去 `title`；`buildShareUrl` 用 `unwrapKey(masterKey, s.wrappedShareKey)` 还原完整链接；标题改用 `notesPlain.get(s.noteId)?.title`。
- `web/src/screens/PublicShareView.tsx`：应用参考的 E2EE 重写 —— `readShareKey()` 从 `location.hash` 取 shareKey、`isCiphertext` 校验、`decryptString(shareKey, ciphertext)` 本地解密、渲染包 `sanitizeHtml`。（当前文件相对 merge-base 仅 2 行差异，参考是整体重写，按参考版本落地并保留当前那 2 行的语义。）
- `miniprogram/src/pages/note/edit.tsx`：应用参考差异 —— E2EE 分享创建（shareKey + wrapKey + encryptString，key 放路由参数）。
- `miniprogram/src/pages/share/index.tsx`：应用参考差异 —— 从路由参数取 key、`decryptString` 本地解密。
- `miniprogram/src/pages/share-mgr/index.tsx`：应用参考差异 —— `ShareItem` 去 `title`，列表项改用创建时间标识。
- **跳过** `miniprogram/src/pages/unlock/index.tsx`（仅注释改动，且关联 v2 语义，价值低）。

## 明确排除（不同步，附原因）
| 文件 | 原因 |
|---|---|
| `shared/src/crypto.ts` v2 重写（deriveSecrets/generateMasterKey/normalizeRecoveryCode/Crockford 码） | 删除 v1 函数，破坏 standalone 模式依赖的 local-auth.ts |
| `server/src/routes/auth.ts` v2 | 依赖 v2 crypto + 新 schema（authKey/pwSalt/rewrap） |
| `server/src/migrations.ts` `auth-protocol-v2` | `DELETE FROM users WHERE auth_hash IS NULL` 清空当前 v1 全部用户 |
| `web/src/lib/store.ts` v2 认证段 | 依赖 v2 crypto + `/auth/recovery-params` + `/auth/rewrap` |
| `mobile/src/state/auth.ts` v2 | 单模式 v2，回退双模式（standalone+online+lockout） |
| `miniprogram/src/state/auth.ts` v2 | 同上，回退双模式 |
| `web/src/screens/UnlockScreen.tsx` | 用 `isValidRecoveryCode`（v2 Crockford 码），与 v1 6 位码不兼容 |
| `web/src/lib/i18n.ts` | 6→10 位恢复码文案，v2 耦合 |
| `server/src/middleware/auth.ts` + `app.ts` 的 `/auth/recovery-params` 行 | v2 端点 |
| `deploy/nginx.conf` CSP | 当前项目已有 |
| 根 `Dockerfile` | 当前已是一体镜像（更高级），参考差异过时 |
| `CHANGELOG.md` / `README.md` | 描述 v2 破坏性变更，与本次不同步 v2 不符 |

> 若后续要做 v2 认证协议切换，需单独立项：非破坏迁移（保留 v1 用户或提供 v1→v2 数据迁移路径）+ 双模式适配 + 全链路测试。本次不做。

## 假设与决策
1. v2 认证协议核心**不在本次范围**（破坏性 + 回退双模式）。依据用户「把修改且**可用**的同步」的口径。
2. E2EE shares 迁移（id 7）会丢弃既有分享链接（明文快照无法转密文）—— 可接受：分享是临时链接，不涉及用户/笔记数据。
3. `wrapKey/unwrapKey` 以**非破坏别名**加入 v1 crypto.ts → E2EE 分享可与 v1 masterKey 共存，不影响 standalone 模式。
4. 遵循「先验证再上传」：每组改完跑 typecheck/lint/test 通过后再进下一组。
5. 顺序：A（sanitize）→ B（服务端加固）→ C（Docker/部署）→ D（E2EE 分享）。A/B 互相独立最安全；D 依赖 crypto 新增 + 迁移 7。

## 验证步骤
每组完成后：
- `pnpm --filter @dustnote/shared build && pnpm --filter @dustnote/shared test`
- `pnpm --filter @dustnote/server build && pnpm --filter @dustnote/server test`（关注现有 shares / auth / config-validate 测试）
- `pnpm --filter @dustnote/web build`（含 tsc + eslint）
- `pnpm --filter @dustnote/miniprogram build:h5`（tsc 校验）

D 组额外：
- 在 DB 副本上跑迁移 7，确认 `shares` 表结构为 ciphertext/wrapped_share_key，旧分享被丢弃且有 warn 日志。
- E2E：web 创建 E2EE 分享 → 隐身窗口打开带 `#key` 链接 → 确认本地解密渲染；分享管理页「复制链接」能还原完整链接。
- 小程序 H5 分享创建/打开流程跑通。
- standalone 模式回归：确认 setup/unlock/recover 仍走 v1 local-auth，未被 E2EE 改动影响。

全部通过后再提交（用户偏好：先验证再上传）。
