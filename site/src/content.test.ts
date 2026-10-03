/**
 * 官网守卫测试。
 *
 * 它不测渲染，测的是「页面有没有悄悄说谎」这类烂法：
 *   1) 规格与页面脱钩（功能下线、平台少一端、KDF 参数换掉、工程承诺写歪）；
 *   2) 静默引入第三方请求（一个外链字体或 shields 徽章，就和页面自述的零遥测矛盾）；
 *   3) 锚点指向不存在的小节、README 与页面各说一套；
 *   4) 站点配色与产品主题种子漂移——官网像另一个产品，是慢功夫烂掉的典型症状。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS, ENGINEERING, FEATURES, LINKS, PLATFORMS, SECURITY_FACTS, VERSION } from './content';
import { unbalancedTags } from './html-balance';

const at = (p: string) => new URL(p, import.meta.url);
const html = readFileSync(at('../index.html'), 'utf8');
const css = readFileSync(at('./styles.css'), 'utf8');
const rootPkg = JSON.parse(readFileSync(at('../../package.json'), 'utf8'));
const sitePkg = JSON.parse(readFileSync(at('../package.json'), 'utf8'));
const readme = readFileSync(at('../../README.md'), 'utf8');

describe('元数据与版本', () => {
  it('根包 == 站点包 == 页面显示的版本（bump 漏一处即拦下）', () => {
    expect(VERSION).toBe(rootPkg.version);
    expect(sitePkg.version).toBe(rootPkg.version);
    /*
     * 标题里写了"页面显示的版本"，但原来只比了两个 package.json。
     * index.html 里 [data-slot=version] 还有一份**静态兜底文本**（JS 跑起来之前
     * 无脚本用户看的就是它），它不在 bump 清单里时会永远停在上一版，而测试全绿。
     * 现在把它也钉上，并把 index.html 加进 scripts/bump-version.mjs 的清单。
     */
    // prettier 会把长标签折行（版本号与 </span> 之间可能换行），所以按正则容忍空白
    expect(html, `index.html 的静态兜底版本应为 v${rootPkg.version}`).toMatch(
      new RegExp(`>v${rootPkg.version.replace(/\./g, String.fromCharCode(92) + '.')}\\s*</span`)
    );
  });

  // 产品中文名以 web/src/lib/i18n.ts 的 zh `name` 为准；官网第一版把它写成了
  // 「尘心笔记」（那是主题名 mint-dawn 的前两个字），属于凭空造名字，故上闸。
  it('产品中文名与 i18n 同源', () => {
    const i18n = readFileSync(at('../../web/src/lib/i18n.ts'), 'utf8');
    const m = /name: '([^']+)'/.exec(i18n);
    expect(m).not.toBeNull();
    const zhName = m![1];
    expect(zhName.length).toBeGreaterThan(1);
    expect(html).toContain(zhName);
    expect(rootPkg.description).toContain(zhName);
    // 每一处品牌串「DustNote · X」都必须拼出 i18n 里的那个名字
    // 产品示意图（figure.mock）里的假标题栏不是品牌声明，先摘掉再比对。
    const prose = html.replace(/<figure class="mock[^>]*>[\s\S]*?<\/figure>/g, '');
    const brands = prose.match(/DustNote\s+\u00b7\s+[^<"\s]+/g) ?? [];
    expect(brands.length).toBeGreaterThan(0);
    for (const b of brands) expect(b.endsWith(zhName)).toBe(true);
  });

  it('恰好一个 h1，title 与 description 齐备', () => {
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('<title>DustNote');
    // prettier 会把长 meta 折行，故 name 与 content 之间按空白匹配
    expect(html).toMatch(/name="description"\s+content="[^"]{40,}"/);
  });
});

describe('页面声明与规格一致', () => {
  it.each(FEATURES.map((f) => [f.title]))('特性在页面上出现：%s', (title) => {
    expect(html).toContain(title);
  });

  it('平台表与 README 的平台矩阵行数和状态用词一致', () => {
    const table = readme.slice(readme.indexOf('## 平台覆盖'));
    const rows = (table.slice(0, table.indexOf('## ', 20)).match(/^\| \*\*/gm) ?? []).length;
    expect(PLATFORMS.length).toBe(rows);
    for (const p of PLATFORMS) {
      expect(html).toContain(p.name);
      expect(html).toContain(p.state);
    }
  });

  it.each(SECURITY_FACTS)('安全结论在页面上：%s', (fact) => {
    expect(html).toContain(fact);
  });

  it('工程承诺逐条在页面上（不许只写「我们有 CI」）', () => {
    for (const row of ENGINEERING) {
      expect(html).toContain(row.k);
      expect(html).toContain(row.v);
    }
  });

  it('文档卡片：标题在页面上、目标文件真实存在', () => {
    for (const d of DOCS) {
      expect(html).toContain(d.title);
      expect(html).toContain('docs/' + d.file);
      expect(readFileSync(at('../../docs/' + d.file), 'utf8').length).toBeGreaterThan(80);
    }
  });
});

