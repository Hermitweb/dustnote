/**
 * 公开分享页：通过 token 拉取密文，本地用 visitor key 解密，渲染 Markdown
 * 不需要登录，端到端加密依然生效（owner 在分享时用一次性 derived key 加密）
 *
 * 简化策略：分享时服务端已经存储了密文，但访客拿不到 owner 的 masterKey
 * 解决：分享时由 owner 用分享密码（若有）或公开临时 key 加密
 *
 * v1 实现：访客直接获取解密的明文（如果有密码则先校验密码，服务端用 owner 的密文
 *         + 分享 password 派生 key 解密后下发明文）
 *         这是为了避免主人要在线处理私钥解锁的复杂流程
 *
 * 真正的 E2EE 分享见 security.md §5.6，本组件为过渡方案
 */

import { useEffect, useState, useCallback } from 'react';
import { marked } from 'marked';

interface PublicShareData {
  ciphertext: unknown;
  keyVersion: number;
  noteId: string;
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

export function PublicShareView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchShare = useCallback(
    async (pwd?: string) => {
      setSubmitting(true);
      try {
        const url = `/api/v1/share/public/${token}${pwd ? `?password=${encodeURIComponent(pwd)}` : ''}`;
        const res = await fetch(url, {
          headers: { 'X-Client-Platform': 'web', 'X-Client-Version': '0.1.0' },
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
          setState({ kind: 'error', message: '密码错误，请重试' });
          return;
        }
        if (res.status === 410) {
          setState({ kind: 'error', message: data.message ?? '分享已过期或被吊销' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: data.message ?? '加载失败' });
          return;
        }

        // v1 简化：服务端直接返回明文（如果有密码，先校验）
        // 真正的 E2EE 分享需要 owner 在线解密
        const d = data as unknown as PublicShareData & {
          title?: string;
          content?: string;
          createdAt?: string;
          expiresAt?: string | null;
        };
        if (typeof d.title === 'string' && typeof d.content === 'string') {
          setState({
            kind: 'ready',
            title: d.title,
            content: d.content,
            hasPassword: !!pwd,
            createdAt: d.createdAt ?? new Date().toISOString(),
            expiresAt: d.expiresAt ?? null,
          });
        } else {
          // 兼容密文返回（暂未实现客户端解密，提示）
          setState({
            kind: 'ready',
            title: '🔒 加密笔记',
            content: '*此笔记是端到端加密的密文分享。访客端解密需 owner 在场，暂不支持。*',
            hasPassword: !!pwd,
            createdAt: new Date().toISOString(),
            expiresAt: null,
          });
        }
      } catch (err) {
        setState({ kind: 'error', message: (err as Error).message });
      } finally {
        setSubmitting(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void fetchShare();
  }, [fetchShare]);

  if (state.kind === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-mint-50 dark:bg-slate-900">
        <div className="text-mint-700">加载中…</div>
      </div>
    );
  }

  if (state.kind === 'password_required') {
    return (
      <div className="flex h-screen items-center justify-center bg-mint-50 p-4 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl dark:bg-slate-800">
          <div className="mb-2 text-center text-3xl">🔐</div>
          <h1 className="mb-4 text-center text-lg font-bold text-slate-900 dark:text-slate-100">
            此分享需要密码
          </h1>
          <p className="mb-4 text-center text-sm text-slate-600 dark:text-slate-400">
            请输入分享密码以查看内容
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="分享密码"
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
            {submitting ? '验证中…' : '解锁'}
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-mint-50 p-4 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-slate-800">
          <div className="mb-2 text-3xl">⚠️</div>
          <p className="text-slate-700 dark:text-slate-200">{state.message}</p>
          <a href="/" className="mt-4 inline-block text-sm text-mint-600 hover:underline">
            ← 返回 DustNote
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mint-50 dark:bg-slate-900">
      {/* 顶部尘心绿横条 */}
      <div className="h-1.5 bg-gradient-to-r from-mint-400 via-mint-500 to-mint-600" />
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* 头部 */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <span>🌿</span>
          <span>DustNote 分享</span>
          {state.hasPassword && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              密码保护
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
              __html: marked.parse(state.content || '*暂无内容*') as string,
            }}
          />
        </article>

        <div className="mt-6 text-center text-xs text-slate-400">
          <p>由 DustNote 分享 · 内容由笔记主人提供</p>
          <a href="/" className="mt-2 inline-block text-mint-600 hover:underline">
            访问 DustNote
          </a>
        </div>
      </div>
    </div>
  );
}
