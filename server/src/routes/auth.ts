import type { FastifyInstance } from 'fastify';
import { getOrCreateApiKey, rotateApiKey } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // 前端检查是否需要登录
  app.get('/auth/key-info', async () => {
    const key = getOrCreateApiKey();
    // 只暴露前 8 位 + 后 4 位, 用于确认
    return {
      required: true,
      hint: key.slice(0, 12) + '...' + key.slice(-4),
    };
  });

  // 验证 API key (前端登录)
  app.post<{ Body: { apiKey: string } }>('/auth/verify', async (req, reply) => {
    const { apiKey } = req.body;
    if (!apiKey) return reply.code(400).send({ error: '请提供 API Key' });

    const key = getOrCreateApiKey();
    if (apiKey === key) {
      return { ok: true, key };
    }
    return reply.code(401).send({ error: '无效的 API Key' });
  });

  // 轮换 API key
  app.post('/auth/rotate', async (req, reply) => {
    const key = rotateApiKey();
    return { ok: true, key };
  });
}
