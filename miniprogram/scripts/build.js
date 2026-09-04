const { spawnSync } = require('child_process');

const target = process.argv[2];
const isDev = process.argv[3] === '--watch';

const ALLOWED_TARGETS = ['weapp', 'swan', 'alipay', 'tt', 'jd', 'qq', 'h5'];
if (!target || !ALLOWED_TARGETS.includes(target)) {
  console.error('Usage: node scripts/build.js <target> [--watch]');
  console.error('Targets: weapp, swan, alipay, tt, jd, qq, h5');
  process.exit(1);
}

// Taro's webpack 5 build uses crypto hashes that require legacy OpenSSL
// providers on Node.js 17+ (especially Node.js 24 on Windows).
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --openssl-legacy-provider';
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS.trim();

const taroBin = require.resolve('@tarojs/cli/bin/taro');
const args = ['build', '--type', target];
if (isDev) {
  args.push('--watch');
}

const result = spawnSync(process.execPath, [taroBin, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

process.exit(result.status ?? 1);
