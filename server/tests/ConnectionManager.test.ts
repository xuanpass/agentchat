import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionManager } from '../src/services/ConnectionManager.js';
import type { AgentConnection } from '../src/types.js';

const { mockDriver } = vi.hoisted(() => {
  const mockDriver = {
    kind: 'openclaw' as const,
    test: vi.fn().mockResolvedValue({
      ok: true, latencyMs: 50,
      capabilities: { sessions: true, teams: true, skills: true, plugins: true, mcp: true, streaming: true },
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 's1', remoteSessionId: 'rs1', title: 'test' }),
    resumeSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ sessionId: 'rs1', streamId: 'st1', response: 'hello' }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    listCapabilities: vi.fn().mockResolvedValue([]),
    pushCapability: vi.fn().mockResolvedValue({ ok: true, targetConnectionId: 'c1', capabilityName: 'test', action: 'pushed' as const }),
    pullCapability: vi.fn().mockResolvedValue({ id: 'cap1', name: 'test', type: 'skill' as const, sourceKind: 'openclaw' as const }),
    diffCapability: vi.fn().mockResolvedValue({ added: [], changed: [], removed: [], unchanged: ['test'] }),
    deleteCapability: vi.fn().mockResolvedValue(undefined),
  };
  return { mockDriver };
});

vi.mock('../src/adapters/index.js', () => ({
  getDriver: () => mockDriver,
  registerDriver: vi.fn(),
  allDrivers: vi.fn().mockReturnValue([mockDriver]),
}));

vi.mock('../src/db/connections.js', () => ({
  ConnectionRepo: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeConn(overrides?: Partial<AgentConnection>): AgentConnection {
  return {
    id: 'test-1', name: 'Test', kind: 'openclaw',
    endpoint: { baseUrl: 'ws://localhost:10089' },
    auth: { type: 'none', encrypted: '', iv: '', tag: '' },
    status: 'disconnected',
    capabilities: { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false },
    createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  };
}

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清理所有连接
    for (const m of ConnectionManager.all()) {
      ConnectionManager.unregister(m.conn.id);
    }
  });

  it('应该注册连接', () => {
    const conn = makeConn();
    ConnectionManager.register(conn);
    expect(ConnectionManager.getManaged('test-1')).toBeDefined();
    expect(ConnectionManager.getManaged('test-1')!.conn.name).toBe('Test');
  });

  it('应该注销连接', () => {
    const conn = makeConn();
    ConnectionManager.register(conn);
    ConnectionManager.unregister('test-1');
    expect(ConnectionManager.getManaged('test-1')).toBeUndefined();
  });

  it('健康检查应该更新状态为 connected', async () => {
    const conn = makeConn();
    ConnectionManager.register(conn);

    const probe = await ConnectionManager.health('test-1');
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(conn.status).toBe('connected');
  });

  it('健康检查失败应该更新状态为 error', async () => {
    const conn = makeConn();
    ConnectionManager.register(conn);
    mockDriver.test.mockResolvedValueOnce({
      ok: false, latencyMs: 0,
      capabilities: { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false },
      error: '连接超时',
    });

    const probe = await ConnectionManager.health('test-1');
    expect(probe.ok).toBe(false);
    expect(conn.status).toBe('error');
  });

  it('未注册连接的健康检查应该返回错误', async () => {
    const probe = await ConnectionManager.health('nonexistent');
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe('未注册');
  });

  it('healthCheckAll 应该检查所有连接', async () => {
    const c1 = makeConn({ id: 'c1', name: 'C1' });
    const c2 = makeConn({ id: 'c2', name: 'C2' });
    ConnectionManager.register(c1);
    ConnectionManager.register(c2);

    await ConnectionManager.healthCheckAll();
    expect(mockDriver.test).toHaveBeenCalledTimes(2);
  });

  it('getHandle 应该返回 undefined (CLI 驱动无持久连接)', () => {
    const conn = makeConn();
    ConnectionManager.register(conn);
    expect(ConnectionManager.getHandle('test-1')).toBeUndefined();
  });

  it('all 应该返回所有管理的连接', () => {
    const c1 = makeConn({ id: 'c1' });
    const c2 = makeConn({ id: 'c2' });
    ConnectionManager.register(c1);
    ConnectionManager.register(c2);
    expect(ConnectionManager.all().length).toBe(2);
  });
});
