/**
 * 公开分享页（secret-link 方案）
 *
 * 服务端只存密文，解密用的 shareKey 在链接的 URL fragment 里——
 * `#` 之后的内容浏览器不会发给服务端，所以服务端始终看不到明文。
 *
 * 流程：从 location.hash 取 shareKey → 用 token 拉密文（有密码则先过密码）
 *      → 本地解密 → 净化后渲染 Markdown
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { decryptString, fromBase64Url, isCiphertext } from '@dustnote/shared';
import { sanitizeHtml } from '../lib/sanitize-html';
import { useModeStore } from '../lib/mode-store';

interface SharePayload {
  title: string;
  content: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'password_required' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      title: string;
      content: string;
      hasPassword: boolean;
      createdAt: string;
      expiresAt: string | null;
    };

/** 从 URL fragment 取出 shareKey；链接被截断（少了 `#…`）时返回 null */
function readShareKey(): Uint8Array | null {
  const raw = location.hash.replace(/^#/, '').trim();
  if (!raw) return null;
  try {
    const key = fromBase64Url(raw);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function PublicShareView({ token }: { token: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchShare = useCallback(
    async (pwd?: string) => {
      setSubmitting(true);
      try {
        // 密码走 POST body，避免出现在 URL / 反代访问日志 / 浏览器历史里
        // API 基址与其余模块一致：异源部署（Web 前端与 API 分离）时也能访问
        const { serverUrl } = useModeStore.getState();
        const base = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
        const url = `${base}/share/public/${token}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Client-Platform': 'web',
            'X-Client-Version': __APP_VERSION__,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pwd ? { password: pwd } : {}),
        });
        const data = (await res.json()) as Record<string, unknown> & {
          error?: string;
          message?: string;
        };

        if (res.status === 401 && data.error === 'password_required') {
          setState({ kind: 'password_required' });
          return;
        }
        if (res.status === 401 && data.error === 'invalid_password') {
          setState({ kind: 'error', message: t('public_share.wrong_password') });
          return;
        }
        if (res.status === 423) {
          // 单分享密码爆破锁定
          setState({
            kind: 'error',
            message:
              data.message ??
              t('public_share.locked', { defaultValue: '该分享已被锁定，请稍后再试' }),
          });
          return;
        }
        if (res.status === 410) {
          setState({ kind: 'error', message: data.message ?? t('public_share.expired') });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: data.message ?? t('public_share.load_fail') });
          return;
        }

        const shareKey = readShareKey();
        if (!shareKey) {
          setState({ kind: 'error', message: t('public_share.link_incomplete') });
          return;
        }
        // 先取到局部常量再做类型守卫：data 带索引签名，直接对属性做窄化不可靠
        const ciphertext = data.ciphertext;
        if (!isCiphertext(ciphertext)) {
          setState({ kind: 'error', message: t('public_share.bad_data') });
          return;
        }

        // 解密只发生在这里——服务端从未持有 shareKey
        let payload: SharePayload;
        try {
          payload = JSON.parse(await decryptString(shareKey, ciphertext)) as SharePayload;
        } catch {
          setState({ kind: 'error', message: t('public_share.decrypt_fail') });
          return;
        }

        setState({
          kind: 'ready',
          title: payload.title,
          content: payload.content,
          hasPassword: !!pwd,
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
          expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
        });
      } catch (err) {
        setState({ kind: 'error', message: (err as Error).message });
      } finally {
        setSubmitting(false);
      }
    },
    [token, t]
  );

  useEffect(() => {
    void fetchShare();
  }, [fetchShare]);

  if (state.kind === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-mint-50 dark:bg-slate-900">
        <div className="text-mint-700">{t('public_share.loading')}</div>
      </div>
    );
  }

  if (state.kind === 'password_required') {
    return (
      <div className="flex h-screen items-center justify-center overflow-y-auto bg-mint-50 p-4 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl dark:bg-slate-800">
          <div className="mb-2 text-center text-3xl">🔐</div>
          <h1 className="mb-4 text-center text-lg font-bold text-slate-900 dark:text-slate-100">
            {t('public_share.password_title')}
          </h1>
          <p className="mb-4 text-center text-sm text-slate-600 dark:text-slate-400">
            {t('public_share.password_hint')}
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('public_share.password_placeholder')}
            aria-label={t('public_share.password_title')}
            className="mb-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password) void fetchShare(password);
            }}
          />
          <button
            onClick={() => void fetchShare(password)}
            disabled={!password || submitting}
            className="w-full rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
          >
            {submitting ? t('public_share.verifying') : t('public_share.unlock')}
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-screen items-center justify-center overflow-y-auto bg-mint-50 p-4 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-slate-800">
          <div className="mb-2 text-3xl">⚠️</div>
          <p className="text-slate-700 dark:text-slate-200">{state.message}</p>
          <a href="/" className="mt-4 inline-block text-sm text-mint-600 hover:underline">
            {t('public_share.back')}
          </a>
        </div>
      </div>
    );
  }

  return (
    // 自身滚动容器：全局 CSS 将 html/body/#root 锁死 overflow:hidden（主界面
    // 依赖内部滚动），分享页是独立路由，若依赖文档流滚动长内容会被裁掉无法滚动
    <div className="h-screen overflow-y-auto bg-mint-50 dark:bg-slate-900">
      {/* 顶部尘心绿横条 */}
      <div className="h-1.5 bg-gradient-to-r from-mint-400 via-mint-500 to-mint-600" />
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* 头部 */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <img src="/logo.png" alt="" className="inline-block h-4 w-4 align-middle" />
          <span>{t('public_share.badge')}</span>
          {state.hasPassword && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t('public_share.password_protected')}
            </span>
          )}
        </div>

        <article className="rounded-2xl bg-white p-8 shadow-sm dark:bg-slate-800">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {state.title}
          </h1>
          <div
            className="prose prose-sm max-w-none text-slate-700 dark:prose-invert dark:text-slate-200"
            dangerouslySetInnerHTML={{
              // 访客侧渲染的是别人写的内容，必须净化后再注入
              __html: sanitizeHtml(
                marked.parse(state.content || `*${t('public_share.empty')}*`) as string
              ),
            }}
          />
        </article>

        <div className="mt-6 text-center text-xs text-slate-400">
          <p>{t('public_share.footer')}</p>
          <a href="/" className="mt-2 inline-block text-mint-600 hover:underline">
            {t('public_share.visit')}
          </a>
        </div>
      </div>
    </div>
  );
}
