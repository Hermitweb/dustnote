const fs = require('fs');
const path = require('path');

const targetDirs = ['docs', '.trae/documents'];
const extensions = ['.md', '.yml', '.yaml'];

const replacements = [
  [/mintnote\.app/g, 'dustnote.app'],
  [/github\.com\/your-org\/mintnote/g, 'github.com/your-org/dustnote'],
  [/ghcr\.io\/your-org\/mintnote/g, 'ghcr.io/your-org/dustnote'],
  [/ghcr\.io\/\.\.\.\/mintnote/g, 'ghcr.io/.../dustnote'],
  [/\b@mintnote\.app\b/g, '@dustnote.app'],
  [/data\/mintnote\.db/g, 'data/dustnote.db'],
  [/\/data\/mintnote\.db/g, '/data/dustnote.db'],
  [/\bmintnote\.db\b/g, 'dustnote.db'],
  [/\bmintnote-nginx\b/g, 'dustnote-nginx'],
  [/\b\/opt\/mintnote\b/g, '/opt/dustnote'],
  [/\b~\/mintnote\b/g, '~/dustnote'],
  [/\bhttp:\/\/mintnote:3210\b/g, 'http://dustnote:3210'],
  [/\bcontainer_name: mintnote\b/g, 'container_name: dustnote'],
  [/\bMintNote\b/g, 'DustNote'],
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (extensions.includes(path.extname(entry.name))) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const original = content;
      for (const [pattern, replacement] of replacements) {
        content = content.replace(pattern, replacement);
      }
      // 处理 YAML 服务名：行首的 "mintnote:"（作为服务名）
      content = content.replace(/^(\s*)mintnote:(\s*)$/gm, '$1dustnote:$2');
      // 处理 docker compose 服务依赖中的 "- mintnote"
      content = content.replace(/^\s+- mintnote\s*$/gm, (match) =>
        match.replace('mintnote', 'dustnote')
      );
      // 处理 docker compose stop/start/restart/logs 命令中的 mintnote
      content = content.replace(/\bmintnote\b(?=\s|$|[\s:;])/g, 'dustnote');
      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log('Updated:', fullPath);
      }
    }
  }
}

for (const dir of targetDirs) {
  if (fs.existsSync(dir)) walk(dir);
}
