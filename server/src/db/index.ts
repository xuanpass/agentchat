import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA } from './schema.js';
import { migrateDropKindCheck } from './migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data.db');

let db: DatabaseSync;
let dbPath: string | undefined;

export function getDb(): DatabaseSync {
  const currentPath = process.env.AOC_DB_PATH ?? DEFAULT_DB_PATH;
  if (!db || dbPath !== currentPath) {
    db = new DatabaseSync(currentPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    applySchema(db);
    // 老库: 移除 connections.kind 的 CHECK 约束 (允许 kind='a2a')
    migrateDropKindCheck(db);
    dbPath = currentPath;
  }
  return db;
}

export function migrate(): void {
  const d = getDb();
  applySchema(d);
  migrateDropKindCheck(d);
  console.log('[db] migration applied:', process.env.AOC_DB_PATH ?? DEFAULT_DB_PATH);
}

/** 逐条执行 schema, 避免单条失败导致全部回滚 */
function applySchema(d: DatabaseSync): void {
  for (const stmt of SCHEMA.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed.length > 0) d.exec(trimmed);
  }
}
