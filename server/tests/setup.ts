/**
 * 测试全局设置: 使用单一共享 DB, 避免多线程 env 竞争
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const SHARED_TEST_DB = join(tmpdir(), 'aoc-test-shared.db');

// 设置共享 DB 路径
process.env.AOC_DB_PATH = SHARED_TEST_DB;

// 清理旧文件
for (const suffix of ['', '-wal', '-shm']) {
  const p = SHARED_TEST_DB + suffix;
  if (existsSync(p)) { try { unlinkSync(p); } catch {} }
}

export { SHARED_TEST_DB };
