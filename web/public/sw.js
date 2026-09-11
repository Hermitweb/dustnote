/**
 * DustNote Service Worker
 *
 * 缓存策略：
 * - 静态资源（JS/CSS/图片/字体）：stale-while-revalidate
 * - 导航请求（HTML）：network-first，离线时返回缓存的 index.html
 * - API 请求（/api/）：完全绕过 SW——不缓存（见下方说明）
 *
 * 为什么不缓存 API：network-first 会把 /folders（明文文件夹名与层级）、
 * /auth/me（wrappedMasterKey）等敏感响应写进 Cache Storage，且应用没有
 * 常态清理路径——共享电脑上任何人可从 DevTools 直接读出明文文件夹结构，
 * 是 E2EE 隐私模型的破口（审计 H5）。离线体验由 IndexedDB 的加密缓存
 * （db.ts）承担，SW 缓存 API 属重复且不加密。
 *
 * 版本更新时，SW_VERSION 变更触发 install 内的 skipWaiting → activate 流程
 * 清理旧 static 缓存。发版时 SW_VERSION 前缀必须同步应用版本
 * （ci.yml 的 SW 一致性步骤会把关）。
 */

const SW_VERSION = 'dustnote-v2.5.40-001';
const CACHE_PREFIX = 'dustnote';
const STATIC_CACHE = `${CACHE_PREFIX}-static-${SW_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime`;

// 需要预缓存的静态资源（install 时缓存）
// 注意：当前预缓存列表不含 JS/CSS bundle（构建后文件名带 hash 无法手动维护）。
// 建议未来使用 vite-plugin-pwa 自动生成 precache manifest。
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/logo.png',
  '/apple-touch-icon.png',
];

// ====================================================================
// Install：预缓存核心资源，跳过 waiting 加速激活
// ====================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] precache failed:', err))
  );
});

// ====================================================================
// Activate：清理旧缓存，接管所有客户端
// ====================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE && key !== RUNTIME_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ====================================================================
// Fetch：按请求类型分派缓存策略
// ====================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 仅处理 GET 请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 同源才处理；跨域请求直接放行
  if (url.origin !== self.location.origin) return;

  // --- API 请求：完全绕过 SW，不读不写任何缓存（见文件头说明）---
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // --- 导航请求（HTML）：network-first，离线回退缓存 ---
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  // --- 静态资源：stale-while-revalidate ---
  event.respondWith(staleWhileRevalidate(request));
});

// ====================================================================
// 缓存策略实现
// ====================================================================

/** network-first：先尝试网络，失败时返回缓存 */
async function networkFirst(request, fallbackUrl) {
  try {
    const networkResponse = await fetch(request);
    // 成功则缓存副本
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // 网络失败：尝试缓存
    const cached = await caches.match(request);
    if (cached) return cached;
    // 导航请求的最终回退
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response('离线且无缓存可用', { status: 503, statusText: 'Offline' });
  }
}

/** stale-while-revalidate：先返回缓存，后台更新 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // 网络失败时返回缓存（如果有）

  return cached || networkFetch;
}

// ====================================================================
// Message：接收前端指令（如强制更新）
// ====================================================================
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
