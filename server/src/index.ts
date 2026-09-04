// ── 手动加载 .env (Node 不内置 dotenv) ──
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
{
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const idx = t.indexOf('=');
      const key = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { migrate } from './db/index.js';
import { connectionRoutes } from './routes/connections.js';
import { sessionRoutes } from './routes/sessions.js';
import { teamRoutes } from './routes/teams.js';
import { projectRoutes } from './routes/projects.js';
import { runRoutes } from './routes/runs.js';
import { capabilityRoutes, memberRoutes } from './routes/capabilities.js';
import { skillMarketRoutes } from './routes/skill-market.js';
import { searchRoutes } from './routes/search.js';
import { auditRoutes, auditMiddleware } from './routes/audit.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { metricsRoutes, startMetricsSnapshots } from './routes/metrics.js';
import { alertRoutes } from './routes/alerts.js';
import { tokenUsageRoutes } from './routes/token-usage.js';
import { alertRuleRoutes } from './routes/alert-rules.js';
import { workflowRoutes } from './routes/workflows.js';
import { modelProviderRoutes } from './routes/model-providers.js';
import { agentMetricsRoutes } from './routes/agent-metrics.js';
import { dashboardWidgetRoutes } from './routes/dashboard-widgets.js';
import { pluginEcosystemRoutes } from './routes/plugin-ecosystem.js';
import { agentChatRoutes } from './routes/agent-chat.js';
import { notificationRoutes } from './routes/notifications.js';
import { systemHealthRoutes } from './routes/system-health.js';
import { reportRoutes } from './routes/reports.js';
import { dataManagementRoutes } from './routes/data-management.js';
import { dashboardCustomizeRoutes } from './routes/dashboard-customize.js';
import { authHook } from './middleware/auth.js';
import { registerDriver } from './adapters/index.js';
import { openclawWsDriver } from './adapters/openclaw-ws.js';
import { hermesDriver } from './adapters/hermes.js';
import { opencodeDriver } from './adapters/opencode.js';
import { a2aDriver } from './adapters/a2a.js';
import { getOrCreateApiKey } from './middleware/auth.js';

const PORT = Number(process.env.AOC_PORT ?? 3001);
const HOST = process.env.AOC_HOST ?? '127.0.0.1';

async function main() {
  // 注册驱动 (OpenClaw 使用 WS 直接驱动, 无需 CLI 子进程)
  registerDriver(openclawWsDriver);
  registerDriver(hermesDriver);
  registerDriver(opencodeDriver);
  // A2A (Agent2Agent) — 统一接入任何 A2A v1.0 端点 (OpenClaw / Hermes / ADK / LangChain...)
  registerDriver(a2aDriver);

  // 建表
  migrate();

  // 初始化 API Key (首次启动自动生成)
  const apiKey = getOrCreateApiKey();
  console.log(`[auth] API Key: ${apiKey}`);

  // 从 DB 恢复连接注册 (BFF 重启后内存态丢失)
  const { ConnectionManager } = await import('./services/ConnectionManager.js');
  const restored = await ConnectionManager.restoreFromDb();
  console.log(`已恢复 ${restored} 个连接注册`);

  // 启动周期性健康检查 (每 30s 刷新所有连接状态)
  ConnectionManager.startHealthChecks();
  // 启动指标历史快照 (每 30s)
  startMetricsSnapshots();
  // 启动后立即执行一次健康检查
  ConnectionManager.healthCheckAll().then(() => {
    console.log('初始健康检查完成');
  });

  const app = Fastify({ logger: true });

  // CORS: 支持白名单 (生产环境安全加固)
  const corsOrigin = process.env.AOC_CORS_ORIGIN;
  if (corsOrigin) {
    const allowedOrigins = corsOrigin.split(',').map(s => s.trim());
    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error(`Origin ${origin} not allowed`), false);
        }
      },
      credentials: true,
    });
    console.log(`  CORS 白名单: ${allowedOrigins.join(', ')}`);
  } else {
    await app.register(cors, { origin: true, credentials: true });
  }

  // gzip 压缩 (JSON 响应通常可压缩 60-80%)
  await app.register(compress, { global: true, encodings: ['gzip', 'deflate', 'br'] });

  // 速率限制 (安全加固: 防暴力破解/DDos)
  await app.register(rateLimit, {
    global: true,
    max: 100,           // 每窗口最多 100 请求
    timeWindow: '1m',   // 1 分钟窗口
    errorResponseBuilder: (req, context) => ({
      error: '请求过于频繁,请稍后再试',
      code: 'RATE_LIMITED',
      retryAfter: context.after,
    }),
    // SSE 端点豁免 (长连接不计入)
    onExceeding: (req) => {
      if (req.url?.includes('/stream') || req.url?.includes('/events')) {
        // 不计数
      }
    },
  });

  // 放行空 body 的 DELETE/PATCH 请求 (Fastify 默认拒绝 Content-Type: application/json + 空 body)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const parsed = (typeof body === 'string' ? JSON.parse(body) : body) as Record<string, unknown> | object;
    done(null, parsed);
  });

  // 生产环境: 提供前端静态文件
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webDist = join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'Not Found' });
      return reply.sendFile('index.html');
    });
    console.log(`  前端静态文件服务: ${webDist}`);
  }

  // 审计中间件 (自动记录 mutating 请求)
  app.addHook('onRequest', auditMiddleware);

  // API Key 鉴权 (白名单: health / auth/*)
  app.addHook('onRequest', authHook);

  // 健康检查
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  // 认证路由 (必须在鉴权 hook 之前注册, 但 hook 的 whitelist 已覆盖)
  await app.register(authRoutes, { prefix: '/api' });

  // SSE 实时事件 (鉴权通过 query param key)
  await app.register(eventRoutes, { prefix: '/api' });

  // 路由
  await app.register(connectionRoutes, { prefix: '/api' });
  await app.register(sessionRoutes, { prefix: '/api' });
  await app.register(teamRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api' });
  await app.register(runRoutes, { prefix: '/api' });
  await app.register(capabilityRoutes, { prefix: '/api' });
  await app.register(memberRoutes, { prefix: '/api' });
  await app.register(skillMarketRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(auditRoutes, { prefix: '/api' });
  await app.register(metricsRoutes, { prefix: '/api' });
  await app.register(alertRoutes, { prefix: '/api' });
  await app.register(tokenUsageRoutes, { prefix: '/api' });
  await app.register(alertRuleRoutes, { prefix: '/api' });
  await app.register(workflowRoutes, { prefix: '/api' });
  await app.register(modelProviderRoutes, { prefix: '/api' });
  await app.register(agentMetricsRoutes, { prefix: '/api' });
  await app.register(dashboardWidgetRoutes, { prefix: '/api' });
  await app.register(pluginEcosystemRoutes, { prefix: '/api' });
  await app.register(agentChatRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(systemHealthRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(dataManagementRoutes, { prefix: '/api' });
  await app.register(dashboardCustomizeRoutes, { prefix: '/api' });

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n  Agent Ops Console BFF running at http://${HOST}:${PORT}\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
