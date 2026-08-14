import { describe, it, expect } from 'vitest';
import { checkForUpdate } from '../src/update-check.js';

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () =>
      typeof body === 'string'
        ? Promise.reject(new SyntaxError('Unexpected token'))
        : Promise.resolve(body),
    text: () => Promise.resolve(text),
  } as Response;
}

const VALID_MANIFEST = {
  serverVersion: '1.0.0',
  channel: 'stable',
  latest: {
    version: '1.2.0',
    releaseDate: '2026-01-01',
    artifacts: {},
  },
  minClientVersion: '1.0.0',
  recommendedClientVersion: '1.2.0',
  forceUpdateVersion: null,
};

const BASE_OPTS = {
  currentVersion: '1.2.0',
  platform: 'desktop' as const,
  channel: 'stable' as const,
  deviceId: 'dev1',
  apiBase: 'https://api.example.com',
};

describe('checkForUpdate', () => {
  it('returns ok on valid manifest', async () => {
    const fetcher = () => Promise.resolve(makeResponse(200, VALID_MANIFEST));
    const result = await checkForUpdate({ ...BASE_OPTS, fetcher });
    expect(result.status).toBe('ok');
    expect(result.manifest).toBeDefined();
  });

  it('returns force_update on 410', async () => {
    const fetcher = () =>
      Promise.resolve(
        makeResponse(410, { forceUpdateVersion: '1.0.0', updateUrl: 'https://example.com' })
      );
    const result = await checkForUpdate({ ...BASE_OPTS, fetcher });
    expect(result.status).toBe('force_update');
  });

  it('returns error on invalid JSON', async () => {
    const fetcher = () => Promise.resolve(makeResponse(200, 'not json'));
    const result = await checkForUpdate({ ...BASE_OPTS, fetcher });
    expect(result.status).toBe('error');
  });
});
