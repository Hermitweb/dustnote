/**
 * 把当前账号的主密码重置为 728245532
 * - 生成新 recovery code
 * - 重新派生 masterKey / wrappedMasterKey
 * - 更新 users 表
 * - 不动 notes（老笔记会变 🔒 解密失败）
 *
 * 用法：cd server && node reset-password.mjs
 */

import Database from 'better-sqlite3';
import { webcrypto } from 'node:crypto';
import {
  deriveKey,
  deriveRecoveryKey,
  deriveMasterKey,
  wrapMasterKey,
  KDF_PARAMS,
  toBase64,
  encodeUtf8,
} from '../shared/dist/crypto.js';

const NEW_PASSWORD = '728245532';
const DB_PATH = './data/dustnote.db';

const crypto = webcrypto;
const { randomBytes } = await import('node:crypto');

function randBytes(n) {
  return new Uint8Array(randomBytes(n));
}

function generateRecoveryCode() {
  const n = randBytes(4);
  const num = (n[0] * 0x1000000) + (n[1] * 0x10000) + (n[2] * 0x100) + n[3];
  return (num % 1_000_000).toString().padStart(6, '0');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const user = db.prepare('SELECT id FROM users LIMIT 1').get();
if (!user) {
  console.error('❌ 没有用户');
  process.exit(1);
}
const userId = user.id;
console.log('▶ user id:', userId);

// 1) 生成新的 recovery code + salt
const newRecoveryCode = generateRecoveryCode();
const newRecoverySalt = randBytes(16);
const recoveryKey = deriveRecoveryKey(newRecoveryCode, newRecoverySalt);

// 2) 新的 server master salt + password hash
const newServerMasterSalt = randBytes(16);
const newPasswordHash = deriveKey(NEW_PASSWORD, newServerMasterSalt, KDF_PARAMS);

// 3) 新的 client master salt + masterKey
const newClientMasterSalt = randBytes(16);
const newMasterKey = await deriveMasterKey(NEW_PASSWORD, newClientMasterSalt);

// 4) 用新的 recoveryKey wrap 新的 masterKey
const newWrapped = await wrapMasterKey(recoveryKey, newMasterKey);

// 5) 写库
const txn = db.transaction(() => {
  db.prepare(`
    UPDATE users
    SET password_hash = ?,
        master_salt = ?,
        recovery_salt = ?,
        recovery_hash = ?,
        wrapped_master_key = ?,
        kdf_version = 1,
        kdf_params = ?,
        client_master_salt = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    Buffer.from(newPasswordHash),
    Buffer.from(newServerMasterSalt),
    Buffer.from(newRecoverySalt),
    Buffer.from(deriveKey(newRecoveryCode, newRecoverySalt, { m: 16 * 1024, t: 2, p: 2, dkLen: 32 })),
    JSON.stringify(newWrapped),
    JSON.stringify({ m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen }),
    toBase64(newClientMasterSalt),
    userId
  );

  // 记一条 audit log
  db.prepare(`INSERT INTO audit_log (user_id, event, meta) VALUES (?, ?, ?)`)
    .run(userId, 'password_reset', JSON.stringify({ by: 'cli-script' }));
});

txn();
console.log('');
console.log('════════════════════════════════════════');
console.log('✅ 密码已重置为：728245532');
console.log('✅ 新的恢复码：', newRecoveryCode);
console.log('════════════════════════════════════════');
console.log('');
console.log('⚠️  现有 3 条笔记是用旧 masterKey 加密的，');
console.log('   新密码下会全部显示 🔒 解密失败。');
console.log('   若要清除这些失效笔记：');
console.log('   sqlite3 data/dustnote.db "DELETE FROM notes WHERE user_id=\'' + userId + '\';"');
console.log('');

db.close();
