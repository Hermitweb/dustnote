/**
 * 官网的渐进增强脚本。
 *
 * 刻意只做四件事：版本号回填、移动端菜单、命令复制、导航高亮。页面正文全部是静态
 * HTML——一份要靠 JS 才读到内容的落地页，等于把可访问性和搜索引擎都押在脚本能跑上。
 * 文案的单一来源在 content.ts，由 content.test.ts 反向核对 index.html。
 */
import './styles.css';
import { VERSION } from './content';

function fillStatic(): void {
  document.querySelectorAll<HTMLElement>('[data-slot=version]').forEach((el) => {
    el.textContent = 'v' + VERSION;
  });
  const y = String(new Date().getFullYear());
  document.querySelectorAll<HTMLElement>('[data-slot=year]').forEach((el) => {
    el.textContent = y;
  });
}

function wireNavToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-slot=nav-toggle]');
  const panel = document.getElementById('mobile-nav');
  if (!btn || !panel) return;
  const setOpen = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    panel.classList.toggle('hidden', !open);
  };
  setOpen(false);
  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  // 选中菜单项后自动收起：移动端少点一下，是能被感觉到的差别
  panel.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a')) setOpen(false);
  });
}

function wireCopy(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-slot=copy]');
  const code = document.getElementById('compose-cmd');
  if (!btn || !code) return;
  btn.addEventListener('click', async () => {
    const text = code.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已复制';
    } catch {
      // 没有剪贴板权限（非安全上下文）时明说「手动复制」，而不是点了没反应
      btn.textContent = '请手动复制';
    }
    window.setTimeout(() => {
      btn.textContent = '复制';
    }, 1800);
  });
}

/** 滚动到哪一节就高亮哪一项：纯装饰，浏览器不支持就整段跳过 */
function wireScrollSpy(): void {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('nav[aria-label=主导航] a[href^="#"]')
  );
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [String(a.getAttribute('href') || '').slice(1), a]));
  const obs = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        byId.get(en.target.id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) obs.observe(el);
  }
}

fillStatic();
wireNavToggle();
wireCopy();
wireScrollSpy();
