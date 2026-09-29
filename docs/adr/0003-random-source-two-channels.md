# 0003 · 随机源分两通道：密钥材料 vs nonce

状态：生效（2026-09-29）

## 背景

小程序没有 WebCrypto，安全随机靠 wx API 预填充的池，同步取用。池耗尽时（开发者工具模拟器上
wx API 整体不可用）代码会退化到「时间戳+计数器+Math.random」，只 console.warn 一句。
「长期密钥不得走降级路径」当时只是一条注释约定，靠调用方记得先 `await ensureRandomReady()`。

第一版修法把它改成 `randomBytes(n, { uniquenessOnly })`：调用方必须声明用途。设计确实更严，
但合并后 main 的 CodeQL 复测显示那三条 `insecure-randomness` **一条都没关**——因为两个分支的
返回值汇成同一个变量，`Math.random` 到 `deriveSecrets(salt)` 的路径在图上照旧连通。

## 决策

拆成两个通道：

- `randomBytes()` 严格：WebCrypto → 注入的强随机源 → noble，拿不到就抛错，永不降级；
- `randomUniqueBytes()` 是**唯一**能看到弱兜底的地方，全仓只有一处调用：AES-GCM 的 IV；
- 注入侧同样分两个源注册（`setSecureRandomSource` / `setUniquenessRandomSource`）。

## 后果

- 弱随机在调用图上到不了密钥路径：约束由结构保证，不再依赖阅读注释的自觉。
- 模拟器上的密钥生成从「静默弱密钥」变成「明确失败」。这是刻意的可用性退化：宁可不能建号，
  也不要产出一个看着正常、实际可预测的主密钥。
- IV 通道的兜底字节仍由 `Math.random` 参与，但只用于唯一性，且计数器改为随机起点，
  避免「重启 + 时钟回拨 → 同毫秒同 IV」这种真实可复现的 GCM 灾难。
- 代价：多一个公开 API 与一条注释纪律（新代码不得用 `randomUniqueBytes` 派生密钥）。

证据：`shared/src/crypto.ts`、`miniprogram/src/lib/crypto-polyfill.ts`、
`shared/test/crypto.test.ts` 的强度契约用例（变异验证会把它跑红）。
