# 0002 · 默认 KDF 用 PBKDF2，历史 Argon2id 账号继续可解锁

状态：生效（v2.3.5 起）

## 背景

早期默认 Argon2id。实测 Hermes 引擎上 `@noble/hashes/argon2`（纯 JS，无 JIT）跑 8MB 参数要
60 秒以上，浏览器主线程 1–3 秒；而移动端锁屏后解锁等待是不可接受的。

## 决策

新账号默认 `PBKDF2-SHA256 × 100000`：web/desktop 走 WebCrypto 原生 `deriveBits`，mobile 走
quick-crypto 原生绑定，小程序退到纯 JS 也在 1–2 秒量级。Argon2id 分支**保留不删**，因为历史
账号的派生参数已随账号记录在服务端，删掉等于让老用户解不开自己的笔记。

## 后果

- 安全性上 PBKDF2-100k 对在线爆破的抵抗弱于同等记忆的 Argon2id，这是明确接受的取舍：换来的是
  「三端都能用同一套代码解锁」。账号另有 TOTP、锁定与限流补偿。
- 必须永远存在两条派生路径，任何「统一参数」的改动都要考虑历史账号；因此派生参数写进记录、
  不做静默迁移，是本决定的硬约束。
- 文档不能只写「我们用了 Argon2」，必须同时说明历史与现状。

证据：`shared/src/crypto.ts` 的 `KDF_PARAMS` 与其上注释、`docs/compatibility-matrix.md`。
