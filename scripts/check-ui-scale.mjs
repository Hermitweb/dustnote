/**
 * UI 尺度门禁（pnpm ui:check）
 *
 * 动因不是"风格洁癖"，是这次实测到的三件事：
 *  1. `--mn-text-*` / `--mn-space-*` 令牌定义了，但 Tailwind 类名从不读它们——
 *     于是设置里的"密度"只有行高在动，字号与间距是假的。一个看起来能调、
 *     调了什么都没变的开关，比没有开关更糟。
 *  2. 79 处 `transition-*` 没有一处写时长，全部吃掉 Tailwind 内置 150ms，
 *     而令牌里躺着 120/180/240 三档没人用。
 *  3. 13 处 `outline-none` 静默掐掉了全局焦点环（且按层叠顺序它们真的赢），
 *     键盘用户在搜索框、编辑器、解锁屏上看不到焦点。
 *
 * 所以这里既扫"越界类名"，也扫"接线是否还在"——后者才是防复发的关键：
 * 只扫类名的话，谁把 fontSize 映射从配置里删掉都不会有人知道。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 允许出现 outline-none 的位置（必须写理由，避免变成通用逃避口） */
export const OUTLINE_NONE_ALLOWLIST = [
  {
    file: 'web/src/App.tsx',
    reason: '主区滚动容器（tabIndex=-1 供程序聚焦），不是控件，无需焦点环',
  },
];

