/**
 * 备份加密往返测试（技术债清理）
 *
 * 备份文件含 totp_secret / wrapped_master_key 等敏感材料——启用
 * BACKUP_ENCRYPTION_KEY 后必须是真实加密（密文不含明文、口令错误无法解密）。
 * 这里用临时目录做完整的 encrypt → 校验 → decrypt 往返。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decryptBackupFile, encryptBackupFile } from './backup.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dustnote-bak-test-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backup encryption', () => {
  it('encrypts with magic header, hides plaintext, and round-trips', async () => {
    const plainPath = join(dir, 'db-test.sqlite');
    const payload = Buffer.from('SQLite format 3\0SECRET-totp-secret-and-hashes');
    await writeFile(plainPath, payload);

    const encPath = await encryptBackupFile(plainPath, 'correct horse battery staple');
    expect(encPath.endsWith('.sqlite.enc')).toBe(true);

    // 明文文件应已被删除
    await expect(readFile(plainPath)).rejects.toThrow();

    const enc = await readFile(encPath);
    expect(enc.subarray(0, 9).toString('ascii')).toBe('DNOTEBAK1');
    expect(enc.includes(Buffer.from('SECRET-totp-secret-and-hashes'))).toBe(false);

    const outPath = join(dir, 'restored.sqlite');
    await decryptBackupFile(encPath, 'correct horse battery staple', outPath);
    expect(await readFile(outPath)).toEqual(payload);
  });

  it('rejects a wrong passphrase (GCM auth tag)', async () => {
    const plainPath = join(dir, 'db-test2.sqlite');
    await writeFile(plainPath, Buffer.from('payload-2'));
    const encPath = await encryptBackupFile(plainPath, 'right-pass');

    await expect(
      decryptBackupFile(encPath, 'wrong-pass', join(dir, 'restored2.sqlite'))
    ).rejects.toThrow();
  });

  it('rejects files that are not our encrypted backups', async () => {
    const bogus = join(dir, 'bogus.sqlite.enc');
    await writeFile(bogus, Buffer.from('not-a-dustnote-backup-but-long-enough-padding-1234567890'));
    await expect(
      decryptBackupFile(bogus, 'whatever', join(dir, 'restored3.sqlite'))
    ).rejects.toThrow(/magic/);
  });
});
