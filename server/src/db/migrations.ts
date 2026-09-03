// ── 一次性 schema 迁移 ──
// SQLite 无法 ALTER 掉列上的 CHECK 约束, 只能重建表。
// 现有库的 connections.kind 带 CHECK(kind IN ('openclaw','hermes','opencode')),
// 会拒绝 kind='a2a'。此处永久移除该 CHECK, kind 合法性交给应用层 zod 校验。
//
// ⚠️ 重建表必须先 PRAGMA foreign_keys=OFF, 否则 DROP TABLE 会触发
//    sessions / projects / sync_tasks / chat_sessions / agent_metrics 的
//    ON DELETE CASCADE, 把业务数据全部删光。

import type { DatabaseSync } from 'node:sqlite';

const KIND_CHECK_RE = /,?\s*CHECK\s*\(\s*kind\s+IN\s*\([^)]*\)\s*\)/i;

/**
 * 移除 connections.kind 的 CHECK 约束 (幂等)。
 * @returns 是否执行了重建
 */
export function migrateDropKindCheck(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'")
    .get() as { sql?: string } | undefined;

  const ddl = row?.sql;
  if (!ddl) return false;                    // 表不存在 — 由 SCHEMA 负责创建
  if (!KIND_CHECK_RE.test(ddl)) return false; // 已是新 schema

  const cols = (db.prepare('PRAGMA table_info(connections)').all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (cols.length === 0) return false;

  const newDdl = ddl
    .replace(KIND_CHECK_RE, '')
    .replace(/CREATE TABLE\s+connections\b/i, 'CREATE TABLE connections__new');

  const total = (db.prepare('SELECT COUNT(*) AS n FROM connections').get() as { n: number }).n;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(newDdl);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    db.exec(`INSERT INTO connections__new (${colList}) SELECT ${colList} FROM connections`);

    const migrated = (db.prepare('SELECT COUNT(*) AS n FROM connections__new').get() as { n: number }).n;
    if (migrated !== total) {
      db.exec('ROLLBACK');
      throw new Error(`connections 迁移校验失败: 原 ${total} 行 → 新 ${migrated} 行, 已回滚`);
    }

    db.exec('DROP TABLE connections');
    db.exec('ALTER TABLE connections__new RENAME TO connections');
    db.exec('COMMIT');

    // 重建后确认外键引用未破坏
    const fkIssues = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    if (fkIssues.length > 0) {
      throw new Error(`connections 迁移后外键校验失败: ${fkIssues.length} 处问题`);
    }
    console.log(`[db] 已移除 connections.kind 的 CHECK 约束 (迁移 ${migrated} 行)`);
    return true;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 无活动事务 */ }
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
