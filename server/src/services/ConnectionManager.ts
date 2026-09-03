import type { AgentConnection, HealthProbe } from '../types.js';
import { getDriver } from '../adapters/index.js';
import { eventBus } from './EventBus.js';
import { logAudit } from '../routes/audit.js';
import { emitAlert } from '../routes/alerts.js';

const HEALTH_CHECK_INTERVAL_MS = Number(process.env.AOC_HEALTH_INTERVAL_MS ?? 30_000);

/** 获取 ConnectionManager 单例(供适配器内部使用) */
export function getConnectionManager(): typeof ConnectionManager {
  return ConnectionManager;
}

// ── ConnectionManager: 每个 Connection 独立连接生命周期 (§5.1.1) ──

interface ManagedConnection {
  conn: AgentConnection;
  // 各适配器内部的长连接句柄(如 WebSocket)
  handle?: any;
  lastError?: string;
  retryCount: number;
  lastRetryAt?: number;
}

const MAX_RETRY = 5;
const RETRY_BASE_MS = 1_000;

const manager = new Map<string, ManagedConnection>();

export const ConnectionManager = {
  register(conn: AgentConnection): void {
    if (!manager.has(conn.id)) manager.set(conn.id, { conn, retryCount: 0 });
    else manager.get(conn.id)!.conn = conn;
  },

  unregister(id: string): void {
    const m = manager.get(id);
    if (m?.handle?.close) m.handle.close();
    manager.delete(id);
  },

  /** 操作前惰性建连 (未注册时自动从 DB 加载) */
  async ensureConnected(id: string): Promise<void> {
    let m = manager.get(id);
    if (!m) {
      // BFF 重启后内存态丢失, 从 DB 重新加载
      const { ConnectionRepo } = await import('../db/connections.js');
      const conn = ConnectionRepo.get(id);
      if (!conn) throw new Error(`Connection ${id} 不存在`);
      manager.set(id, { conn, retryCount: 0 });
      m = manager.get(id)!;
    }
    if (m.handle && m.handle.readyState === 1 /* OPEN */) return;
    await connect(m);
  },

  async disconnect(id: string): Promise<void> {
    const m = manager.get(id);
    if (m?.handle?.close) { m.handle.close(); m.handle = undefined; }
  },

  /** 探活 + 刷新 status/capabilities */
  async health(id: string): Promise<HealthProbe> {
    const m = manager.get(id);
    if (!m) return { ok: false, latencyMs: 0, capabilities: emptyCaps(), error: '未注册' };
    const prevStatus = m.conn.status;
    const driver = getDriver(m.conn.kind);
    const probe = await driver.test(m.conn.endpoint.baseUrl, m.conn.auth);
    m.conn.status = probe.ok ? 'connected' : 'error';
    m.conn.lastSeenAt = probe.ok ? Date.now() : m.conn.lastSeenAt;
    m.conn.capabilities = probe.capabilities;
    if (!probe.ok) m.lastError = probe.error;
    // 持久化状态到 DB (前端从 DB 读取)
    const { ConnectionRepo } = await import('../db/connections.js');
    ConnectionRepo.update(id, {
      status: probe.ok ? 'connected' : 'error' as any,
      capabilities: probe.capabilities,
      lastSeenAt: probe.ok ? Date.now() : undefined,
    });
    // 状态变化时发送事件 + 告警
    if (prevStatus !== m.conn.status) {
      eventBus.emitEvent({
        type: 'connection.status',
        data: { id, name: m.conn.name, kind: m.conn.kind, status: m.conn.status, prevStatus },
      });
      // 连接断开时创建告警
      if (m.conn.status === 'error' && prevStatus === 'connected') {
        emitAlert({
          type: 'connection_error',
          severity: 'warning',
          message: `连接 "${m.conn.name}" 断开: ${probe.error || '未知错误'}`,
          sourceType: 'connection',
          sourceId: id,
        });
        eventBus.emitEvent({
          type: 'alert.created',
          data: { connectionId: id, connectionName: m.conn.name, error: probe.error },
        });
      }
    }
    eventBus.emitEvent({
      type: 'connection.health',
      data: { id, ok: probe.ok, latencyMs: probe.latencyMs },
    });
    return probe;
  },

  /** 指数退避重连 */
  async reconnect(id: string): Promise<void> {
    const m = manager.get(id);
    if (!m) throw new Error(`Connection ${id} 未注册`);
    if (m.retryCount >= MAX_RETRY) {
      m.conn.status = 'error';
      m.lastError = `重试 ${MAX_RETRY} 次后放弃`;
      return;
    }
    const delay = RETRY_BASE_MS * 2 ** m.retryCount;
    m.retryCount++;
    m.lastRetryAt = Date.now();
    await new Promise((r) => setTimeout(r, delay));
    await connect(m);
  },

  getHandle(id: string): any | undefined { return manager.get(id)?.handle; },
  getManaged(id: string): ManagedConnection | undefined { return manager.get(id); },
  all(): ManagedConnection[] { return [...manager.values()]; },

  /** BFF 启动时从 DB 恢复连接注册 */
  async restoreFromDb(): Promise<number> {
    const { ConnectionRepo } = await import('../db/connections.js');
    const conns = ConnectionRepo.list();
    for (const conn of conns) this.register(conn);
    return conns.length;
  },

  /** 启动周期性健康检查 */
  startHealthChecks(): void {
    if (healthCheckTimer) return; // 已启动
    healthCheckTimer = setInterval(async () => {
      const all = this.all();
      // 并行探测所有连接 (连接数多时显著缩短总耗时)
      await Promise.all(all.map(m => this.health(m.conn.id).catch(() => {})));
    }, HEALTH_CHECK_INTERVAL_MS);
    // 允许进程退出不被定时器阻塞
    healthCheckTimer.unref?.();
    console.log(`健康检查已启动 (间隔 ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
  },

  /** 停止周期性健康检查 */
  stopHealthChecks(): void {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
  },

  /** 立即对所有连接执行一次健康检查 */
  async healthCheckAll(): Promise<void> {
    const all = this.all();
    await Promise.all(all.map(m => this.health(m.conn.id).catch(() => {})));
  },
};

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function connect(m: ManagedConnection): Promise<void> {
  m.conn.status = 'connecting';
  try {
    // CLI 驱动: 不需要持久连接, 直接 test 探测
    const driver = getDriver(m.conn.kind);
    const probe = await driver.test(m.conn.endpoint.baseUrl, m.conn.auth);
    m.conn.status = probe.ok ? 'connected' : 'error';
    m.conn.capabilities = probe.capabilities;
    m.conn.lastSeenAt = probe.ok ? Date.now() : m.conn.lastSeenAt;
    if (probe.ok) m.retryCount = 0;
  } catch (err: any) {
    m.conn.status = 'error';
    m.lastError = err.message;
  }
}

function emptyCaps(): any {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}
