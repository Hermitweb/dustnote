/**
 * 运行时配置系统
 * 优先级：localStorage 覆盖 > config.json > 默认值
 * 支持部署时预置，也支持应用内修改
 */

export interface AppConfig {
  /** API 服务器地址 */
  apiBase: string;
  /** 应用名称 */
  appName: string;
  /** 小程序 AppID */
  miniprogramAppId: string;
  /** 是否启用了自定义配置 */
  customized: boolean;
}

const STORAGE_KEY = 'dustnote_app_config';

const DEFAULTS: AppConfig = {
  apiBase: '/api/v1',
  appName: 'DustNote',
  miniprogramAppId: '',
  customized: false,
};

let cached: AppConfig | null = null;

/** 从 localStorage + 远程 config.json 加载配置 */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;

  // 1. 尝试加载 public/config.json（3 秒超时，避免 Tauri webview 卡死）
  let remote: Partial<AppConfig> = {};
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const r = await fetch('/config.json', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (r.ok) remote = (await r.json()) as Partial<AppConfig>;
  } catch {
    /* 无 config.json，用默认 */
  }

  // 2. localStorage 覆盖
  let local: Partial<AppConfig> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    /* ignore */
  }

  cached = { ...DEFAULTS, ...remote, ...local };
  return cached;
}

/** 同步读取（需先调用 loadConfig） */
export function getConfig(): AppConfig {
  return cached ?? DEFAULTS;
}

/** 更新并持久化配置 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  cached = { ...(cached ?? DEFAULTS), ...patch, customized: true };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* ignore */
  }
  return cached;
}

/** 生成各平台配置文件内容 */
export function generatePlatformConfig(
  platform: 'desktop' | 'miniprogram' | 'web' | 'android' | 'ios'
): string {
  const cfg = getConfig();
  const base = {
    apiBase: cfg.apiBase,
    appName: cfg.appName,
  };

  switch (platform) {
    case 'desktop':
    case 'web':
      return JSON.stringify({ ...base, platform }, null, 2);
    case 'miniprogram':
      // 小程序：替换 state/auth.ts 中的 API_BASE 常量
      return [
        `// 小程序配置文件 - 替换 src/state/auth.ts 中 API_BASE 常量`,
        `// 或在 config/index.ts 的 defineConstants 中设置`,
        ``,
        `// 方法 1：直接修改 src/state/auth.ts`,
        `const API_BASE = '${cfg.apiBase}/api/v1';`,
        ``,
        `// 方法 2：在 config/index.ts 的 defineConstants 中添加：`,
        `defineConstants: {`,
        `  API_BASE: JSON.stringify('${cfg.apiBase}/api/v1'),`,
        `},`,
        ``,
        `// 然后在 src/state/auth.ts 中改为：`,
        `const API_BASE = process.env.API_BASE || 'http://localhost:3210/api/v1';`,
      ].join('\n');
    case 'android':
    case 'ios':
      return JSON.stringify(
        {
          ...base,
          platform,
          miniprogramAppId: cfg.miniprogramAppId,
        },
        null,
        2
      );
  }
}

/** 下载配置文件 */
export function downloadConfig(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
