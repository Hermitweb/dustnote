/**
 * 服务端 SQLite 自动备份脚本
 *
 * 设计：
 * - 使用 SQLite Online Backup API（.backup()），不锁库、不阻塞读写
 * - 按日期滚动备份，保留最近 N 份
 * - 支持手动执行 / cron 定时执行
 *
 * 防坑：SQLite 单文件，一次磁盘故障 = 全部数据丢失。
 * 这是个人项目数据安全的最后一道防线。
 *
 * 用法：
 *   # 手动执行一次备份
 *   pnpm --filter @dustnote/server exec tsx src/scripts/backup.ts
 *
 *   # cron 每日凌晨 3 点备份（crontab -e）
 *   0 3 * * * cd /app && node dist/scripts/backup.js
 */

import { mkdir, readdir, stat, unlink, readFile, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../env.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';

const BACKUP_DIR = config.backupDir ?? join(process.cwd(), 'backups');
const RETENTION_COUNT = Number(config.backupRetention ?? 30);

// ========== 备份加密（技术债清理）==========
// 备份文件含 users.totp_secret / wrapped_master_key / 凭据哈希等敏感材料,
// 明文落盘等同生产库泄漏面。设置 BACKUP_ENCRYPTION_KEY 后以 AES-256-GCM
// 加密为 `db-*.sqlite.enc`;未设置则保持明文并记 warn（自托管可不加密）。
// 文件格式:[9B magic "DNOTEBAK1"][16B salt][12B iv][16B tag][ciphertext]
const ENC_MAGIC = Buffer.from('DNOTEBAK1', 'ascii');
const ENC_SALT_LEN = 16;
const ENC_IV_LEN = 12;
const ENC_TAG_LEN = 16;
/** scrypt 参数:备份加密只需抗离线爆破,32MB 档位足够且不拖慢每日任务 */
const ENC_SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

function deriveBackupKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, ENC_SCRYPT);
}

/** 把明文备份加密为 <path>.enc 并删除明文,返回加密文件路径 */
export async function encryptBackupFile(plainPath: string, passphrase: string): Promise<string> {
  const plaintext = await readFile(plainPath);
  const salt = randomBytes(ENC_SALT_LEN);
  const iv = randomBytes(ENC_IV_LEN);
  const key = deriveBackupKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encPath = `${plainPath}.enc`;
  await writeFile(encPath, Buffer.concat([ENC_MAGIC, salt, iv, tag, ciphertext]), { mode: 0o600 });
  await unlink(plainPath);
  return encPath;
}

/** 解密 <file>.enc 到 outPath（恢复用；口令错误/文件损坏抛错） */
export async function decryptBackupFile(encPath: string, passphrase: string, outPath: string): Promise<void> {
  const buf = await readFile(encPath);
  if (buf.length < ENC_MAGIC.length + ENC_SALT_LEN + ENC_IV_LEN + ENC_TAG_LEN) {
    throw new Error('备份文件过短或格式不符');
  }
  if (!buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new Error('不是本服务产出的加密备份（magic 不匹配）');
  }
  let off = ENC_MAGIC.length;
  const salt = buf.subarray(off, (off += ENC_SALT_LEN));
  const iv = buf.subarray(off, (off += ENC_IV_LEN));
  const tag = buf.subarray(off, (off += ENC_TAG_LEN));
  const ciphertext = buf.subarray(off);
  const key = deriveBackupKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await writeFile(outPath, plaintext, { mode: 0o600 });
}

/**
 * 执行一次在线备份
 * @returns 备份文件路径（启用加密时为 .enc）
 */
export async function backupDatabase(): Promise<string> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupPath = join(BACKUP_DIR, `db-${ts}.sqlite`);

  await mkdir(BACKUP_DIR, { recursive: true });

  // SQLite Online Backup：不锁库，可在线执行；**必须 await**——
  // 该 API 返回 Promise，不等待就 stat 会读到未写完的备份文件
  const sourceDb = getDb() as unknown as InstanceType<typeof Database>;
  await sourceDb.backup(backupPath);
  const stats = await stat(backupPath);

  const passphrase = config.backupEncryptionKey;
  if (passphrase) {
    const encPath = await encryptBackupFile(backupPath, passphrase);
    logger.info(
      { path: encPath, sizeMB: (stats.size / 1048576).toFixed(2) },
      'SQLite 备份完成（AES-256-GCM 加密）'
    );
    return encPath;
  }

  logger.warn(
    { path: backupPath },
    'SQLite 备份完成（**明文**）——备份含 totp_secret 等敏感材料,建议设置 BACKUP_ENCRYPTION_KEY 启用加密'
  );
  return backupPath;
}

/**
 * 清理旧备份，仅保留最近 RETENTION_COUNT 份
 */
export async function pruneOldBackups(): Promise<{ deleted: number; kept: number }> {
  let files: string[];
  try {
    files = await readdir(BACKUP_DIR);
  } catch {
    return { deleted: 0, kept: 0 };
  }

  const backups = files
    // 兼容明文（.sqlite）与加密（.sqlite.enc）两种产物,统一纳入滚动保留
    .filter((f) => /^db-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.sqlite(\.enc)?$/.test(f))
    .sort()
    .reverse(); // 最新的在前

  const toDelete = backups.slice(RETENTION_COUNT);
  for (const f of toDelete) {
    await unlink(join(BACKUP_DIR, f));
  }

  logger.info(
    { deleted: toDelete.length, kept: backups.length - toDelete.length },
    '旧备份清理完成'
  );
  return { deleted: toDelete.length, kept: backups.length - toDelete.length };
}

/** 完整的备份流程：备份 + 清理 */
export async function runBackup(): Promise<void> {
  try {
    await backupDatabase();
    await pruneOldBackups();
  } catch (err) {
    logger.error({ err }, '备份失败');
    throw err;
  }
}

// 直接执行时运行
//   node dist/scripts/backup.js                        # 立即备份一次
//   node dist/scripts/backup.js --decrypt <enc> <out>  # 解密加密备份（恢复用）
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--decrypt') {
    const [, encPath, outPath] = args;
    const passphrase = config.backupEncryptionKey;
    if (!encPath || !outPath) {
      console.error('用法: node dist/scripts/backup.js --decrypt <备份.enc> <输出.sqlite>');
      process.exit(1);
    }
    if (!passphrase) {
      console.error('未设置 BACKUP_ENCRYPTION_KEY，无法解密');
      process.exit(1);
    }
    decryptBackupFile(encPath, passphrase, outPath)
      .then(() => {
        console.log(`✅ 已解密到 ${outPath}（用 SQLite 工具或直接挂载为数据卷恢复）`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ 解密失败（口令错误或文件损坏）:', err);
        process.exit(1);
      });
    // 备份流程
  } else {
    runBackup()
      .then(() => {
        console.log('✅ 备份完成');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ 备份失败:', err);
        process.exit(1);
      });
  }
}
