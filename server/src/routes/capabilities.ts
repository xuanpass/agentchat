import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import { ConnectionRepo } from '../db/connections.js';
import { ConnectionManager } from '../services/ConnectionManager.js';
import { getDriver } from '../adapters/index.js';

export async function capabilityRoutes(app: FastifyInstance) {
  // 本地能力仓库
  app.get('/capabilities', async () => {
    const rows = getDb().prepare('SELECT * FROM capabilities ORDER BY created_at DESC').all() as any[];
    return rows.map(parseCapabilityRow);
  });
  app.get<{ Params: { id: string } }>('/capabilities/:id', async (req) => {
    const r = getDb().prepare('SELECT * FROM capabilities WHERE id = ?').get(req.params.id) as any;
    return r ? parseCapabilityRow(r) : { error: '不存在', status: 404 };
  });

  // 从某连接拉取能力到本地仓库 (pull)
  app.post('/capabilities/import', async (req, reply) => {
    const { connectionId, name } = (req.body ?? {}) as any;
    if (!connectionId || !name) return reply.code(400).send({ error: 'connectionId/name 必填' });
    const conn = ConnectionRepo.get(connectionId);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    await ConnectionManager.ensureConnected(connectionId);
    const driver = getDriver(conn.kind);
    const cap = await driver.pullCapability(conn, name);
    // 落库(若已存在则更新)
    getDb().prepare(`
      INSERT INTO capabilities (id, type, name, version, source_kind, payload, checksum, size_bytes, installed_on, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum, size_bytes=excluded.size_bytes, payload=excluded.payload
    `).run(cap.id, cap.type, cap.name, cap.version ?? null, cap.sourceKind, JSON.stringify(cap.payload),
      cap.checksum, cap.sizeBytes, JSON.stringify(cap.installedOn), Date.now());
    return reply.code(201).send(cap);
  });

  // 同步任务 (push 一组能力到目标连接)
  app.post('/synctasks', async (req, reply) => {
    const { targetConnectionId, capabilityNames } = (req.body ?? {}) as any;
    if (!targetConnectionId || !Array.isArray(capabilityNames)) return reply.code(400).send({ error: '参数错误' });
    const conn = ConnectionRepo.get(targetConnectionId);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    const id = uuid();
    getDb().prepare(`INSERT INTO sync_tasks (id, target_connection_id, capability_names, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run(id, targetConnectionId, JSON.stringify(capabilityNames), 'pending', Date.now(), Date.now());

    // 异步执行同步 (不阻塞响应)
    executeSyncTask(id).catch((err) => {
      getDb().prepare('UPDATE sync_tasks SET status = ?, diff_result = ?, updated_at = ? WHERE id = ?')
        .run('failed', JSON.stringify({ error: err.message }), Date.now(), id);
    });

    return reply.code(202).send({ id, status: 'pending' });
  });

  // 同步任务列表 (支持 status 过滤, 如 ?status=running)
  app.get('/synctasks', async (req) => {
    const { status } = req.query as any;
    if (status) return getDb().prepare('SELECT * FROM sync_tasks WHERE status = ? ORDER BY updated_at DESC').all(status);
    return getDb().prepare('SELECT * FROM sync_tasks ORDER BY updated_at DESC').all();
  });

  app.get<{ Params: { id: string } }>('/synctasks/:id', async (req) => {
    return getDb().prepare('SELECT * FROM sync_tasks WHERE id = ?').get(req.params.id) ?? { error: '不存在', status: 404 };
  });

  // 取消同步任务
  app.patch<{ Params: { id: string } }>('/synctasks/:id/cancel', async (req) => {
    const t = getDb().prepare('SELECT * FROM sync_tasks WHERE id = ?').get(req.params.id) as any;
    if (!t) return { error: '不存在', status: 404 };
    if (t.status === 'done' || t.status === 'failed') return { error: '已结束的任务无法取消', status: 400 };
    getDb().prepare('UPDATE sync_tasks SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', Date.now(), req.params.id);
    return getDb().prepare('SELECT * FROM sync_tasks WHERE id = ?').get(req.params.id);
  });

  // 列出远程连接的能力 (浏览远程实例的工具列表)
  app.get('/capabilities/remote', async (req, reply) => {
    const { connectionId } = req.query as any;
    if (!connectionId) return reply.code(400).send({ error: 'connectionId 必填' });
    const conn = ConnectionRepo.get(connectionId);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    await ConnectionManager.ensureConnected(connectionId);
    const driver = getDriver(conn.kind);
    const metas = await driver.listCapabilities(conn);
    return metas;
  });

  // 列出某连接的能力 diff (本地 vs 远程)
  app.post('/capabilities/diff', async (req, reply) => {
    const { connectionId, name } = (req.body ?? {}) as any;
    if (!connectionId || !name) return reply.code(400).send({ error: 'connectionId/name 必填' });
    const conn = ConnectionRepo.get(connectionId);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    const local = getDb().prepare('SELECT * FROM capabilities WHERE name = ?').get(name) as any;
    if (!local) return reply.code(404).send({ error: '本地能力不存在' });
    await ConnectionManager.ensureConnected(connectionId);
    const driver = getDriver(conn.kind);
    const cap = {
      id: local.id, type: local.type, name: local.name, version: local.version,
      sourceKind: local.source_kind, payload: JSON.parse(local.payload),
      checksum: local.checksum, sizeBytes: local.size_bytes,
      installedOn: JSON.parse(local.installed_on), createdAt: local.created_at,
    } as any;
    const diff = await driver.diffCapability(conn, cap);
    return diff;
  });
}

async function executeSyncTask(taskId: string): Promise<void> {
  const task = getDb().prepare('SELECT * FROM sync_tasks WHERE id = ?').get(taskId) as any;
  if (!task) return;

  getDb().prepare('UPDATE sync_tasks SET status = ?, updated_at = ? WHERE id = ?').run('running', Date.now(), taskId);

  const conn = ConnectionRepo.get(task.target_connection_id);
  if (!conn) {
    getDb().prepare('UPDATE sync_tasks SET status = ?, diff_result = ?, updated_at = ? WHERE id = ?')
      .run('failed', JSON.stringify({ error: '连接不存在' }), Date.now(), taskId);
    return;
  }

  await ConnectionManager.ensureConnected(conn.id);
  const driver = getDriver(conn.kind);
  const capNames: string[] = JSON.parse(task.capability_names);
  const results: any[] = [];

  for (const name of capNames) {
    try {
      const local = getDb().prepare('SELECT * FROM capabilities WHERE name = ?').get(name) as any;
      if (!local) { results.push({ name, ok: false, error: '本地不存在' }); continue; }
      const cap = {
        id: local.id, type: local.type, name: local.name, version: local.version,
        sourceKind: local.source_kind, payload: JSON.parse(local.payload),
        checksum: local.checksum, sizeBytes: local.size_bytes,
        installedOn: JSON.parse(local.installed_on), createdAt: local.created_at,
      };
      const result = await driver.pushCapability(conn, cap);
      results.push({ name, ok: result.ok, action: result.action, newChecksum: result.newChecksum });

      // 更新 installed_on
      if (result.ok) {
        const installedOn = JSON.parse(local.installed_on);
        if (!installedOn.includes(conn.id)) {
          installedOn.push(conn.id);
          getDb().prepare('UPDATE capabilities SET installed_on = ? WHERE name = ?').run(JSON.stringify(installedOn), name);
        }
      }
    } catch (err: any) {
      results.push({ name, ok: false, error: err.message });
    }
  }

  const allOk = results.every((r) => r.ok);
  getDb().prepare('UPDATE sync_tasks SET status = ?, diff_result = ?, updated_at = ? WHERE id = ?')
    .run(allOk ? 'done' : 'failed', JSON.stringify(results), Date.now(), taskId);
}

function parseCapabilityRow(r: any) {
  return {
    id: r.id, type: r.type, name: r.name, version: r.version ?? null,
    sourceKind: r.source_kind,
    payload: r.payload ? JSON.parse(r.payload) : { kind: 'file', content: '' },
    checksum: r.checksum, sizeBytes: r.size_bytes,
    installedOn: r.installed_on ? JSON.parse(r.installed_on) : [],
    lastSyncedAt: r.last_synced_at ? JSON.parse(r.last_synced_at) : undefined,
    createdAt: r.created_at,
  };
}

// 成员发现目录 (§5.5.2)
export async function memberRoutes(app: FastifyInstance) {
  app.get('/members', async () => {
    // 聚合各连接 agent/profile 为统一目录
    const connections = ConnectionRepo.list();
    const members: any[] = [];
    for (const c of connections) {
      // TODO M3: 调用各适配器 listMembers() 拿真实成员
      members.push({
        id: `${c.id}-default`, connectionId: c.id, name: c.name, kind: c.kind,
        status: c.status === 'connected' ? 'online' : 'offline',
        interop: ['bff-bus'], callableEndpoint: c.endpoint.baseUrl,
        capabilities: [],
      });
    }
    return members;
  });
}
