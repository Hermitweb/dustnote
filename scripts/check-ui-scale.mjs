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
    // 类名也写在 .ts 里（slash-commands、i18n 之外的拼接处），只扫 .tsx 会漏
    else if (/\.(tsx|jsx|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(fp);
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

/** 界面源码里的 emoji 上限（棘轮：只准降，降了就改小这个数字） */
/** 界面 emoji 上限：已清零，只准保持 0（要加回就必须先说明为什么它不是界面图标） */
export const EMOJI_CEILING = 0;

/**
 * 不计入棘轮的位置：笔记**正文**里的 emoji。
 * 验收口径写的是「功能图标里的 emoji = 0，正文内容里的 emoji 不计」——
 * 欢迎笔记的教程文字、书名模板里的 ⭐⭐⭐⭐⭐ 都是用户会编辑的内容，不是界面图标。
 */
export const CONTENT_ALLOWLIST = [
  { file: 'web/src/lib/slices/data-slice.ts', reason: '欢迎笔记正文（教程文字，用户可编辑）' },
  { file: 'shared/src/templates.ts', reason: '预置模板的正文内容（如书评模板的评分星）' },
  {
    file: 'web/src/screens/UnlockScreen.tsx',
    reason: '解锁屏品牌位 🔓：用户明确保留的原版识别符（2026-10-07），非功能图标',
  },
  {
    file: 'web/src/screens/StandaloneUnlockScreen.tsx',
    reason: '单机解锁屏同一品牌位，与 UnlockScreen 保持一致',
  },
];

/*
 * 变体选择器 \uFE0F 走单独的正则而不是塞进字符类：eslint 的 no-misleading-character-class
 * 会拦——它是组合符号，放进类里会让人误读成"一个字符"，实际是前一个 emoji 的修饰符。
 */
/*
 * 箭头段（U+2190-U+21FF）整段不纳入：← ↑ → ↓ 在界面里是"键名/排版"而不是图标
 * （CommandPalette 的"↑↓ 选择"、正文里的"A → B"）。但 ↩ ↪ 例外——它们只可能被
 * 当图标用（RN 回收站的恢复按钮就写了 ↩），所以单点钉进黑名单，不放过。
 */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{21A9}\u{21AA}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/**
 * 键名符号不是界面图标：⌘ ⌥ 与方向键 ↑↓←→↵ 是"那个键叫什么"，
 * 出现在快捷键提示里（CommandPalette 的导航提示、QuickCapture 的 ⌘K）。
 * 上一版整个漏掉 U+2300-U+23FF 一段，SettingsDialog 的 ⏳ 因此躲过棘轮、
 * 门禁却照报 0——把误报摁进允许集是为了让输出仍然可信，而不是放宽口径：
 * ↩(U+21A9) 这类"当图标用的箭头"不在豁免里，它同样被扫了出来（RN 回收站）。
 */
export const KEYCAP_CODEPOINTS = new Set([
  0x2190, // ←
  0x2191, // ↑
  0x2192, // →
  0x2193, // ↓
  0x21b5, // ↵
  0x2318, // ⌘
  0x2325, // ⌥
]);

/**
 * 逐字符计数（旧版按行计数：一行两个 emoji 只算一个，数字会偏小）。
 *
 * 变体选择器 U+FE0F 是前一个字符的修饰符，不单独成数——否则「⚠️」会算成两处，
 * 虚高的数字同样毁掉门禁的可信度。它只在前面那个字符没被数到时才补一跳。
 */
export function emojiHits(line) {
  let n = 0;
  let prev = false;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) {
      if (!prev) n += 1;
      prev = false;
      continue;
    }
    const hit = !KEYCAP_CODEPOINTS.has(cp) && EMOJI_RE.test(ch);
    if (hit) n += 1;
    prev = hit;
  }
  return n;
}

