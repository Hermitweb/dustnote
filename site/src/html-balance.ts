/**
 * 极简标签配对检查。
 *
 * 为什么要它：官网正文是手写静态 HTML（无 JS 也能读全），而 vite 构建不校验结构、
 * eslint 不看 HTML、内容测试只做 toContain。插入内容块时少写一个闭合标签，
 * 全部门禁照绿，浏览器却会把后面的内容吸进错误的父节点——只有配对检查拦得住。
 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** 返回问题列表，空数组即配对正确。 */
export function unbalancedTags(src: string): string[] {
  const NL = String.fromCharCode(10);
  const stripped = src.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const problems: string[] = [];
  const stack: { tag: string; line: number }[] = [];
  const lineAt = (idx: number) => stripped.slice(0, idx).split(NL).length;
  for (const m of stripped.matchAll(/<\/?[a-zA-Z][^>]*/g)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    const isClose = raw.charAt(1) === '/';
    const name = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw)?.[1]?.toLowerCase();
    if (!name) continue;
    const selfClose = raw.endsWith('/') || VOID_TAGS.has(name);
    if (isClose) {
      const top = stack[stack.length - 1];
      if (top && top.tag === name) {
        stack.pop();
        continue;
      }
      // 不匹配多半是中间某层忘了闭合。往上找同名开标签，把夹在中间的逐个报出来，
      // 而不是盲目弹栈——那会让后面的报告全部错位，只剩一条没人看得懂的噪音。
      const at = stack.map((o) => o.tag).lastIndexOf(name);
      if (at === -1) {
        problems.push('第 ' + lineAt(idx) + ' 行：多余的 </' + name + '>');
        continue;
      }
      for (let k = stack.length - 1; k > at; k--) {
        const o = stack[k];
        problems.push(
          '第 ' +
            o.line +
            ' 行的 <' +
            o.tag +
            '> 没闭合，却在第 ' +
            lineAt(idx) +
            ' 行遇到 </' +
            name +
            '>'
        );
      }
      stack.length = at;
      continue;
    }
    if (selfClose) continue;
    stack.push({ tag: name, line: lineAt(idx) });
  }
  for (const open of stack) problems.push('第 ' + open.line + ' 行：<' + open.tag + '> 没有闭合');
  return problems;
}
