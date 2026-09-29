/**
 * 官网文案的单一来源与「页面规格」。
 *
 * 关系要说清楚：index.html 是渲染结果，本文件是规格；content.test.ts 逐条断言
 * 规格里每一项都出现在页面上。于是「改了页面忘了改规格」或反过来都会被测试拦下，
 * 而不是靠人记得两边同步（靠人记得的事，这两天已经证明记不住）。
 *
 * 这里只收录代码里可验证的能力。附件系统尚未实现（roadmap 的 R2 项），所以不写。
 */
import pkg from '../package.json';

/** 与根 package.json 同步：scripts/bump-version.mjs 的清单含 site/package.json */
export const VERSION = pkg.version as string;

export const LINKS = {
  repo: 'https://github.com/Hermitweb/dustnote',
  releases: 'https://github.com/Hermitweb/dustnote/releases/latest',
  docsTree: 'https://github.com/Hermitweb/dustnote/tree/main/docs',
  securityDoc: 'https://github.com/Hermitweb/dustnote/blob/main/SECURITY.md',
  selfHosting: 'https://github.com/Hermitweb/dustnote/blob/main/docs/self-hosting.md',
  securityModel: 'https://github.com/Hermitweb/dustnote/blob/main/docs/security-model.md',
  contributing: 'https://github.com/Hermitweb/dustnote/blob/main/CONTRIBUTING.md',
  status: 'https://github.com/Hermitweb/dustnote/blob/main/docs/status.md',
  privacy: 'https://github.com/Hermitweb/dustnote/blob/main/docs/privacy-policy.md',
  terms: 'https://github.com/Hermitweb/dustnote/blob/main/docs/terms-of-service.md',
  liveDemo: 'https://napi.iniess.cn',
} as const;

export type Feature = { title: string };
export const FEATURES: Feature[] = [
  { title: '端到端加密' },
  { title: '单机 / 联机双模式' },
  { title: '编辑器与整理' },
  { title: '可控的公开分享' },
  { title: '账号加固' },
  { title: '五端同一内核' },
];

export type Platform = { name: string; state: string };
/** 与 README「平台覆盖」表的行数一致（6 行），少一行即测试失败 */
export const PLATFORMS: Platform[] = [
  { name: 'Web · PWA', state: '可用' },
  { name: '桌面 · Tauri 2', state: '可用' },
  { name: 'Android', state: '可用' },
  { name: '微信小程序', state: '可用' },
  { name: 'H5 移动版', state: '可用' },
  { name: 'iOS', state: '未发布' },
];

export const SECURITY_FACTS = [
  '明文不出设备：加解密只在客户端完成，服务端只搬密文',
  '派生参数随账号记录：历史 Argon2id 账号与新 PBKDF2 账号并存可解锁',
  'AAD 绑定 noteId 与 userId：密文挪用到别的记录会认证失败',
  '凭据不落地：access token 短时效，refresh 走 httpOnly + SameSite=strict',
  '首屏零第三方请求：不加载外部字体、统计或徽章图片',
];

export type Engineering = { k: string; v: string };
export const ENGINEERING: Engineering[] = [
  {
    k: '类型与规范',
    v: 'tsc 全量类型检查、eslint 分包、prettier；一条 pnpm verify 跑完 CI 的全部门禁',
  },
  { k: '测试', v: '各包 vitest 单测 + Playwright e2e，含视觉基线与对比度断言' },
  { k: '安全', v: 'CodeQL 每次 push、pnpm audit、nginx 安全头继承守卫、action 钉版守卫' },
  { k: '发布', v: '镜像一次构建多平台推送、Docker 上下文 COPY 守卫、CI 里跑 nginx -t' },
  { k: '运行', v: '服务器本机监控 + GitHub 侧外部拨测双视角，失败开 issue、恢复自动关闭' },
  { k: '文档', v: 'docs:check 守死链与孤儿文档，api:check 守接口清单与真实路由一致' },
];

/** 文档卡片：file 必须真实存在于 docs/（测试会逐个读一遍） */
export const DOCS = [
  { title: '用户使用手册', file: 'user-guide.md' },
  { title: '安装与卸载', file: 'installation-guide.md' },
  { title: '自托管指南', file: 'self-hosting.md' },
  { title: '运维手册', file: 'operations-runbook.md' },
  { title: 'API 文档', file: 'api.md' },
  { title: '安全模型', file: 'security-model.md' },
  { title: '常见问题', file: 'faq.md' },
  { title: '兼容性矩阵', file: 'compatibility-matrix.md' },
  { title: '发展路线图', file: 'roadmap.md' },
];
