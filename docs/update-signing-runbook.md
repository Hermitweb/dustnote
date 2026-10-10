# 更新链路信任根实施手册（minisign 验签 + 代码签名）

> 目标读者：维护者本人或 backup maintainer。这是 roadmap R1「更新验签 / 安装包签名」两条的
> **实施手册**——私钥与证书必须由人生成并保管，代码与 CI 面能预先落地的部分已盘点在此，
> 按本手册执行即可完成闭环，不需要临时考古。
>
> 现状（2026-10-11 实测）：桌面端自更新 = `update-manifest`（自建服务器，含真实 SHA-256）
> → GitHub Releases / 自托管 `/downloads/` 直链下载 → Rust 侧 fail-closed SHA-256 校验 →
> NSIS 向导。**信任根是 manifest 本身**（`security-model.md §2.5`）——服务器被攻破即投毒，
> 这就是本手册要消除的最后一块短板。

## 0. 信任链分层与现状对照

| 层         | 防什么                     | 现状                                           | 目标                              |
| ---------- | -------------------------- | ---------------------------------------------- | --------------------------------- |
| 传输       | 中间人窃听/篡改            | ✅ HTTPS（napi.iniess.cn，Let's Encrypt）      | 维持                              |
| 完整性     | 下载损坏/静态替换          | ✅ SHA-256 fail-closed（`lib.rs:87-130`）      | 维持                              |
| 来源白名单 | 误配置/任意 URL 下载       | ✅ origin 归一化白名单（`updater.ts:181-198`） | 维持（见 §3 硬编码收口）          |
| **签名**   | **服务器被攻破即投毒**     | ❌ 信任根 = manifest 所在服务器                | minisign：私钥离线，公钥进客户端  |
| **OS 级**  | 安装包被杀软/Gatekeeper 拦 | ❌ Windows 未签名 / macOS 未签名未公证         | OV 证书 / Developer ID + notarize |

关键认知：**minisign 与代码签名互补，不可互替**——前者验证「这份产物是维护者签发的」
（防服务器沦陷），后者让 OS 信任「这个二进制可安装」（防拦截与同签名覆盖攻击，
Android 侧 SEC-001 已用 release keystore 堵住同款问题）。

## 1. minisign 更新验签（Tauri v2 内置 updater 不可用的原因与替代路径）

> 本项目**没有**用 `tauri-plugin-updater`（`tauri.conf.json` plugins 为空），
> 而是自研下载链路（`desktop/src-tauri/src/lib.rs` + `desktop/src/lib/updater.ts`）。
> 因此不采用 tauri 官方的 updater 签名体系（它要求迁移到官方插件），
> 而是在现有链路上加 minisign——改动面最小、且 Android/服务器侧可复用同一验签思路。

### 1.1 密钥生成与保管（一次性，人工执行）

```bash
# 在维护者离线机器上（不要在 CI / 服务器上生成！）
cargo install minisign-verify --locked  # 或系统包管理器装 minisign
minisign -G  # 交互生成密钥对
#  → minisign-key.pub（公开，随仓库提交）
#  → minisign.key（私钥，密码保护；进密码管理器 + 离线备份一份）
```

- 公钥 `minisign-key.pub` 提交进仓库根或 `desktop/`；
- 私钥**永不**进 CI、不进服务器。签名在维护者本机完成后只上传签名文件。

### 1.2 发布流程改动（release.yml + 手动步骤）

发版产物就位后（当前流程：`tag push` → CI 构建 → Create Release → 服务器
`/opt/dustnote-downloads/`），增加一步**人工签名**：

```bash
# 对每个进入 update-manifest 的安装包（exe/msi/dmg/apk）
minisign -Sm DustNote_x.y.z_x64-setup.exe -s minisign.key
#  → 产出 DustNote_x.y.z_x64-setup.exe.minisig（分离签名）
# 上传 .minisig 与产物同目录；update-manifest 服务读取并附进清单
```

