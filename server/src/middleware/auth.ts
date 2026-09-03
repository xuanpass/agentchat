import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { getDb } from '../db/index.js';

// 内存缓存: API Key 启动时加载, 轮换时更新 (避免每次请求查 DB)
let cachedApiKey: string | null = null;

/**
 * API Key 鉴权中间件
 * 
 * 流程:
 * 1. 启动时从 app_settings 读取 api_key (首次启动自动生成)
 * 2. 前端通过 POST /api/auth/verify 提交 key → 存入 localStorage
 * 3. 后续请求通过 X-API-Key header 携带
 * 4. 白名单路径不检查: /api/health, /api/auth/**
 */

// 不需要鉴权的路径
const WHITELIST = new Set([
  '/api/health',
  '/api/auth/verify',
  '/api/auth/key-info',  // 用于前端判断是否需要登录
]);

/** 安全的字符串比较 (防时序攻击) */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** 从 DB 读取当前 API key, 若无则生成 */
export function getOrCreateApiKey(): string {
  const db = getDb();
  // 确保表存在
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('api_key') as any;
  if (row?.value) {
    cachedApiKey = row.value;
    return row.value;
  }

  // 优先使用环境变量固定 key (用于测试)
  const envKey = process.env.AOC_API_KEY;
  if (envKey && envKey.startsWith('aoc_')) {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('api_key', envKey);
    cachedApiKey = envKey;
    console.log(`[auth] 使用固定 API Key (from env): ${envKey}`);
    return envKey;
  }

  // 生成新 key: aoc_ + 32 hex chars
  const key = 'aoc_' + randomBytes(24).toString('hex');
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('api_key', key);
  cachedApiKey = key;
  console.log(`[auth] 自动生成 API Key: ${key}`);
  console.log(`[auth] 请在首次登录时输入此 Key`);
  return key;
}

/** 鉴权 hook — 注册到 onRequest */
export function authHook(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const path = req.url.split('?')[0];

  // 白名单放行
  if (WHITELIST.has(path) || path.startsWith('/api/auth/')) {
    return done();
  }

  // 读取请求 key (header 或 query param, SSE 只能用 query)
  const headerKey = req.headers['x-api-key'];
  const headerVal = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const queryVal = (req.query as any)?.key;
  const key = headerVal || queryVal;

  if (!key) {
    reply.code(401).send({ error: '未授权', code: 'MISSING_KEY' });
    return;
  }

  // 使用内存缓存 (避免每次请求查 DB)
  const expected = cachedApiKey;
  if (!expected || safeCompare(key, expected)) {
    return done();
  }

  reply.code(401).send({ error: '无效的 API Key', code: 'INVALID_KEY' });
}

/** 重置 API key (用于轮换) */
export function rotateApiKey(): string {
  const key = 'aoc_' + randomBytes(24).toString('hex');
  getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('api_key', key);
  cachedApiKey = key;
  console.log(`[auth] API Key 已轮换: ${key}`);
  return key;
}