const SCALE_RULES = [
  {
    id: 'z-arbitrary',
    re: /\bz-\[/g,
    hint: '用 z-index 阶梯具名值（drawer/overlay/confirm/nested/stacked/toast/system），不要现场猜数字',
  },
  {
    id: 'text-arbitrary',
    re: /\btext-\[[\d.]+px\]/g,
    hint: '用字号阶梯 text-2xs/xs/sm/base/lg/xl/2xl…，硬编码 px 不随密度变',
  },
  {
    id: 'radius-arbitrary',
    re: /\brounded-\[/g,
    hint: '用 rounded-sm/md/lg/xl（四档由 --mn-radius-* 给值）',
  },
  {
    id: 'space-arbitrary',
    re: /\b(?:p|m|gap)-(?:x-|y-)?\[[\d.]+(?:px|rem)\]/g,
    hint: '用间距阶梯，硬编码值不随密度变',
  },
  {
    id: 'duration-numeric',
    re: /\bduration-\d+\b/g,
    hint: '用 duration-fast / -med / -slow（120/180/240ms 由令牌给）',
  },
  {
    id: 'transition-all',
    re: /\btransition-all\b/g,
    hint: '点名要过渡的属性：transition 或 transition-[width] 等；all 会把布局一起过渡',
  },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (/\.(tsx|jsx)$/.test(e.name)) out.push(fp);
  }
  return out;
}

/** 扫组件源码里的越界尺度类名。纯函数：给它文件名与内容即可测。 */
export function scanClassDiscipline(relFile, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of SCALE_RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) {
        findings.push({
          rule: rule.id,
          file: relFile,
          line: i + 1,
          hint: rule.hint,
          text: line.trim().slice(0, 120),
        });
      }
    }
    if (/\boutline-none\b/.test(line)) {
      const allowed = OUTLINE_NONE_ALLOWLIST.some((a) => a.file === relFile);
      if (!allowed) {
        findings.push({
          rule: 'outline-none',
          file: relFile,
          line: i + 1,
          hint: '焦点环由 tokens.css 的 :focus-visible 统一给；这里抹掉它，键盘用户就看不见焦点。要豁免就进 OUTLINE_NONE_ALLOWLIST 并写理由',
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
  return findings;
}

/**
 * 扫"接线是否还在"：令牌存在不等于类名读它。
 * 这一组断言的存在理由就是本次实测到的那个缺陷本身。
 */
export function scanWiring(extras, tokensCss, indexCss) {
  const findings = [];
  const need = (cond, msg) => {
    if (!cond) findings.push({ rule: 'wiring', msg });
  };
  need(extras && extras.fontSize, 'Tailwind 缺 fontSize 映射：字号令牌无人消费，密度切换是假的');
  need(extras && extras.spacing, 'Tailwind 缺 spacing 映射：间距令牌无人消费，密度切换是假的');
  need(
    extras && extras.spacing && /--mn-density/.test(Object.values(extras.spacing).join(' ')),
    'spacing 映射存在但没引用 --mn-density：等于接了个假线，密度切换仍然无效'
  );
  need(extras && extras.zIndex, 'Tailwind 缺 zIndex 阶梯：层级只能靠 z-[...] 现场猜');
  need(
    extras &&
      /--mn-duration-med/.test(
        String(extras.transitionDuration && extras.transitionDuration.DEFAULT)
      ),
    'transitionDuration.DEFAULT 未指向令牌：不写时长的 transition 会退回 Tailwind 内置 150ms'
  );
  need(
    extras &&
      /--mn-ease/.test(
        String(extras.transitionTimingFunction && extras.transitionTimingFunction.DEFAULT)
      ),
    'transitionTimingFunction.DEFAULT 未指向令牌：缓动曲线不统一'
  );
  for (const v of [
    '--mn-density',
    '--mn-text-2xs',
    '--mn-duration-fast',
    '--mn-ease',
    '--mn-radius-lg',
  ]) {
    const n = tokensCss.split(v + ':').length - 1;
    need(n >= 1, `tokens.css 缺变量定义 ${v}`);
  }
  /*
   * 焦点环：只准有一处主定义。数的是「规则」而不是字符串出现次数——豁免规则
   * （textarea / contenteditable）与主规则共用一段选择器文本，按行计数会把一条
   * 数成两条；先剥注释，避免注释里提到 :focus-visible 也被算进来。
   */
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ringRules =
    (strip(tokensCss) + strip(indexCss)).match(/(^|\n)[^{\n]*:focus-visible[^{]*\{/g) || [];
  const ringDefs = ringRules.filter((r) => /(^|\n)html\s+:focus-visible\s*\{/.test(r)).length;
  need(ringDefs === 1, `焦点主规则定义了 ${ringDefs} 处，必须全站唯一（多处定义必有一天只改一处）`);
  const ringStrays = ringRules.filter(
    (r) => !/textarea|contenteditable/.test(r) && !/(^|\n)html\s+:focus-visible\s*\{/.test(r)
  );
  need(
    ringStrays.length === 0,
    `另有 ${ringStrays.length} 处自定义 :focus-visible，焦点环不许在别处各写一套：` +
      ringStrays.map((r) => r.trim().slice(0, 40)).join(' / ')
  );
  need(
    /textarea:focus-visible/.test(strip(tokensCss)),
    '书写面豁免（textarea / contenteditable）不见了：那两处会常驻一圈粗环'
  );
  const rm =
    (tokensCss.match(/prefers-reduced-motion/g) || []).length +
    (indexCss.match(/@media \(prefers-reduced-motion/g) || []).length;
  need(rm >= 1, '降低动效的媒体查询不见了');
  const rmBlocks = (indexCss.match(/@media \(prefers-reduced-motion/g) || []).length;
  need(rmBlocks <= 1, `index.css 里有 ${rmBlocks} 段 prefers-reduced-motion，重复声明会各改一半`);
  return findings;
}

export async function run() {
  const { SEMANTIC_EXTRAS } = await import(
    pathToFileURL(path.join(ROOT, 'shared/tailwind-colors.mjs')).href
  );
  const tokensCss = fs.readFileSync(path.join(ROOT, 'shared/styles/tokens.css'), 'utf8');
  const indexCss = fs.readFileSync(path.join(ROOT, 'web/src/index.css'), 'utf8');
  const findings = [...scanWiring(SEMANTIC_EXTRAS, tokensCss, indexCss)];
  for (const dir of ['web/src', 'desktop/src']) {
    for (const f of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      findings.push(...scanClassDiscipline(rel, fs.readFileSync(f, 'utf8')));
    }
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await run();
  if (findings.length === 0) {
    console.log('OK：UI 尺度纪律与令牌接线都在线（无越界类名、焦点环唯一、密度真的接上了）');
  } else {
    console.error(`UI 门禁发现 ${findings.length} 处问题：\n`);
    for (const f of findings) {
      console.error(
        f.file ? `  [${f.rule}] ${f.file}:${f.line}  ${f.hint}` : `  [${f.rule}] ${f.msg}`
      );
      if (f.text) console.error(`      ${f.text}`);
    }
    process.exit(1);
  }
}