> 为什么人工签而不进 CI：私钥进 GitHub Secrets 后，任何能改 release.yml 的人
> （或 Actions 缓存投毒）都能签出「合法」恶意包——签名就失去意义。
> 巴士因子代价：backup maintainer 需要拿到私钥副本，见 `handover.md`。

### 1.3 代码改动清单（均为小 diff）

| 文件                                     | 改动                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/update-manifest.ts` | `artifactFor()` 旁增加读取 `<file>.minisig`（base64），artifact 增加 `signature` 字段（缺签名文件 → 字段缺省，见 1.4 过渡期策略）                                                                                                                                   |
| `shared/src/api.ts`                      | UpdateManifest artifact schema 增加 optional `signature: string`                                                                                                                                                                                                    |
| `desktop/src-tauri/src/lib.rs`           | `download_and_run_installer` 增加 `expected_signature` 参数；下载完成后先用仓库内嵌公钥 `minisign_verify(pubkey, file, sig)`（crates.io: `minisign-verify`，纯 Rust 验证、无网络），**验签失败删除文件并拒绝**（fail-closed 同 SHA-256 现状）；验签通过再做 SHA-256 |
| `desktop/src/lib/updater.ts`             | 透传 manifest 的 `signature` 到 invoke；缺签名 + `strictVerify` 配置开 → 抛错                                                                                                                                                                                       |
| `desktop` 前端设置页                     | `strictVerify` 开关（默认开；关闭仅用于开发调试，生产构建硬编码 true）                                                                                                                                                                                              |

公钥内嵌方式（防替换）：`include_str!("../../minisign-key.pub")` 编译进二进制，
与 `CARGO_PKG_VERSION` 注入同款机制。

### 1.4 过渡期策略（不破坏存量客户端）

分两个版本窗口：

1. **N 版**：manifest 附 `signature`，老客户端忽略之；新客户端验签失败则报错
   （此时签名已全量覆盖，不应对缺失宽容）。
2. 服务器产物目录**首个全量签名版本**起，`update-manifest` 对**存在产物但缺
   `.minisig`** 的条目 log warn——运维信号，提示签名流程掉链子。

### 1.5 Android 侧

APK 已有 release keystore 签名（SEC-001 已收口，CI 拒绝 debug 签名发版）。
minisign 对 APK 属冗余，**不做**；但 `update-manifest` 的 APK artifact hash 校验
链路与桌面共用，天然受益。

## 2. Windows 代码签名（OV 先行，EV 可后置）

### 2.1 证书选购

| 项         | OV（推荐先走）    | EV                                                                 |
| ---------- | ----------------- | ------------------------------------------------------------------ |
| 防杀软误报 | 部分              | 更快建立信誉                                                       |
| 私钥保管   | 硬盘/硬件可选     | 强制硬件 token / 云签名（Azure Trusted Signing / SSL.com eSigner） |
| 成本       | 低（~$70-200/年） | 高（~$300-500/年）                                                 |
| 立即可用   | 是                | 个人开发者需企业身份核验                                           |

> 2023 起 CAs 逐步强制硬件保管；**Azure Trusted Signing**（$9.99/月）是个人开发者
> 现实可行路径，CI 集成最简单（`azure/trusted-signing-action`）。

### 2.2 CI 集成点（release.yml）

Windows 构建步骤在 `build-desktop` job（`windows-latest`，`pnpm tauri build`）。
Tauri v2 原生支持签名配置，两种接法：

**方案 A（推荐）— Azure Trusted Signing**：

```yaml
# build-desktop 的 windows 步骤 env 增加：
env:
  AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
  AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
  AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
# tauri.conf.json 增加：
# "windows": { "certificateThumbprint": null, "signCommand": "trusted-signing-cli sign %1" }
```

**方案 B — 本地 OV 证书（PFX）**：

```yaml
env:
  WINDOWS_PFX_BASE64: ${{ secrets.WINDOWS_PFX_BASE64 }}
  WINDOWS_PFX_PASSWORD: ${{ secrets.WINDOWS_PFX_PASSWORD }}
