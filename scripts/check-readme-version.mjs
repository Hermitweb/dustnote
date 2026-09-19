// 审计 DOC-005：防止 README 状态徽章版本与 package.json 实际版本长期漂移。
// 用法：node scripts/check-readme-version.mjs
// 逻辑：读取根 package.json 的 version，与 README.md 里 status-vX.Y.Z 徽章比对；
//       不一致则以退出码 1 失败并提示。仅本地/CI 校验，无副作用。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const match = readme.match(/status-v(\d+\.\d+\.\d+)/);
if (!match) {
  console.error('❌ README.md 未找到 status-vX.Y.Z 徽章，无法校验版本一致性。');
  process.exit(1);
}
const badge = match[1];
if (badge !== pkg.version) {
  console.error(
    `❌ 版本漂移：README 徽章 v${badge} ≠ package.json v${pkg.version}。` +
      ` 发布后请同步 README 徽章（或改由 CI 自动注入）。`,
  );
  process.exit(1);
}
console.log(`✅ README 徽章版本与 package.json 一致：v${pkg.version}`);