describe('链接卫生', () => {
  it('站内锚点都有落点', () => {
    const ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]));
    const used = Array.from(html.matchAll(/href="#([^"]+)"/g), (m) => m[1]);
    expect(used.length).toBeGreaterThan(6);
    for (const u of used) expect(ids.has(u)).toBe(true);
  });

  // 自有主机：Pages 站点、仓库，以及官方托管实例（只是链接目标，页面不从它加载任何资源）。
  const ALLOWED_HOSTS = new Set(['hermitweb.github.io', 'github.com', 'napi.iniess.cn']);

  it('外链全为 https、主机在名单内，GitHub 链接只指本仓库', () => {
    for (const v of Object.values(LINKS)) {
      const u = new URL(v);
      expect(u.protocol).toBe('https:');
      // 先过主机名单，再看路径：只看 pathname.startsWith 会被
      // https://evil.example/?x=/Hermitweb/dustnote 这种形状绕过。
      expect(ALLOWED_HOSTS.has(u.hostname)).toBe(true);
      if (u.hostname === 'github.com') {
        expect(u.pathname.startsWith('/Hermitweb/dustnote')).toBe(true);
      }
    }
  });

  // 判定依据是「解析出来的主机名」，不是在整页里搜子串。子串式断言既弱（换个没点名的
  // 第三方域名就看不见）又会被判成不完整的 URL 校验——github.com 这几个字能出现在
  // 任意主机的路径或查询里。改成白名单后断言更强：任何不在名单内的绝对 URL 都会红。
  // 任何属性值里的绝对 URL 都算，不限 href/src —— poster、data-src 是同一条后门。
  const ABSOLUTE_URL_ATTR = /=["'][a-z][a-z0-9+.-]*:\/\/[^"'\s]+/gi;
  const urlOf = (attr: string) => attr.replace(/^=["']/, '');
  const absoluteHosts = (src: string) =>
    [...src.matchAll(ABSOLUTE_URL_ATTR)].map((m) => new URL(urlOf(m[0])).hostname);

  it('零第三方资源：页面与样式引用的绝对 URL 只允许自有主机', () => {
    expect(html).not.toMatch(/<iframe/);
    expect(css).not.toMatch(/@import\s+url\((["']?)https?:/i);
    const hosts = absoluteHosts(html);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(ALLOWED_HOSTS.has(h)).toBe(true);
    // 外链字体与徽章是这类页面最常见的两个后门，单独点名留痕（名单本身已能拦住）
    expect(html).not.toMatch(/googleapis|gstatic|shields\./i);
  });
});

describe('配色与产品主题种子同源', () => {
  const seedsSrc = readFileSync(at('../../shared/src/theme-seeds.ts'), 'utf8');
  const from = seedsSrc.indexOf("'mist-blue'");
  expect(from).toBeGreaterThan(0);
  // 只取 mist-blue 这一段：切到下一个同缩进的种子键为止。
  // 早先写成 slice 到文件末尾的 '};'，dark 段就混进了后面所有种子的值，
  // 而 Object.fromEntries 后者覆盖前者——实际比对的是最后一个种子，假通过。
  const rest = seedsSrc.slice(from + 1);
  const nextSeed = rest.search(/\n {2}'[a-z-]+': \{/);
  const body = nextSeed === -1 ? seedsSrc.slice(from) : seedsSrc.slice(from, from + 1 + nextSeed);
  const darkAt = body.indexOf('dark:');
  const grab = (chunk: string) =>
    Object.fromEntries(
      Array.from(chunk.matchAll(/'(--mn-[a-z-]+)': '([0-9 ]+)'/g), (m) => [m[1], m[2]])
    );
  const light = grab(body.slice(0, darkAt));
  const dark = grab(body.slice(darkAt));

  const inCss = (selector: string, name: string) => {
    const i = css.indexOf(selector);
    expect(i).toBeGreaterThan(-1);
    const decl = css.slice(i, css.indexOf('}', i));
    const m = new RegExp(name + ':\\s*([0-9 ]+)').exec(decl);
    return m?.[1] ?? null;
  };

  it('light 种子逐条一致', () => {
    for (const [k, v] of Object.entries(light)) expect(inCss(':root {', k)).toBe(v);
  });

  it('dark 种子逐条一致', () => {
    for (const [k, v] of Object.entries(dark)) expect(inCss("[data-mode='dark']", k)).toBe(v);
  });
});

describe('HTML 结构自身', () => {
  it('标签配对正确——构建、lint、内容测试都不校验结构，破损只会静默改变渲染层级', () => {
    expect(unbalancedTags(html)).toEqual([]);
  });
});

describe('中文排版', () => {
  // HTML 里文本节点内的换行会渲染成一个空格。英文无所谓，中文句子里凭空多出一格，
  // 而构建、lint、类型检查全都不会因此变红——只能把它变成断言。
  it('中文与中文之间不夹空格（换行即空格）', () => {
    // 直接取标签之间的文本节点。不做「先把注释剥掉、再把结果当 HTML 用」那种半吊子清洗——
    // 那正是会被扫成漏洞的形态，而且没必要：注释体紧跟在 < 之后，下面的正则取不到它。
    const offenders: string[] = [];
    let textNodes = 0;
    for (const m of html.matchAll(/>([^<>]+)/g)) {
      textNodes += 1;
      const t = m[1].replace(/^\s+|\s+$/g, '');
      const hit = t.match(/[\u4e00-\u9fff，。、；：）」』]\s+[\u4e00-\u9fff]/g);
      if (hit) offenders.push(...hit.map((x) => x.replace(/\s+/g, '␣')));
    }
    // 拿不到节点 = 正则失效，那和「页面干净」是两回事，必须分开报
    expect(textNodes).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