run: |
  echo "$WINDOWS_PFX_BASE64" | base64 -d > cert.pfx
  # tauri.conf.json: bundle.windows.certificateThumbprint 由签名后导入证书库获得
  # 或用 signtool 后签：signtool sign /f cert.pfx /p $PFX /tr http://timestamp.digicert.com /fd sha256 <exe|msi>
```

> **必须加时间戳**（`/tr` RFC3161）：证书过期后已签名产物仍有效；漏时间戳 =
> 证书一换所有历史安装包全部告警。
> NSIS 安装器与 MSI 都要签（`--bundles nsis msi` 两个产物），portable 裸 exe
> 同样要签——它也在发版产物里。

### 2.3 验收

- [ ] 全新 Windows 机器安装不再弹 SmartScreen「未知发布者」（OV 需要信誉积累，前期仍可能弹但可点「仍要运行」且无「发布者：未知」）
- [ ] `Get-AuthenticodeSignature DustNote-setup.exe` → Status: Valid
- [ ] 证书轮换演练：用新证书签的包可覆盖安装旧包（同 subject 升级链不断）

## 3. macOS 签名 + 公证（需 Apple Developer 账号，$99/年）

### 3.1 前置

- Apple Developer Program 账号（个人可）；
- 一台 Mac（本地或 CI macos-latest runner 均可，GitHub 托管 runner 支持）；
- Xcode 中创建 **Developer ID Application** 证书（注意不是 Mac Development），
  导出 `.p12`。

### 3.2 CI 集成

```yaml
# release.yml build-desktop 的 macos 步骤 env：
env:
  APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }} # base64(p12)
  APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  APPLE_SIGNING_IDENTITY: 'Developer ID Application: <Name> (TEAMID)'
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }} # app-specific password
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
# Tauri v2 检测到 APPLE_CERTIFICATE 环境变量时自动签名+notarize（app 与 dmg 均处理）
```

### 3.3 验收

- [ ] `spctl -a -t exec DustNote.app` → accepted
- [ ] `xcrun stapler validate DustNote.dmg` → valid
- [ ] 全新 macOS（无开发者账号用户）首次打开不再需要「右键打开」

## 4. 白名单硬编码收口（伴随验签的代码面收紧）

roadmap R1 提到 `allowed_prefixes` 改 Rust 硬编码。现状：前端 `updater.ts:194-197`
下发白名单（GitHub 前缀 + 用户配置的 serverUrl origin）。minisign 落地后，
**签名成为真正的信任根**，白名单退化为防误配置的第一层，可按序收口：

1. `lib.rs` 把 GitHub Releases 前缀硬编码为常量（已有 `INSTALLER_URL_PREFIX`），
   前端传入的 `allowedPrefixes` 改为**仅允许追加服务器 origin**（不能覆盖 GitHub 项）；
2. 用户配置的 serverUrl origin 仍需保留（自托管下载直链场景，`update-manifest`
   产物在 `/opt/dustnote-downloads`）；
3. 验签落地后可在设置页展示「最近一次更新的签名验证结果」（可观测性）。

## 5. 执行顺序建议（依赖排序）

```
1. minisign 密钥生成 + 公钥入库（人工，30 分钟）
2. update-manifest 附 signature + schema 扩展（服务端，半天）
3. lib.rs 验签 + updater.ts 透传（桌面端，半天 + 回归）
4. 发版窗口全量签名一次产物（人工，随下一次发版）
5. Windows Trusted Signing 注册 + CI 接入（需 Azure 订阅，半天）
6. Apple Developer 注册 + macOS 签名公证（需 Mac 验证，半天）
7. 白名单硬编码收口（最后做，1 小时）
```

第 1-4 步消除「服务器沦陷即投毒」；第 5-6 步消除 OS 层拦截与信任消耗。
任一步独立可交付，不互相阻塞。

## 6. 修订

- 2026-10-11：初版。基于 lib.rs / updater.ts / release.yml / security-model.md §2.5 实测盘点。
