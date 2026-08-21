# Android 签名证书配置

DustNote Android 构建使用正式签名证书（RSA 2048-bit，有效期 10000 天 ≈ 27 年）。
本文档说明本地开发与 CI 两种环境下的证书配置方式。

## 证书信息

| 项           | 值                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------- |
| 别名 (alias) | `dustnote`                                                                                        |
| 算法         | RSA 2048-bit + SHA256withRSA                                                                      |
| DN           | `CN=DustNote, OU=Mobile App, O=DustNote Project, L=Beijing, ST=Beijing, C=CN`                     |
| 有效期       | 2026-07-29 ~ 2053-12-14                                                                           |
| SHA-1        | `F5:CA:7D:07:C5:63:A1:6C:BD:DF:4F:22:36:42:8B:28:BA:BE:DD:EC`                                     |
| SHA-256      | `85:45:EC:10:64:78:33:A8:C0:53:13:B7:E0:BC:D2:01:CC:19:47:F3:3D:B1:B7:6C:D0:4A:F3:3C:A6:42:51:7D` |

> ⚠️ **证书一旦用于线上发布，必须妥善保管 keystore 文件与密码。**
> 丢失后无法为已发布的应用发布更新（Android 要求升级包使用同一证书签名）。

## 本地开发

签名凭据已写入 `mobile/android/keystore.properties`（gitignored）：

```properties
storeFile=dustnote-release.keystore
storePassword=<生成时随机产生的密码>
keyAlias=dustnote
keyPassword=<生成时随机产生的密码>
```

`mobile/android/app/build.gradle` 会按以下优先级解析 release 签名：

1. **环境变量**（CI 优先）：`DUSTNOTE_STORE_FILE` / `DUSTNOTE_STORE_PASSWORD` / `DUSTNOTE_KEY_ALIAS` / `DUSTNOTE_KEY_PASSWORD`
2. **keystore.properties**（本地开发）：`mobile/android/keystore.properties`
3. **回退到 debug 签名**：`assembleRelease` 仍可执行，但产物不可用于生产分发

> keystore 文件位于 `mobile/android/app/dustnote-release.keystore`，已被 `.gitignore` 排除。

### 重新生成证书（仅在新项目或证书过期时）

```powershell
# 生成强随机密码
$chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
$password = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })

# 生成 keystore
keytool -genkeypair -v `
  -keystore mobile/android/app/dustnote-release.keystore `
  -alias dustnote -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $password -keypass $password `
  -dname "CN=DustNote, OU=Mobile App, O=DustNote Project, L=Beijing, ST=Beijing, C=CN"

# 写入凭据文件
@"
storeFile=dustnote-release.keystore
storePassword=$password
keyAlias=dustnote
keyPassword=$password
"@ | Set-Content -Path mobile/android/keystore.properties -NoNewline
```

## CI（GitHub Actions）

`release.yml` 的 `build-mobile` job 从 GitHub Secrets 读取证书。需要在仓库
**Settings → Secrets and variables → Actions** 中配置以下 Secrets：

| Secret 名                   | 值                                            |
| --------------------------- | --------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | keystore 文件的 base64 编码（见下方生成方法） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码                                 |
| `ANDROID_KEY_ALIAS`         | `dustnote`                                    |
| `ANDROID_KEY_PASSWORD`      | key 密码（通常与 store 密码相同）             |

### 生成 base64 编码

**Windows PowerShell**：

```powershell
$bytes = [System.IO.File]::ReadAllBytes("mobile/android/app/dustnote-release.keystore")
[System.Convert]::ToBase64String($bytes) | Set-Content -Path keystore.b64 -NoNewline
# 复制 keystore.b64 内容到 GitHub Secret ANDROID_KEYSTORE_BASE64
Get-Content keystore.b64 | Set-Clipboard
```

**Linux / macOS**：

```bash
base64 -w 0 mobile/android/app/dustnote-release.keystore  # 输出复制到 GitHub Secret
```

### CI 工作流行为

- 配置了 Secrets → 使用 release 证书签名，APK 可分发
- 未配置 Secrets → 输出 `::warning::` 并回退到 debug 签名（APK 仍可构建，但不可用于生产分发）

## 验证签名

构建完成后验证 APK 签名：

```bash
# 方式 1：apksigner（推荐）
apksigner verify --print-certs app-release.apk

# 方式 2：jarsigner（旧）
jarsigner -verify -verbose -certs app-release.apk
```

输出应包含与本文档顶部一致的 SHA-1 / SHA-256 指纹。
