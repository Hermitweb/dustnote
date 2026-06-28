# Cookie 政策

> 最后更新：2026-06-27

## 什么是 Cookie

Cookie 是浏览器存储的小型文本文件，用于识别你的会话。MintNote 严格限制 Cookie 使用。

## 我们使用的 Cookie

| 名称 | 类型 | 用途 | 有效期 |
|------|------|------|--------|
| `mn_access` | httpOnly + Secure | Access Token | 15 分钟 |
| `mn_refresh` | httpOnly + Secure + SameSite=Strict | Refresh Token | 7 天 |
| `mn_csrf` | SameSite=Strict | CSRF 防护 | 会话 |
| `mn_theme` | 第一方 | 主题偏好 | 365 天 |

## 不使用的 Cookie

- ❌ 任何第三方追踪 Cookie
- ❌ 任何广告 Cookie
- ❌ 任何分析 Cookie

## 你的选择

- 浏览器设置可清除所有 Cookie
- 清除后需重新登录
- 严格必要 Cookie（mn_access、mn_refresh）不支持关闭，关闭将无法登录

## 移动端对应

移动端不使用 Cookie，而是使用 Keychain（iOS）/ EncryptedSharedPreferences（Android）存储 Token，安全性更高。

## 联系方式

如有疑问：[privacy@mintnote.app](mailto:privacy@mintnote.app)
