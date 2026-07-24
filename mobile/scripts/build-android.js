const { spawnSync } = require('child_process');
const path = require('path');

const task = process.argv[2] || 'assembleRelease';
const isWin = process.platform === 'win32';
const cmd = isWin ? 'gradlew.bat' : './gradlew';

const result = spawnSync(cmd, [task], {
  cwd: path.resolve(__dirname, '..', 'android'),
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
