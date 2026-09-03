import type { FastifyInstance } from 'fastify';
import { eventBus, type AocEvent } from '../services/EventBus.js';

export async function eventRoutes(app: FastifyInstance) {
  // SSE 端点 — 实时推送事件
  app.get('/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',  // 禁用 nginx 缓冲
    });

    // 发送初始连接成功事件
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    // 心跳 (防代理断连)
    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 15_000);

    // 订阅事件
    const unsubscribe = eventBus.subscribe((event: AocEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // 清理
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