/** 参与 emoji 棘轮的界面源码（测试、i18n 词典、注释都不算） */
const EMOJI_DIRS = ['web/src', 'mobile/src', 'miniprogram/src'];
const EMOJI_SKIP = /\.test\.|i18n|locales|node_modules/;

/**
 * 动效单一事实源：shared/src/motion.ts → tokens.css → 小程序生成文件
 *
 * 三端各写一套时长/曲线，是"同一动作看起来不太跟手"却没人能指出差在哪的成因。
 * 这里不检查风格，只检查**同一个数有没有被抄歪**：
 *   - motion.ts 是源头（RN 直接 import，CSS 侧读不了 JS，只能落字面量）；
 *   - tokens.css 的 --mn-duration-* / --mn-ease 必须逐字相等；
 *   - 小程序的 --duration-* / --ease 由生成器发出，也必须相等；
 *   - app.scss 里不许再自己定义 --motion-* 或 --ease-*（那是第二套尺子）。
 */
export function scanMotionSync(motionTs, tokensCss, mpGenerated, mpAppScss) {
  const findings = [];
  const num = (key) => {
    const m = new RegExp(key + ':\\s*(\\d+)').exec(motionTs);
    return m ? Number(m[1]) : null;
  };
  const ease = /ease:\s*'([^']+)'/.exec(motionTs)?.[1] ?? null;
  const want = { fast: num('fast'), med: num('med'), slow: num('slow'), ease };
  for (const [k, v] of Object.entries(want)) {
    if (v === null) findings.push({ rule: 'motion', msg: `motion.ts 解析失败：${k} 不见了` });
  }
  if (findings.length) return findings;
  const cssExpect = {
    '--mn-duration-fast:': want.fast + 'ms',
    '--mn-duration-med:': want.med + 'ms',
    '--mn-duration-slow:': want.slow + 'ms',
    '--mn-ease:': want.ease,
  };
  for (const [varName, value] of Object.entries(cssExpect)) {
    const re = new RegExp(varName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*([^;]+);');
    const m = re.exec(tokensCss);
    const got = m ? m[1].trim().replace(/\s+/g, ' ') : null;
    const norm = (s) =>
      (s || '')
        .replace(/cubic-bezier\(\s*/, 'cubic-bezier(')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s*\)/, ')');
    if (!m) findings.push({ rule: 'motion', msg: `tokens.css 缺少 ${varName}` });
    else if (norm(got) !== norm(value))
      findings.push({
        rule: 'motion',
        msg: `tokens.css ${varName} = ${got}，motion.ts 要的是 ${value}`,
      });
  }
  const mpExpect = {
    '--duration-fast:': want.fast + 'ms',
    '--duration-med:': want.med + 'ms',
    '--duration-slow:': want.slow + 'ms',
    '--ease:': want.ease,
  };
  for (const [varName, value] of Object.entries(mpExpect)) {
    if (!mpGenerated.includes(varName + ' ' + value))
      findings.push({
        rule: 'motion',
        msg: `小程序生成文件缺 ${varName} ${value}（跑 node scripts/gen-mp-tokens.mjs）`,
      });
  }
  const secondRuler = /--(motion-[a-z]+|ease-[a-z]+)\s*:/;
  if (secondRuler.test(mpAppScss))
    findings.push({
      rule: 'motion',
      msg: 'app.scss 又自己定义了时长/曲线变量：那是第二套尺子，删掉、用生成出来的 --duration-* / --ease',
    });
  return findings;
}

/**
 * 界面源码里的 emoji 棘轮。
 *
 * 台账此前写「emoji 归零」，那件事只发生在 i18n 词典里（门禁也只看那里）：
 * 写在 JSX / RN <Text> / scss 里的 emoji 一个都没被查过。这里把三端界面源码
 * 纳入计数并**钉一个只降不升的上限**——一次性清零要靠给 RN 造图标组件，
 * 那是独立工程；但"没人知道还有多少"必须结束。注释里的 emoji 不算（那是历史说明）。
 */
