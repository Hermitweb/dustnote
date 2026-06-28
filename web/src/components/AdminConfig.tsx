/**
 * 部署管理页面：配置服务器 + 生成各平台免配置包
 */

import { useState, useEffect } from 'react';
import { getConfig, saveConfig, generatePlatformConfig, downloadConfig, loadConfig, type AppConfig } from '../lib/config';

const PLATFORMS = [
  { id: 'web' as const, name: 'Web', icon: '🌐', file: 'dustnote-web-config.json', desc: '放到 web/dist/config.json，重新部署即可' },
  { id: 'desktop' as const, name: '桌面端', icon: '💻', file: 'dustnote-desktop-config.json', desc: '放到桌面安装包同目录，启动自动读取' },
  { id: 'miniprogram' as const, name: '小程序', icon: '📱', file: 'dustnote-miniprogram.txt', desc: '按说明修改源码重新构建并上传' },
  { id: 'android' as const, name: 'Android', icon: '🤖', file: 'dustnote-android-config.json', desc: '放到 App 私有目录或 assets 中' },
  { id: 'ios' as const, name: 'iOS', icon: '🍎', file: 'dustnote-ios-config.json', desc: '加到 Xcode 项目 Bundle Resources' },
];

export function AdminConfig({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig>(getConfig());
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'download' | 'miniprogram'>('config');

  useEffect(() => { void loadConfig().then(setCfg); }, []);

  const handleSave = () => {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-surface-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <h2 className="text-lg font-bold text-surface-fg">🛠️ 部署管理</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-fg">✕</button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-surface-border px-4">
          {(['config', 'download', 'miniprogram'] as const).map(tab => (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab ? 'border-mint-600 text-mint-700' : 'border-transparent text-surface-muted hover:text-surface-fg'
              }`}>
              {tab === 'config' ? '⚙️ 服务器配置' : tab === 'download' ? '📦 免配置包' : '📱 小程序指引'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ===== Tab 1: 配置 ===== */}
          {activeTab === 'config' && (
            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">API 服务器地址</label>
                <input
                  value={cfg.apiBase}
                  onChange={e => setCfg(p => ({ ...p, apiBase: e.target.value }))}
                  placeholder="https://api.your-domain.com/api/v1"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-200"
                />
                <p className="mt-1 text-xs text-surface-muted">所有客户端通过此地址连接服务器。修改后客户端需更新配置。</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">应用名称</label>
                <input
                  value={cfg.appName}
                  onChange={e => setCfg(p => ({ ...p, appName: e.target.value }))}
                  placeholder="DustNote"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-surface-fg">小程序 AppID（可选）</label>
                <input
                  value={cfg.miniprogramAppId}
                  onChange={e => setCfg(p => ({ ...p, miniprogramAppId: e.target.value }))}
                  placeholder="wxXXXXXXXXXXXXXXXX"
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-200"
                />
              </div>

              <button
                onClick={handleSave}
                className="w-full rounded-lg bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
              >
                {saved ? '✅ 已保存' : '💾 保存配置'}
              </button>
            </div>
          )}

          {/* ===== Tab 2: 免配置包下载 ===== */}
          {activeTab === 'download' && (
            <div className="space-y-4">
              <p className="text-sm text-surface-muted">
                保存配置后，下载对应平台的配置文件，放到安装包/项目指定位置即可免配置使用。
              </p>
              {PLATFORMS.map(p => (
                <div key={p.id} className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xl">{p.icon}</span>
                    <span className="font-semibold text-surface-fg">{p.name}</span>
                  </div>
                  <p className="mb-3 text-xs text-surface-muted">{p.desc}</p>
                  <button
                    onClick={() => downloadConfig(p.file, generatePlatformConfig(p.id))}
                    className="rounded bg-mint-100 px-3 py-1.5 text-xs font-medium text-mint-700 transition-colors hover:bg-mint-200 dark:bg-mint-900/30 dark:text-mint-300"
                  >
                    📥 下载 {p.file}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ===== Tab 3: 小程序指引 ===== */}
          {activeTab === 'miniprogram' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-surface-border bg-amber-50 p-4 dark:bg-amber-900/20">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">⚠️ 重要</p>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  小程序需要重新构建并提交微信审核才能生效。修改配置后下载"免配置包"中的说明文件，按指引修改源码。
                </p>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-surface-fg">📱 让用户访问小程序</h3>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">方式一：微信搜索</p>
                  <p className="text-xs text-surface-muted">
                    审核通过后，用户在微信中搜索"{cfg.appName || 'DustNote'}"即可找到小程序。
                  </p>
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">方式二：扫码</p>
                  <div className="my-3 flex h-40 w-40 items-center justify-center rounded-lg bg-slate-100 text-xs text-surface-muted dark:bg-slate-800">
                    小程序码<br/>（审核通过后生成）
                  </div>
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-bg p-4">
                  <p className="mb-2 text-sm text-surface-fg">方式三：分享链接</p>
                  <p className="text-xs text-surface-muted">
                    用户在微信中点击分享链接可直接打开小程序。在编辑器中使用"分享"功能生成的链接会自动适配。
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-surface-fg">🔧 构建上线步骤</h3>
                <ol className="ml-4 list-decimal space-y-2 text-sm text-surface-muted">
                  <li>在左侧"服务器配置"中填写 API 地址</li>
                  <li>在"免配置包"下载小程序配置说明</li>
                  <li>按说明修改 <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">miniprogram/src/state/auth.ts</code> 中的 API_BASE</li>
                  <li>运行 <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">pnpm build:miniprogram</code> 构建</li>
                  <li>用微信开发者工具打开 <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">miniprogram/dist/</code></li>
                  <li>上传代码 → 提交审核 → 审核通过 → 发布</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-surface-border p-3 text-center text-xs text-surface-muted">
          当前服务地址：{cfg.apiBase}
        </div>
      </div>
    </div>
  );
}
