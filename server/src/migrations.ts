/**
 * 迁移列表（按 id 顺序执行）
 *
 * 新增迁移：在数组末尾追加 { id, name, up }
 * 字段说明：
 *   id: 全局唯一，单调递增
 *   name: 短横线分隔的描述
 *   up: 在事务中执行（失败回滚）
 */

import type { Migration } from './db.js';
import { logger } from './logger.js';

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial',
    up: (db) => {
      db.exec(`
        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE users (
          id            TEXT PRIMARY KEY,
          password_hash BLOB NOT NULL,
          master_salt   BLOB NOT NULL,
          recovery_hash BLOB NOT NULL,
          recovery_salt BLOB NOT NULL,
          wrapped_master_key TEXT NOT NULL,
          kdf_version   INTEGER NOT NULL DEFAULT 1,
          kdf_params    TEXT NOT NULL,
          recovery_code_set INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE devices (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          platform      TEXT NOT NULL CHECK (platform IN ('web','desktop','android','ios','miniprogram')),
          fingerprint   TEXT NOT NULL,
          refresh_token_hash TEXT,
          last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_devices_user ON devices(user_id);

        CREATE TABLE notes (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ciphertext      BLOB NOT NULL,
          nonce           BLOB NOT NULL,
          key_version     INTEGER NOT NULL DEFAULT 1,
          is_pinned       INTEGER NOT NULL DEFAULT 0,
          is_favorite     INTEGER NOT NULL DEFAULT 0,
          deleted_at      TEXT,
          version         INTEGER NOT NULL DEFAULT 1,
          client_updated_at TEXT NOT NULL,
          server_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_notes_user ON notes(user_id);
        CREATE INDEX idx_notes_deleted ON notes(user_id, deleted_at);
        CREATE INDEX idx_notes_updated ON notes(user_id, server_updated_at);

        CREATE TABLE shares (
          id          TEXT PRIMARY KEY,
          note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token       TEXT NOT NULL UNIQUE,
          password_hash TEXT,
          expires_at  TEXT,
          view_count  INTEGER NOT NULL DEFAULT 0,
          revoked     INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_shares_note ON shares(note_id);
        CREATE INDEX idx_shares_user ON shares(user_id);

        CREATE TABLE folders (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          parent_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
          icon       TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_folders_user ON folders(user_id);

        CREATE TABLE tags (
          id    TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name   TEXT NOT NULL,
          color  TEXT,
          UNIQUE(user_id, name)
        );
        CREATE INDEX idx_tags_user ON tags(user_id);

        CREATE TABLE note_tags (
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (note_id, tag_id)
        );

        CREATE TABLE preferences (
          user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          theme       TEXT NOT NULL DEFAULT 'mint-dawn',
          mode        TEXT NOT NULL DEFAULT 'auto',
          font        TEXT NOT NULL DEFAULT 'system',
          density     TEXT NOT NULL DEFAULT 'standard',
          auto_lock   INTEGER NOT NULL DEFAULT 15,
          language    TEXT NOT NULL DEFAULT 'zh-CN',
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    TEXT,
          device_id  TEXT,
          event      TEXT NOT NULL,
          ip_hash    TEXT,
          meta       TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);

        INSERT INTO meta (key, value) VALUES ('schema_version', '1');
        INSERT INTO meta (key, value) VALUES ('created_at', datetime('now'));
      `);
    },
  },
  {
    id: 2,
    name: 'add-folder-id-to-notes',
    up: (db) => {
      db.exec(`
        ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(user_id, folder_id);
        UPDATE meta SET value = '2' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 3,
    name: 'make-nonce-nullable-on-notes',
    up: (db) => {
      // 历史设计：ciphertext 和 nonce 分离存储。E2EE v2：整信封 JSON 化后存 ciphertext，nonce 已嵌入 envelope.payload.n。
      // 这里把 nonce 改为可空，避免 E2EE v2 写库时缺列报错。
      db.exec(`
        -- SQLite 不支持直接 ALTER COLUMN，需重建表
        CREATE TABLE notes_new (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ciphertext      BLOB NOT NULL,
          nonce           BLOB,
          key_version     INTEGER NOT NULL DEFAULT 1,
          is_pinned       INTEGER NOT NULL DEFAULT 0,
          is_favorite     INTEGER NOT NULL DEFAULT 0,
          deleted_at      TEXT,
          version         INTEGER NOT NULL DEFAULT 1,
          client_updated_at TEXT NOT NULL,
          server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          folder_id       TEXT REFERENCES folders(id) ON DELETE SET NULL
        );
        INSERT INTO notes_new (id, user_id, ciphertext, nonce, key_version, is_pinned, is_favorite, deleted_at, version, client_updated_at, server_updated_at, folder_id)
        SELECT id, user_id, ciphertext, NULL, key_version, is_pinned, is_favorite, deleted_at, version, client_updated_at, server_updated_at, folder_id FROM notes;
        DROP TABLE notes;
        ALTER TABLE notes_new RENAME TO notes;
        CREATE INDEX idx_notes_user ON notes(user_id);
        CREATE INDEX idx_notes_deleted ON notes(user_id, deleted_at);
        CREATE INDEX idx_notes_updated ON notes(user_id, server_updated_at);
        CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(user_id, folder_id);
        UPDATE meta SET value = '3' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 4,
    name: 'add-client-master-salt',
    up: (db) => {
      // 客户端的 masterSalt（base64 文本）存到用户表，多端同步时让客户端能重新派生 masterKey
      db.exec(`
        ALTER TABLE users ADD COLUMN client_master_salt TEXT;
        UPDATE meta SET value = '4' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 5,
    name: 'add-snapshot-to-shares',
    up: (db) => {
      // v1 简化：分享时把明文快照存在 share 表，访客可直接获取
      // 真正的 E2EE 分享见 v1.5
      db.exec(`
        ALTER TABLE shares ADD COLUMN title TEXT;
        ALTER TABLE shares ADD COLUMN content TEXT;
        UPDATE meta SET value = '5' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 6,
    name: 'add-account-lockout-columns',
    up: (db) => {
      // 账号级锁定：连续 6 次密码错误后锁定 15 分钟。
      // 与 app.ts 中 IP 级 express-rate-limit 互补——
      // IP 限流防分布式爆破，账号锁定防单账号定向爆破。
      db.exec(`
        ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN locked_until TEXT;
        UPDATE meta SET value = '6' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 7,
    name: 'e2ee-shares',
    up: (db) => {
      // 破坏性变更：分享改为 secret-link（端到端加密）方案。
      //
      // 旧实现把笔记的明文快照存进 shares.title / shares.content，
      // 「服务端仅存密文」的说法对分享过的笔记并不成立。
      //
      // 新实现：客户端随机生成 shareKey 加密 {title, content}，服务端只存密文；
      // shareKey 放在分享链接的 URL fragment 里（`#` 后面的部分浏览器不会发给
      // 服务端），访客本地解密。同时用 masterKey 包装一份 shareKey 存库，
      // 好让主人换设备后仍能还原出完整链接——服务端两边都解不开。
      //
      // 已有分享是明文快照，没有对应的 shareKey 可迁移，只能丢弃。
      const existing = db.prepare('SELECT COUNT(*) AS c FROM shares').get() as { c: number };
      if (existing.c > 0) {
        logger.warn(
          { shares: existing.c },
          '分享升级到 E2EE：已删除全部旧分享链接（旧数据是明文快照，无法转成密文），请重新分享'
        );
      }

      db.exec(`
        DROP TABLE shares;

        CREATE TABLE shares (
          id            TEXT PRIMARY KEY,
          note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token         TEXT NOT NULL UNIQUE,
          -- shareKey 加密的 {title, content}，服务端只见密文
          ciphertext    TEXT NOT NULL,
          -- masterKey 包装的 shareKey，仅供主人还原链接
          wrapped_share_key TEXT NOT NULL,
          password_hash TEXT,
          expires_at    TEXT,
          view_count    INTEGER NOT NULL DEFAULT 0,
          revoked       INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_shares_note ON shares(note_id);
        CREATE INDEX idx_shares_user ON shares(user_id);

        UPDATE meta SET value = '7' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 8,
    name: 'auth-protocol-v2',
    up: (db) => {
      // 破坏性变更：认证协议 v1 → v2
      //
      // v1 的两个致命缺陷：
      //   1. 客户端把主密码明文发给服务端，服务端又存了 client_master_salt，
      //      于是服务端能自行推导 masterKey —— E2EE 对服务端形同虚设。
      //   2. masterKey = f(password)，用恢复码重置后 masterKey 变了，
      //      历史笔记全部变成解不开的密文。
      //
      // v2 改为：masterKey 随机生成，分别用「主密码 KEK」和「恢复码 KEK」
      // 包装两份存库；服务端只存 authKey 的 scrypt 哈希。
      //
      // v1 的凭据在 v2 下无法换算（需要用户重新输入密码），因此已有账号
      // 必须重新 setup。外键 CASCADE 会带走 notes/shares/folders/tags。
      // 升级前请自行备份 DB 文件。
      db.exec(`
        ALTER TABLE users ADD COLUMN pw_salt BLOB;
        ALTER TABLE users ADD COLUMN rc_salt BLOB;
        ALTER TABLE users ADD COLUMN auth_hash TEXT;
        ALTER TABLE users ADD COLUMN recovery_auth_hash TEXT;
        ALTER TABLE users ADD COLUMN wrapped_master_key_pw TEXT;
        ALTER TABLE users ADD COLUMN wrapped_master_key_rc TEXT;
      `);

      // 只清理旧协议残留的账号（auth_hash 为空即为 v1 账号）
      const legacy = db
        .prepare('SELECT COUNT(*) AS c FROM users WHERE auth_hash IS NULL')
        .get() as { c: number };
      if (legacy.c > 0) {
        logger.warn(
          { users: legacy.c },
          '认证协议升级到 v2：已清除旧协议账号及其全部笔记（旧密文无法在新协议下解开），请重新 setup'
        );
        db.exec(`DELETE FROM users WHERE auth_hash IS NULL;`);
      }

      db.exec(`UPDATE meta SET value = '8' WHERE key = 'schema_version';`);
    },
  },
  {
    id: 9,
    name: 'note-versions',
    up: (db) => {
      // 笔记历史版本表：每次笔记内容变更时，将旧密文快照存入此表。
      // 服务端只存密文，明文在客户端解密后查看。
      db.exec(`
        CREATE TABLE note_versions (
          id               TEXT PRIMARY KEY,
          note_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ciphertext       BLOB NOT NULL,
          key_version      INTEGER NOT NULL DEFAULT 1,
          note_version     INTEGER NOT NULL,
          client_updated_at TEXT NOT NULL,
          created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_note_versions_note ON note_versions(note_id, created_at DESC);
      `);
      db.exec(`UPDATE meta SET value = '9' WHERE key = 'schema_version';`);
    },
  },
  {
    id: 10,
    name: 'templates',
    up: (db) => {
      // 笔记模板系统（v2.1.0）：
      // - 预设模板：user_id 为 NULL，全用户共享，content 为明文 Markdown
      // - 自定义模板：user_id 绑定用户，content 为 ciphertext JSON（E2EE）
      // 客户端按 is_preset 标志决定明文读取还是解密。
      db.exec(`
        CREATE TABLE templates (
          id          TEXT PRIMARY KEY,
          user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category    TEXT NOT NULL DEFAULT 'custom',
          icon        TEXT NOT NULL DEFAULT '📄',
          content     TEXT NOT NULL,
          is_preset   INTEGER NOT NULL DEFAULT 0,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_templates_user ON templates(user_id);
        CREATE INDEX idx_templates_preset ON templates(is_preset, sort_order);

        -- 预设模板种子数据（user_id = NULL, is_preset = 1, content = 明文 Markdown）
        INSERT INTO templates (id, user_id, name, description, category, icon, content, is_preset, sort_order) VALUES
          ('tpl-blank',       NULL, '空白笔记', '从零开始',                        'blank',   '📄', '', 1, 1),
          ('tpl-journal',     NULL, '每日日记', '记录今天的所思所感',              'journal', '📔', '# {{date}} 日记\n\n## 今日心情\n\n\n## 三件感恩的事\n1. \n2. \n3. \n\n## 自由书写\n\n', 1, 2),
          ('tpl-meeting',     NULL, '会议记录', '结构化的会议纪要',                'meeting', '🗓️', '# 会议主题\n\n- **时间**：\n- **地点**：\n- **参会**：\n\n## 议题\n\n1. \n2. \n\n## 决议\n\n- \n\n## 待办（Owner / 截止）\n\n- [ ]  /  \n', 1, 3),
          ('tpl-todo',        NULL, '待办清单', '可勾选的任务列表',                'todo',    '✅', '# 待办清单\n\n## 今天\n- [ ] \n- [ ] \n\n## 本周\n- [ ] \n- [ ] \n\n## 已完成\n- [x] \n', 1, 4),
          ('tpl-reading',     NULL, '阅读笔记', '读书摘要与思考',                  'reading', '📚', '# 《书名》\n\n- **作者**：\n- **进度**：\n- **评分**：⭐⭐⭐⭐⭐\n\n## 摘要\n\n\n## 关键观点\n1. \n2. \n\n## 我的思考\n\n', 1, 5),
          ('tpl-project',     NULL, '项目计划', '项目目标与里程碑',                'project', '🚀', '# 项目名称\n\n## 背景与目标\n\n\n## 范围\n- **包含**：\n- **不包含**：\n\n## 里程碑\n| 里程碑 | 截止日期 | 状态 |\n| ------ | -------- | ---- |\n|        |          |      |\n\n## 风险\n- \n', 1, 6);

        UPDATE meta SET value = '10' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 11,
    name: 'share-password-lockout',
    up: (db) => {
      // 单分享密码爆破防护。
      // 账号锁定（users.failed_attempts）保护登录入口，但分享密码校验
      // 走的是另一条路径——之前没有任何失败计数，攻击者可对单个分享
      // 链接的密码无限穷举。这里复用 lockout 策略，但加在 shares 表上：
      // 6 次错误 → 该分享被锁 15 分钟。
      db.exec(`
        ALTER TABLE shares ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE shares ADD COLUMN locked_until TEXT;
        UPDATE meta SET value = '11' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 12,
    name: 'folder-depth-and-branch',
    up: (db) => {
      // 目录结构范式（见 docs/note-system-folder-structure-spec.md）：
      // - depth：文件夹层级深度（Root 为虚拟 0；一级=1，二级=2）。最大 2，禁止四级+。
      // - branch：顶层二元隔离（'work'=业务·项目，'personal'=个人·沉淀）。
      //   顶层文件夹必属某一分支；子文件夹继承父分支，不可单独改。
      db.exec(`
        ALTER TABLE folders ADD COLUMN depth INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE folders ADD COLUMN branch TEXT CHECK (branch IN ('work','personal') OR branch IS NULL);
      `);

      // 回填 depth：按 parent 链向上计数。深度很浅（规范限制 ≤2），简单循环即可。
      const all = db.prepare('SELECT id, parent_id FROM folders').all() as {
        id: string;
        parent_id: string | null;
      }[];
      const byId = new Map(all.map((f) => [f.id, f]));
      const computeDepth = (start: { id: string; parent_id: string | null }): number => {
        let d = 1;
        let cur: { id: string; parent_id: string | null } | undefined = start;
        const seen = new Set<string>();
        while (cur && cur.parent_id) {
          if (seen.has(cur.id)) break; // 防御环
          seen.add(cur.id);
          cur = byId.get(cur.parent_id);
          if (cur) d++;
        }
        return d;
      };
      const upd = db.prepare('UPDATE folders SET depth = ? WHERE id = ?');
      for (const f of all) {
        upd.run(computeDepth(f), f.id);
      }

      // 既有顶层文件夹若无分支，默认归为 'work'（保持向后兼容；新创建强制分支）。
      db.prepare(
        `UPDATE folders SET branch = 'work' WHERE parent_id IS NULL AND branch IS NULL`
      ).run();
      db.exec(`UPDATE meta SET value = '12' WHERE key = 'schema_version';`);
    },
  },
  {
    id: 13,
    name: 'totp-2fa',
    up: (db) => {
      db.exec(`
        ALTER TABLE users ADD COLUMN totp_secret TEXT;
        ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
        UPDATE meta SET value = '13' WHERE key = 'schema_version';
      `);
    },
  },
  {
    id: 14,
    name: 'webauthn-devices',
    up: (db) => {
      db.exec(`
        CREATE TABLE webauthn_devices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credential_id TEXT NOT NULL UNIQUE,
          credential_public_key BLOB NOT NULL,
          counter INTEGER NOT NULL DEFAULT 0,
          transports TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_webauthn_user ON webauthn_devices(user_id);
        UPDATE meta SET value = '14' WHERE key = 'schema_version';
      `);
    },
  },
];