export function scanEmoji(sources, ceiling, allowlist = CONTENT_ALLOWLIST) {
  const findings = [];
  let total = 0;
  const perFile = [];
  for (const [rel, raw] of sources) {
    if (allowlist.some((a) => a.file === rel)) continue;
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    let c = 0;
    for (const line of src.split(/\r?\n/)) c += emojiHits(line);
    if (c > 0) {
      total += c;
      perFile.push(rel + '=' + c);
    }
  }
  if (total > ceiling) {
    findings.push({
      rule: 'emoji',
      msg:
        `界面源码里的 emoji 从上限 ${ceiling} 涨到了 ${total}。要降不要涨：` +
        '新界面请用 <Icon>（web/桌面）或补图标名，别把 emoji 当功能图标。',
    });
  }
  return { findings, total, perFile: perFile.sort() };
}

/**
 * 三端图标对齐：名字表 → web / RN / 小程序
 *
 * 存在的理由：三端各自维护一张映射表，漏一个不会构建失败，只会在界面上渲染成空白
 * ——本轮就实抓到 web 的表比名字表少 11 个（TS 恰好拦住了，但小程序与 RN 拦不住）。
 * 所以这里显式比对三端覆盖：缺哪个、报哪个。
 */
export function scanIconParity(iconsTs, webIcon, rnIcon, mpScss) {
  const findings = [];
  const names = [...iconsTs.matchAll(/^ {2}'?([a-z][a-z0-9-]*)'?: '([a-z0-9-]+)',/gm)].map((m) => ({
    name: m[1],
    glyph: m[2],
  }));
  if (names.length < 50) {
    findings.push({ rule: 'icons', msg: `名字表只解析出 ${names.length} 条，结构大概变了` });
    return findings;
  }
  const covered = (src) => new Set([...src.matchAll(/^\s*'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]));
  const webKeys = covered(webIcon.slice(webIcon.indexOf('const GLYPHS')));
  const rnKeys = covered(rnIcon.slice(rnIcon.indexOf('const GLYPHS')));
  for (const { name, glyph } of names) {
    if (!webKeys.has(glyph))
      findings.push({
        rule: 'icons',
        msg: `web 缺图形映射 ${glyph}（名字 ${name}）：界面上会是空白图标`,
      });
    if (!rnKeys.has(glyph))
      findings.push({ rule: 'icons', msg: `RN 缺图形映射 ${glyph}（名字 ${name}）` });
    if (!mpScss.includes(`.mp-icon--${name} {`))
      findings.push({
        rule: 'icons',
        msg: `小程序缺 .mp-icon--${name}：跑 node scripts/gen-mp-icons.mjs`,
      });
  }
  return findings;
}

/**
 * web 源码里的 Tailwind `dark:` 变体永远是死代码：配置写的是 darkMode:'class'，
 * 而主题引擎落在 html[data-mode] 上（applyTheme 只写 dataset.theme / dataset.mode），
 * 全站没有任何一处加过 .dark ——本轮清掉 121 处，这条规则保证它不长回来。
 * 留着的害处不是体积：是让人以为暗色档做过适配，于是下一个暗色 bug 会被"已经适配了"
 * 的错觉挡在排查路径外面。要按明暗分档请写 html[data-mode="dark"] 选择器，或用语义令牌。
 */
export function scanDeadDarkVariant(rel, src) {
  const hits = [...src.matchAll(/\bdark:[a-z[]/g)].length;
  if (hits === 0) return [];
  return [
    {
      rule: 'dark-variant',
      msg:
        `${rel} 有 ${hits} 处 dark: 变体：暗色由 html[data-mode] 的令牌切换，` +
        'Tailwind 的 class 变体不会匹配（写了等于没写）。请改用语义令牌或 html[data-mode="dark"] 选择器。',
    },
  ];
}

/**
 * 主按钮那一档不许再写死白字。
 *
 * 本轮实测到的正是这个：引擎给 accent 算了 on-accent，但主按钮的底是 accent-strong
 * （另一档底色），组件写 text-accent-on 压上去，深色档实测只有 1.43:1。
 * 现在 accent-strong 有自己合法的前景（text-accent-strong-on），所以
 * text-white / bg-white / text-black 这三类字面量在 web/desktop 源码里应当为 0。
 * 遮罩的 bg-black/55 不在此列：那是"压暗一层"的语义，等 scrim 令牌可用后再收。
 */
export const WHITEBLACK_CEILING = 0;
const WHITEBLACK_RE = /\b(?:text|bg|border)-(?:white|black)\b(?!\/)/g;
export function scanHardcodedInk(rel, src, ceiling = WHITEBLACK_CEILING) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  let n = 0;
  for (const l of stripped.split('\n')) n += (l.match(WHITEBLACK_RE) || []).length;
  if (n <= ceiling) return { findings: [], n };
  return {
    n,
    findings: [
      {
        rule: 'ink',
        msg:
          `${rel} 有 ${n} 处 text/bg/border-white|black 字面量（上限 ${ceiling}）。` +
          '主按钮请用 text-accent-strong-on，其它底色用对应语义令牌。',
      },
    ],
  };
}

/**
 * 小程序的原生外壳（导航栏 / pageStyle / confirmColor）只能吃字面量 hex，
 * 所以它必须与 CSS 变量吃**同一份种子**。两处主题 id 各写一份、没人比对，
 * 就是"CSS 用一套种子、原生外壳用另一套"的成因 —— 本轮实测到的三份页面底色
 * （#EAEFF8 / #eaeff8 / #FAFCF9，而令牌其实是 #e4ebf8）正是这么漂出来的。
 */
export function scanMpThemeId(chromeTs, genMjs) {
  const a = /MP_THEME_ID = '([a-z-]+)'/.exec(chromeTs);
  const b = /const THEME_ID = '([a-z-]+)'/.exec(genMjs);
  if (!a || !b) {
    return [{ rule: 'mp-theme', msg: '小程序主题 id 解析不出来（结构变了？两处常量各查一处）' }];
  }
  return a[1] === b[1]
    ? []
    : [
        {
          rule: 'mp-theme',
          msg:
            `原生外壳吃 ${a[1]}、CSS 变量吃 ${b[1]}：两套种子。` +
            '请统一（theme-chrome.ts 的 MP_THEME_ID 与 gen-mp-tokens.mjs 的 THEME_ID）。',
        },
      ];
}

/**
 * 样式上下文里的颜色字面量：上限 0。
 *
 * 为什么不是"全仓禁止 hex"：扫过一遍，web/src 的命中全在 lib/（URL 片段、占位串），
 * naive 扫描只会造出误报，然后开始有人忽略门禁输出。所以只在**颜色属性上下文**里
 * 计数：行首是 color / background / border / fill / stroke / outline / style /
 * className / pageStyle 这类样式承载点。
 *
 * shadow* 明确排除：RN 的 shadowColor 与 CSS 阴影里的 rgba 是"投影那一档"，
 * 不是品牌色/语义色，混进来会让规则变成噪音（实测 4 处）。
 */
export const COLOR_LITERAL_CEILING = 0;
const STYLE_PROP_RE =
  /^\s*(?:[-\w]*color|background|background-color|fill|stroke|border|border-\w+|outline|pageStyle|boxStyle|style|className|class)\s*[:=]/i;
/*
 * 三种形式都算颜色字面量：#hex、rgba(...)，以及 Tailwind 的
 * bg-black/55 这种"类名形式"。最后那种最容易被漏 —— 它看起来像工具类、
 * 不像颜色，但 17 处遮罩此前正是这么散在各处的。
 */
const COLOR_LITERAL_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+|\b(?:bg|text|border)-(?:black|white)(?:\/\d+)?\b/g;
const SHADOW_PROP_RE = /^\s*shadow[a-z-]*\s*[:=]/i;

/*
 * 逐条给理由的豁免（不是文件级放行）。
 * 深色玻璃那圈蓝色描边是观感决定：它要"强调色 30% 透明"，而小程序侧没有可靠的
 * color-mix / rgb(var(--x) / a) 写法来表达带 alpha 的强调色；硬塞不透明的
 * --primary 会把描边变成一条过亮的实线。
 */
export const COLOR_LITERAL_ALLOWLIST = [
  {
    file: 'miniprogram/src/app.scss',
    pattern: /rgba\(96, 165, 250, 0\.3\)/,
    reason: '深色卡片蓝描边需要带 alpha 的强调色，小程序侧无等价令牌（见上）',
  },
];

export function scanColorLiterals(rel, src, ceiling = COLOR_LITERAL_CEILING) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const hits = [];
  stripped.split('\n').forEach((l, i) => {
    if (!STYLE_PROP_RE.test(l) || SHADOW_PROP_RE.test(l)) return;
    if (COLOR_LITERAL_ALLOWLIST.some((a) => a.file === rel && a.pattern.test(l))) return;
    const m = l.match(COLOR_LITERAL_RE);
    if (!m) return;
    hits.push(rel + ':' + (i + 1) + ' ' + m.join(' '));
  });
  if (hits.length <= ceiling) return { findings: [], hits };
  return {
    hits,
    findings: [
      {
        rule: 'color-literal',
        msg:
          `样式上下文里的颜色字面量 ${hits.length} 处（上限 ${ceiling}）：` +
          hits.slice(0, 6).join(' ; ') +
          '。请改用语义令牌（web: text-accent-strong-on / bg-surface-*；' +
          'RN: useColors() 的 c.*；小程序: var(--*) 或 lib/theme-chrome 派生）。',
      },
    ],
  };
}
/**
 * 插画体系的一致性：一张节点表要喂三条渲染链路，漂移是必然风险。
 *
 * 断言四件事：
 *   1) 节点表里不许出现颜色字面量 —— 规则 2「不引入新色相」靠结构保证，不靠自觉；
 *   2) web / RN 两个渲染器都要认得全部节点类型（新增 k 而某一端没映射 = 那一端静默少画）；
 *   3) 小程序的生成文件必须与节点表同步（漏跑生成器就漂移，与图标同一类事故）；
 *   4) 每张插画的画幅只能来自 ILL_SIZES 那张表，不许在组件里另写宽高。
 */
export function scanIllustrations(illTs, webRenderer, rnRenderer, mpScss) {
  const findings = [];
  for (const [label, v] of Object.entries({ illTs, webRenderer, rnRenderer, mpScss })) {
    if (typeof v !== 'string') {
      return [
        { rule: 'illust', msg: `scanIllustrations 入参 ${label} 不是字符串（调用点写错了）` },
      ];
    }
  }
  const names = [...illTs.matchAll(/^ {2}'?([a-z][a-z0-9-]*)'?: \[/gm)].map((m) => m[1]);
  if (names.length < 3) {
    return [{ rule: 'illust', msg: `插画节点表只解析出 ${names.length} 张，结构大概变了` }];
  }
  /* 1) 颜色字面量 */
  const stripped = illTs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const colored = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)];
  if (colored.length) {
    findings.push({
      rule: 'illust',
      msg:
        `插画节点表里有 ${colored.length} 处颜色字面量。着色只有 ink / accent 两个角色，` +
        '具体色值由渲染端给（否则暗色档下插画又会变成最亮的东西）。',
    });
  }
  /* 2) 三端都认得全部节点类型 */
  const kinds = [...new Set([...illTs.matchAll(/\{ k: '(\w)'/g)].map((m) => m[1]))].sort();
  for (const [label, src] of [
    ['web', webRenderer],
    ['RN', rnRenderer],
  ]) {
    for (const k of kinds) {
      if (!new RegExp("case '" + k + "'|k === '" + k + "'").test(src)) {
        findings.push({
          rule: 'illust',
          msg: `${label} 渲染器没有处理节点类型 '${k}'：那一端会静默少画一部分。`,
        });
      }
    }
  }
  /* 3) 小程序生成文件与节点表同步 */
  for (const n of names) {
    if (!mpScss.includes(`.mp-illust--${n} `)) {
      findings.push({
        rule: 'illust',
        msg: `小程序缺 .mp-illust--${n}：跑 node scripts/gen-mp-illustrations.mjs`,
      });
    }
  }
  return findings;
}
export async function run() {
  const { SEMANTIC_EXTRAS } = await import(
    pathToFileURL(path.join(ROOT, 'shared/tailwind-colors.mjs')).href
  );
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const tokensCss = read('shared/styles/tokens.css');
  const indexCss = read('web/src/index.css');
  const motionTs = read('shared/src/motion.ts');
  const mpGenerated = read('miniprogram/src/styles/theme-tokens.scss');
  const mpAppScss = read('miniprogram/src/app.scss');
  const findings = [
    ...scanWiring(SEMANTIC_EXTRAS, tokensCss, indexCss),
    ...scanIllustrations(
      read('shared/src/illustrations.ts'),
      read('web/src/components/Illustration.tsx'),
      read('mobile/src/components/Illustration.tsx'),
      read('miniprogram/src/styles/mp-illustrations.scss')
    ),
    ...scanMotionSync(motionTs, tokensCss, mpGenerated, mpAppScss),
    ...scanIconParity(
      read('shared/src/icons.ts'),
      read('web/src/components/Icon.tsx'),
      read('mobile/src/components/Icon.tsx'),
      read('miniprogram/src/styles/mp-icons.scss')
    ),
    ...scanMpThemeId(
      read('miniprogram/src/lib/theme-chrome.ts'),
      read('scripts/gen-mp-tokens.mjs')
    ),
  ];
  for (const dir of ['web/src', 'desktop/src']) {
    for (const f of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      const src = fs.readFileSync(f, 'utf8');
      findings.push(...scanClassDiscipline(rel, src));
      findings.push(...scanDeadDarkVariant(rel, src));
      findings.push(...scanHardcodedInk(rel, src).findings);
    }
  }
  const emojiSources = [];
  for (const dir of EMOJI_DIRS) {
    for (const f of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (EMOJI_SKIP.test(rel)) continue;
      if (!/\.(tsx|jsx|scss|css)$/.test(rel)) continue;
      emojiSources.push([rel, fs.readFileSync(f, 'utf8')]);
    }
  }
  /*
   * 颜色字面量：四端源码都扫，但**按文件名去重**。上一版把 emojiSources
   * （tsx/jsx/scss/css）与 walk()（含 .ts/.tsx）两个循环直接叠在一起，
   * 于是一个 .tsx 里的违例被报两遍 —— 同一处报两条，"发现 N 处"这个数字
   * 就失去意义了，而那正是门禁最要紧的东西。
   */
  const colorSources = new Map(emojiSources);
  for (const dir of ['web/src', 'desktop/src', 'mobile/src', 'miniprogram/src']) {
    for (const fp of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
      if (EMOJI_SKIP.test(rel)) continue;
      if (!colorSources.has(rel)) colorSources.set(rel, fs.readFileSync(fp, 'utf8'));
    }
  }
  for (const [rel, src] of colorSources) {
    findings.push(...scanColorLiterals(rel, src).findings);
  }
  const emoji = scanEmoji(emojiSources, EMOJI_CEILING);
  findings.push(...emoji.findings);
  return { findings, emoji };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { findings, emoji } = await run();
  if (findings.length === 0) {
    console.log(
      `OK：尺度纪律、令牌接线、动效同源都在线；界面 emoji ${emoji.total} 处（上限 ${EMOJI_CEILING}，只降不升）`
    );
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
