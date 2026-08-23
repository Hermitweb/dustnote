/**
 * JWT 鉴权中间件
 * 校验 Bearer access token，注入 req.user
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/jwt.js';
import { logger } from '../logger.js';

export interface AuthUser {
  userId: string;
  deviceId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // CORS 预检请求（OPTIONS）不带 Authorization（浏览器规范），必须放行，
  // 否则跨域 Web 客户端的每个 API 调用都会因预检 401 失败。
  // 实际权限校验由后续路由的 GET/POST/PATCH/DELETE 承担。
  if (req.method === 'OPTIONS') {
    return next();
  }
  // 注意：req.path 在 app.use('/api/v1', ...) 中是相对路径
  const p = req.path;
  if (
    p === '/health' ||
    p === '/update-manifest' ||
    p === '/auth/status' ||
    p === '/auth/setup' ||
    p === '/auth/unlock' ||
    p === '/auth/refresh' ||
    p === '/auth/recover' ||
    p === '/auth/recovery-params' ||
    p.startsWith('/share/public/')
  ) {
    return next();
  }

  const auth = req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token', message: '需要 Authorization: Bearer <token>' });
    return;
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'access') {
    logger.warn({ path: req.path }, '无效 access token');
    res.status(401).json({ error: 'invalid_token', message: 'token 无效或已过期' });
    return;
  }

  req.user = { userId: payload.sub, deviceId: payload.device };
  next();
}
