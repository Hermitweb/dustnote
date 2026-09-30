# API 一览

> 本页由 `pnpm api:gen` 从 server/src 生成，请勿手改；CI 里 `pnpm api:check` 做漂移检测。
> 它只列**能从代码机械读出**的事实：方法、路径、是否需要 token。请求/响应的字段定义在
> server/src/routes/*.ts 的 zod schema 与 docs/openapi.yaml 里——那两份才是结构的可信来源，
> 这里不复述，免得两份说法互相打脸。

## 调用约定

- 业务端点统一前缀 `/api/v1`；`/metrics` 是唯一挂在根上的非业务端点。
- 认证：`Authorization: Bearer <access token>`。`/api/v1/auth/refresh` 另接受 `X-Refresh-Token` 头，给存不了 cookie 的客户端（RN）用。
- 客户端标识：除下表标为「公开」的端点外，`/api/v1/*` 要求 `X-Client-Version`、`X-Client-Platform`、`X-Client-Channel`、`X-Client-Device-Id` 四个头，缺失返回 400 `missing_client_headers`。
- 正文语义：笔记内容以客户端加密后的密文信封传输，服务端不持有明文。
- 限流：写操作按用户 300 次/分钟；公开分享与解锁端点按 IP 单独更严；命中返回 429 并带 `Retry-After`。

- `GET /api/v1/update-manifest` 返回各端最新与最低支持版本；版本过低或被强制升级返回 410。

## 端点清单

共 **57** 条路由：公开 13 条、需 access token 44 条。认证=公开 指不要求 access token，但仍受客户端头校验与限流约束。

| 方法 | 路径 | 认证 | 所属路由 |
| --- | --- | --- | --- |
| GET | `/api/v1/account/export` | 需要 | accountRouter |
| DELETE | `/api/v1/account` | 需要 | accountRouter |
| POST | `/api/v1/auth/2fa/disable` | 需要 | authRouter |
| POST | `/api/v1/auth/2fa/enable` | 需要 | authRouter |
| POST | `/api/v1/auth/2fa/setup` | 需要 | authRouter |
| GET | `/api/v1/auth/2fa/status` | 需要 | authRouter |
| POST | `/api/v1/auth/lock` | 需要 | authRouter |
| POST | `/api/v1/auth/logout` | 需要 | authRouter |
| GET | `/api/v1/auth/me` | 需要 | authRouter |
| GET | `/api/v1/auth/recovery-params` | 公开 | authRouter |
| POST | `/api/v1/auth/refresh` | 公开 | authRouter |
| GET | `/api/v1/auth/status` | 公开 | authRouter |
| DELETE | `/api/v1/devices/:id` | 需要 | devicesRouter |
| DELETE | `/api/v1/devices` | 需要 | devicesRouter |
| GET | `/api/v1/devices` | 需要 | devicesRouter |
| POST | `/api/v1/diagnostics/reports` | 公开 | diagnosticsIngestRouter |
| DELETE | `/api/v1/diagnostics` | 公开 | diagnosticsIngestRouter |
| GET | `/api/v1/diagnostics` | 公开 | diagnosticsIngestRouter |
| POST | `/api/v1/diagnostics/reports` | 需要 | diagnosticsViewRouter |
| DELETE | `/api/v1/diagnostics` | 需要 | diagnosticsViewRouter |
| GET | `/api/v1/diagnostics` | 需要 | diagnosticsViewRouter |
| GET | `/api/v1/export/backup` | 需要 | exportRouter |
| GET | `/api/v1/export/notes/:id` | 需要 | exportRouter |
| DELETE | `/api/v1/folders/:id` | 需要 | foldersRouter |
| PATCH | `/api/v1/folders/:id` | 需要 | foldersRouter |
| GET | `/api/v1/folders` | 需要 | foldersRouter |
| POST | `/api/v1/folders` | 需要 | foldersRouter |
| GET | `/api/v1/health` | 公开 | healthRouter |
| DELETE | `/api/v1/notes/:id/permanent` | 需要 | notesRouter |
| POST | `/api/v1/notes/:id/versions/:versionId/restore` | 需要 | notesRouter |
| GET | `/api/v1/notes/:id/versions/:versionId` | 需要 | notesRouter |
| GET | `/api/v1/notes/:id/versions` | 需要 | notesRouter |
| DELETE | `/api/v1/notes/:id` | 需要 | notesRouter |
| GET | `/api/v1/notes/:id` | 需要 | notesRouter |
| PATCH | `/api/v1/notes/:id` | 需要 | notesRouter |
| GET | `/api/v1/notes` | 需要 | notesRouter |
| POST | `/api/v1/notes` | 需要 | notesRouter |
| GET | `/api/v1/preferences` | 需要 | preferencesRouter |
| PATCH | `/api/v1/preferences` | 需要 | preferencesRouter |
| DELETE | `/api/v1/shares/:id` | 公开 | publicSharesRouter |
| GET | `/api/v1/shares` | 公开 | publicSharesRouter |
| POST | `/api/v1/shares` | 公开 | publicSharesRouter |
| GET | `/api/v1/config/server-endpoint` | 公开 | serverConfigRouter |
| POST | `/api/v1/config/server-endpoint` | 公开 | serverConfigRouter |
| DELETE | `/api/v1/shares/:id` | 需要 | sharesRouter |
| GET | `/api/v1/shares` | 需要 | sharesRouter |
| POST | `/api/v1/shares` | 需要 | sharesRouter |
| DELETE | `/api/v1/note-tags` | 需要 | tagsRouter |
| POST | `/api/v1/note-tags` | 需要 | tagsRouter |
| DELETE | `/api/v1/tags/:id` | 需要 | tagsRouter |
| GET | `/api/v1/tags` | 需要 | tagsRouter |
| POST | `/api/v1/tags` | 需要 | tagsRouter |
| DELETE | `/api/v1/templates/:id` | 需要 | templatesRouter |
| PATCH | `/api/v1/templates/:id` | 需要 | templatesRouter |
| GET | `/api/v1/templates` | 需要 | templatesRouter |
| POST | `/api/v1/templates` | 需要 | templatesRouter |
| GET | `/api/v1/update-manifest` | 公开 | updateManifestRouter |

关于 docs/openapi.yaml：它当前描述 13 个 path 分组，与上表 57 条中的 19 条对得上。未覆盖部分是**已知缺口**：补齐要逐个核对真实响应体，凑数只会得到一份看起来完整的假文档。

## 错误响应

> 形如 { error: <机器码>, ... }。常见机器码：missing_client_headers、invalid_client_version、
> too_many_requests、too_many_writes、invalid_cursor、invalid_since、unauthorized、not_found、
> share_locked。完整集合以路由里的字符串常量为准——同样是为了不在文档里另立一套说法。
