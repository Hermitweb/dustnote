const { spawnSync } = require('child_process');
const path = require('path');

// gradle 任务只允许脚本调用方（package.json scripts）用到的固定字面量。
// argv 值必须**引用等于**白名单常量才进 spawnSync——交给 shell 的值恒为模块
// 内字面量，外部输入不可达（Mimosa「不可信解释器输入」整改，2026-09-24）。
const ALLOWED_TASKS = ['assembleRelease', 'bundleRelease', 'assembleDebug'];
const requested = process.argv[2] || 'assembleRelease';
const task = ALLOWED_TASKS.find((t) => t === requested);
if (!task) {
  console.error(`[build-android] 非法 gradle 任务名: ${JSON.stringify(requested)}`);
  process.exit(1);
}
const isWin = process.platform === 'win32';
const cmd = isWin ? 'gradlew.bat' : './gradlew';

const result = spawnSync(cmd, [task], {
  cwd: path.resolve(__dirname, '..', 'android'),
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
