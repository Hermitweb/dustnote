# 安全策略

## 支持的版本

| 版本              | 支持     |
| ----------------- | -------- |
| 最新 v2.x         | ✅       |
| 上一稳定版        | ✅ 90 天 |
| 更早版本 / v1.x   | ❌       |

## 报告漏洞

**请勿在公开 Issue 报告安全问题。**

首选通道：**GitHub Private Vulnerability Reporting（私密漏洞报告）**

👉 [报告安全漏洞（Private Vulnerability Reporting）](https://github.com/Hermitweb/dustnote/security/advisories/new)

- 仅仓库维护者可见，全程保密
- 便于直接关联修复 PR 与 Security Advisory 公告
- 无需 PGP 即可端到端私密沟通

备用通道：仓库所有者的 GitHub 账号私信（[Hermitweb](https://github.com/Hermitweb)）。

报告时请附：

- 漏洞描述与复现步骤
- 影响范围与潜在危害
- 概念验证代码（PoC）
- 您的联系方式（可选，用于致谢）

我们承诺：

- **72 小时内**确认收到
- **7 天内**给出评估与修复时间表
- 修复后**致谢**（如您愿意）
- 漏洞披露前不公开技术细节

> 说明：本项目的联系邮箱随域名注册状态调整，**GitHub Private
> Vulnerability Reporting 是唯一长期保证可达的通道**，请优先使用。

## 严重等级

| 等级 | 含义                            | 修复 SLA |
| ---- | ------------------------------- | -------- |
| P0   | 服务端可被入侵 / 主密码可被解密 | 4 小时   |
| P1   | 数据泄露 / 越权访问             | 24 小时  |
| P2   | 信息泄露 / DoS                  | 7 天     |
| P3   | 增强项                          | 随版本   |

## 致谢

我们感谢以下安全研究者的贡献（按时间排序）：

_待添加_

## 安全公告

历史公告与修复版本见 [GitHub Security Advisories](https://github.com/Hermitweb/dustnote/security/advisories)。
