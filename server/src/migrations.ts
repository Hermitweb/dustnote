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
];
