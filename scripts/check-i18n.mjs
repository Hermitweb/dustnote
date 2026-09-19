#!/usr/bin/env node
/**
 * check-i18n.mjs — 校验 web/src 中所有 t('...') 调用的 key 都在 i18n.ts 中定义
 *
 * 用法：node scripts/check-i18n.mjs
 * 退出码：0 = 通过，1 = 有未定义的 key
 *
 * 实现思路：
 * 1. 用正则扫描 web/src 下所有 .ts/.tsx 文件，提取 t('key.path') / t("key.path") 调用
 * 2. 解析 web/src/lib/i18n.ts，递归收集 zh-CN.translation 下所有叶子 key 的完整路径
 * 3. 对比两个集合，输出未定义的 key
 *
 * 局限性：
 * - 仅支持静态字符串 key（不支持 t(variable) 动态 key）
 * - 嵌套对象的叶子节点视为 key（如 sidebar.batch.move）
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const WEB_SRC = new URL('../web/src/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const I18N_FILE = join(WEB_SRC, 'lib/i18n.ts');

// ========== 1. 扫描 t('...') 调用 ==========
function walkDir(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkDir(full));
    } else if (/\.(ts|tsx)$/.test(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

// 匹配 t('key') 或 t("key")，key 允许字母数字下划线和点
// 排除注释中的（简易处理：行内 // 之后的不算）
const T_CALL_RE = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

function collectUsedKeys() {
  const used = new Set();
  const files = walkDir(WEB_SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let m;
    while ((m = T_CALL_RE.exec(src)) !== null) {
      used.add(m[1]);
    }
  }
  return used;
}

// ========== 2. 解析 i18n.ts 中定义的 key ==========
function collectDefinedKeys() {
  const src = readFileSync(I18N_FILE, 'utf8');
  // 只取 zh-CN.translation 对象（第一个 translation: { ... }）
  // 用括号匹配提取对象字面量
  const translationIdx = src.indexOf('translation:');
  if (translationIdx < 0) {
    console.error('✗ 未找到 translation 块');
    process.exit(1);
  }
  // 从 translation: 后第一个 { 开始括号匹配
  let i = src.indexOf('{', translationIdx);
  const keys = new Set();
  const stack = [];
  let path = [];

  // 逐字符扫描，遇到 key: 标识符压栈，遇到 { 进入下一层，遇到 } 弹栈
  // 简易解析：匹配 `key: {` 或 `'key': {` 进入子对象，`key: 'value'` 是叶子
  const KEY_RE = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g;

  // 用栈式解析：记录当前路径，遇到 { 压入，} 弹出
  let depth = 0;
  let pos = i;
  // 先找到起始 {
  while (pos < src.length && src[pos] !== '{') pos++;
  const startBrace = pos;

  // 递归解析对象
  function parseObject(idx) {
    // idx 指向 { 的位置
    let p = idx + 1;
    const localKeys = new Set();
    while (p < src.length) {
      // 跳过空白和注释
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src[p] === '}') return { next: p + 1, keys: localKeys };

      // 读取 key（标识符 或 带引号字符串）
      let key = '';
      if (src[p] === "'" || src[p] === '"') {
        const q = src[p];
        p++;
        while (p < src.length && src[p] !== q) {
          key += src[p];
          p++;
        }
        p++; // 跳过结束引号
      } else {
        while (p < src.length && /[a-zA-Z0-9_]/.test(src[p])) {
          key += src[p];
          p++;
        }
      }

      // 跳过空白和冒号
      while (p < src.length && /[\s:]/.test(src[p])) p++;

      if (src[p] === '{') {
        // 嵌套对象：递归
        const child = parseObject(p);
        for (const k of child.keys) {
          localKeys.add(`${key}.${k}`);
        }
        p = child.next;
      } else {
        // 叶子值：可能是字符串、数字、布尔等
        // 必须正确跳过字符串内的 } 和 ,（如 "{{count}}" 含 }）
        localKeys.add(key);
        if (src[p] === "'" || src[p] === '"') {
          const q = src[p];
          p++; // 进入字符串
          while (p < src.length && src[p] !== q) {
            if (src[p] === '\\') p++; // 跳过转义字符
            p++;
          }
          p++; // 跳过结束引号
        } else {
          // 非字符串字面量（数字/布尔）— 跳到逗号或 }
          while (p < src.length && src[p] !== ',' && src[p] !== '}') p++;
        }
      }

      // 跳过逗号
      while (p < src.length && /[\s,]/.test(src[p])) p++;
    }
    return { next: p, keys: localKeys };
  }

  const result = parseObject(startBrace);
  return result.keys;
}

// ========== 3. 对比 ==========
const used = collectUsedKeys();
const defined = collectDefinedKeys();

const missing = [...used].filter((k) => !defined.has(k));

let failed = false;
if (missing.length === 0) {
  console.log(`✓ web i18n 校验通过：${used.size} 个 key 全部已定义`);
} else {
  failed = true;
  console.error(`✗ web i18n 校验失败：${missing.length} 个 key 未定义：`);
  for (const k of missing.sort()) {
    console.error(`  - ${k}`);
  }
}

// ========== 4. 审计 ARCH-008：mobile / miniprogram 词典中英对称性 ==========
// 词典文件是「import + 单个 export 对象字面量」的 TS，提取 export 后第一个
// 对象的叶子 key 集合，比对 zh-CN 与 en 的对称性（此前两端的键漂移无门禁）。
function extractLeafKeys(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  // 词典结构为「import + 注释 + const zhCN = { ... }; export default zhCN」：
  // 剥掉块注释/行注释/import 行后，取第一个「= {」对象字面量
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^import[^;\n]*;?\s*$/gm, '');
  const eq = src.search(/=\s*\{/);
  if (eq < 0) throw new Error('未找到导出的对象字面量');
  const start = src.indexOf('{', eq);
  const keys = new Set();

  function scan(startIdx, prefix) {
    let p = startIdx + 1;
    while (p < src.length) {
      while (p < src.length && /[\s,]/.test(src[p])) p++;
      if (src[p] === '}') return p + 1;
      if (src[p] === '/' && src[p + 1] === '/') {
        while (p < src.length && src[p] !== '\n') p++;
        continue;
      }
      let key = '';
      if (src[p] === "'" || src[p] === '"') {
        const q = src[p];
        p++;
        while (p < src.length && src[p] !== q) {
          key += src[p];
          p++;
        }
        p++;
      } else {
        while (p < src.length && /[a-zA-Z0-9_]/.test(src[p])) {
          key += src[p];
          p++;
        }
      }
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src[p] !== ':') {
        // 无法识别的片段：跳到逗号/闭括号
        while (p < src.length && src[p] !== ',' && src[p] !== '}') p++;
        continue;
      }
      p++;
      while (p < src.length && /\s/.test(src[p])) p++;
      const full = prefix ? `${prefix}.${key}` : key;
      if (src[p] === '{') {
        p = scan(p, full);
      } else {
        keys.add(full);
        if (src[p] === "'" || src[p] === '"') {
          const q = src[p];
          p++;
          while (p < src.length && src[p] !== q) {
            if (src[p] === '\\') p++; // 跳过转义
            p++;
          }
          p++;
        } else {
          while (p < src.length && src[p] !== ',' && src[p] !== '}') p++;
        }
      }
      while (p < src.length && /[\s,]/.test(src[p])) p++;
    }
    return p;
  }

  scan(start, '');
  return keys;
}

const PARITY_TARGETS = [
  { name: 'mobile', zh: 'mobile/src/locales/zh-CN.ts', en: 'mobile/src/locales/en.ts' },
  { name: 'miniprogram', zh: 'miniprogram/src/locales/zh-CN.ts', en: 'miniprogram/src/locales/en.ts' },
];

for (const t of PARITY_TARGETS) {
  try {
    const zh = extractLeafKeys(t.zh);
    const en = extractLeafKeys(t.en);
    const onlyZh = [...zh].filter((k) => !en.has(k));
    const onlyEn = [...en].filter((k) => !zh.has(k));
    if (onlyZh.length === 0 && onlyEn.length === 0) {
      console.log(`✓ ${t.name} 词典中英对称：${zh.size} 个 key`);
    } else {
      failed = true;
      console.error(
        `✗ ${t.name} 词典中英不对称：zh 独有 ${onlyZh.length} 个，en 独有 ${onlyEn.length} 个`
      );
      for (const k of onlyZh.slice(0, 10)) console.error(`  - 仅 zh: ${k}`);
      for (const k of onlyEn.slice(0, 10)) console.error(`  - 仅 en: ${k}`);
    }
  } catch (err) {
    failed = true;
    console.error(`✗ ${t.name} 词典解析失败：${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
