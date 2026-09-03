path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# ═══════════════════════════════════════════
# 1. CapabilityFlags type definition
# ═══════════════════════════════════════════
edits.append((
    '''  lastSeenAt?: number;
  createdAt: number; updatedAt: number;
}

### 4.2 团队 (Team)''',
    '''  lastSeenAt?: number;
  createdAt: number; updatedAt: number;
}

/** 能力标志位(§4.1 AgentConnection.capabilities / §4.7 HealthProbe.capabilities 复用) */
interface CapabilityFlags {
  sessions: boolean; teams: boolean;
  skills: boolean; plugins: boolean; mcp: boolean; streaming: boolean;
}

### 4.2 团队 (Team)'''
))

# ═══════════════════════════════════════════
# 2. Team <-> Capability assignment model
# ═══════════════════════════════════════════
edits.append((
    '''**归属关系**: `Connection`(一台智能体) → `Team`(成员角色) → `Session`(对话) / `Run`(任务执行); `Capability`(能力) 可按团队或按成员分配。''',
    '''**归属关系**: `Connection`(一台智能体) → `Team`(成员角色) → `Session`(对话) / `Run`(任务执行); `Capability`(能力) 可按团队或按成员分配。

### 4.8 团队能力分配 (TeamCapability) —— 团队 ↔ 能力 多对多

> §5.3 所述「团队可被分配一组共享能力」的数据模型。团队能力分配独立于能力本身(§4.4), 一个能力可被分配给多个团队; 一个团队也可持有多个共享能力。

```ts
interface TeamCapability {
  id: string;                        // uuid
  teamId: string;                    // 归属团队
  capabilityId: string;              // 关联能力(§4.4)
  scope: 'team' | 'member';          // team=团队级(注入上下文), member=已部署到各成员
  memberConnectionIds: string[];     // scope='member' 时已部署的成员 connectionId[]
  addedBy: string;                   // 操作者
  addedAt: number;
}
```

**工作流**:
1. 用户在能力库把能力 X 分配给团队 T → 创建 `TeamCapability(scope='team')`;
2. 团队创建会话时, 驱动把该团队的 `TeamCapability` 列表注入 system context(「Shared Capabilities」段, §5.3);
3. 用户选择「部署到成员」→ 同步引擎把 X 推送到 T 的每个成员 → 更新 `scope='member'` + `memberConnectionIds`;
4. 能力 X 更新时, 已部署的成员可选择性同步更新(触发 `POST /synctasks`)。

> 关系: `Team 1 ── N TeamCapability ── N Capability`。'''
))

# ═══════════════════════════════════════════
# 3. SyncEngine service description in §5.4
# ═══════════════════════════════════════════
edits.append((
    '''> **MCP 共享特殊说明**: MCP 服务器定义可能含密钥(如 `command` + `env`)。设计上**仅同步不含密钥的"骨架配置"**, 密钥由目标侧通过环境变量引用, 避免跨主机泄露敏感。这必须在 UI 中明示。''',
    '''> **MCP 共享特殊说明**: MCP 服务器定义可能含密钥(如 `command` + `env`)。设计上**仅同步不含密钥的"骨架配置"**, 密钥由目标侧通过环境变量引用, 避免跨主机泄露敏感。这必须在 UI 中明示。

**SyncEngine 服务接口**(BFF 内部, §9 `services/SyncEngine`):

```ts
interface SyncEngine {
  /** 从某连接拉取能力列表, 建立本地索引(§5.4 阶段 1) */
  enumerate(connectionId: string): Promise<CapabilityMeta[]>;

  /** 计算本地能力与目标的差异(§5.4 阶段 2) */
  diff(targetConnectionId: string, cap: Capability): Promise<DiffResult>;

  /** 执行一次同步任务(push 一组能力到目标, §5.4 阶段 3+4) */
  executeTask(taskId: string): Promise<void>;
  // 内部: 逐能力调用 adapter.pushCapability → verify → 失败则 rollback

  /** 回滚一次同步(基于 checksum 快照) */
  rollback(taskId: string): Promise<void>;

  /** 当前进行中的任务状态(供前端轮询) */
  taskStatus(taskId: string): { status: string; progress: number; results: SyncResult[] };
}
```

**状态机**: `pending → running → done | failed | cancelled`, 每个目标独立记录 `SyncResult`。'''
))

# ═══════════════════════════════════════════
# 4. Stream interruption recovery in §5.2
# ═══════════════════════════════════════════
edits.append((
    '> BFF 的 `/sessions/:id/stream` 端点: 前端 `EventSource` 连接后, BFF 找到该 sessionId 对应的适配器 + 原生流, 把 `StreamBridge` 输出的统一事件 pipe 到 SSE 响应。前端完全不感知后端协议差异。',
    '> BFF 的 `/sessions/:id/stream` 端点: 前端 `EventSource` 连接后, BFF 找到该 sessionId 对应的适配器 + 原生流, 把 `StreamBridge` 输出的统一事件 pipe 到 SSE 响应。前端完全不感知后端协议差异。\n\n**流中断恢复策略**:\n- 每个统一事件携带递增 `seq`(该 sessionId 下从 0开始的序列号);\n- SSE 支持 `Last-Event-ID` 标准头, 前端 EventSource 重连时自动带上;\n- BFF 维护一个环形缓冲区(默认最近 200 事件 / 会话), 重连时从 `Last-Event_ID+1` 回放;\n- 缓冲区溢出或 BFF 重启导致无法回放 → 前端收到 `{ "type": "meta", "resumed": false, "reason": "buffer_overflow" }`, 前端标记流为「部分丢失」并从当前继续;\n- 对 OpenCode 非交互模式(`run`): 轮询模式天然无中断问题, 不适用回放。'
))

# ═══════════════════════════════════════════
# 5. Server Push notification channel
# ═══════════════════════════════════════════
edits.append((
    '### 5.3 团队编排 (Team)',
    """### 5.2.1 系统通知通道 (Notification Channel)

> 会话消息流(§5.2 SSE)是「会话维度」; 本节描述「系统维度」推送, 用于服务端主动通知前端非会话事件。

前端通过**独立的 SSE 通道**订阅系统事件:

```
GET /api/notifications  (SSE, 全局一个连接)
```

事件类型:

```jsonc
// 连接状态变化
{ "type": "connection.status", "connectionId": "...", "status": "connected"|"error"|"disconnected", "ts": 1770000000000 }

// 同步任务进度
{ "type": "sync.progress", "taskId": "...", "progress": 0.6, "done": 3, "total": 5 }

// 同步任务完成
{ "type": "sync.done", "taskId": "...", "ok": true, "summary": "3/5 目标成功" }

// 审批请求(需人工介入)
{ "type": "approval.required", "sessionId": "...", "action": "...", "from": "member:..." }

// 能力部署结果
{ "type": "capability.deployed", "name": "...", "connectionId": "...", "ok": true }
```

**实现**: BFF 内部维护一个 `NotificationBus`(EventEmitter), 各子系统(ConnectionManager / SyncEngine / 适配器) emit 事件, NotificationBus pipe 到所有活跃的 `/api/notifications` SSE 连接。

**前端**: 顶部全局状态条(§8.1)订阅此通道, 驱动连接灯变色、同步进度条、审批弹窗。

**降级**: 若 SSE 连接断开, EventSource 自动重连(标准行为); 重连期间丢失的事件通过轮询 `/api/notifications?since=<lastTs>` 补回。

### 5.3 团队编排 (Team)"""
))

# ═══════════════════════════════════════════
# 6. GET /sessions/:id endpoint
# ═══════════════════════════════════════════
edits.append((
    '| `GET` | `/sessions` | 会话列表(可按 connection/team 过滤、按 connectionId 分组聚合) |',
    '| `GET` | `/sessions` | 会话列表(可按 connection/team 过滤、按 connectionId 分组聚合) |\n| `GET` | `/sessions/:id` | 获取单个会话详情 |'
))

# ═══════════════════════════════════════════
# 7. Graceful Shutdown
# ═══════════════════════════════════════════
edits.append((
    '### 5.6 同步一致性与竞态 (Consistency)',
    """### 5.6 优雅关闭与恢复 (Graceful Shutdown)

> BFF 重启或关闭时, 需妥善处理活跃连接与进行中任务, 避免流中断、数据丢失。

**关闭流程**(收到 SIGTERM / SIGINT):

1. **停止接受新请求**: Fastify `app.close()`, 拒绝新 HTTP 连接;
2. **通知前端**: 所有活跃 `/sessions/:id/stream` 与 `/api/notifications` 推送 `{ "type": "server.shutdown", "drainMs": 5000 }`;
3. **等待进行中任务**: 给进行中的同步任务 `SyncEngine` 最多 `drainMs`(默认 5s) 完成当前能力推送, 超时则标记 `cancelled` 并记录断点;
4. **断开适配器连接**: 调用每个适配器的 `stopSession` + `ConnectionManager.disconnect(id)`, 释放 WS/SSE;
5. **关闭数据库**: `getDb().close()`;
6. **退出进程**.

**恢复**(重启后):
- `ConnectionManager` 对所有 `status != 'disconnected'` 的连接执行 `reconnect(指数退避)`;
- 前端 EventSource 自动重连, 通过 `Last-Event-ID` 回放(§5.2 流中断恢复);
- 状态为 `running` 的 `SyncTask` 标记为 `failed`(需用户手动重试)。

### 5.7 同步一致性与竞态 (Consistency)"""
))

# Also fix the reference to §5.6 in the old text
edits.append((
    '见 §5.6',
    '见 §5.7'
))

# ═══════════════════════════════════════════
# 8. Audit event catalog in §7
# ═══════════════════════════════════════════
edits.append((
    '| 审计 | 记录所有同步/会话/团队变更到 SQLite audit 表(操作者、目标、capability、时间) |',
    """| 审计 | 记录所有同步/会话/团队变更到 SQLite audit 表(操作者、目标、capability、时间) |

**审计事件目录**(写入 `audit_log` 表):

| 事件 | action | 触发时机 |
|---|---|---|
| 接入智能体 | `connection.create` | `POST /connections` |
| 删除智能体 | `connection.delete` | `DELETE /connections/:id` |
| 编辑智能体 | `connection.update` | `PATCH /connections/:id` |
| 创建会话 | `session.create` | `POST /sessions` |
| 关闭会话 | `session.delete` | `DELETE /sessions/:id` |
| 创建团队 | `team.create` | `POST /teams` |
| 编辑团队 | `team.update` | `PATCH /teams/:id` |
| 删除团队 | `team.delete` | `DELETE /teams/:id` |
| 分配团队能力 | `capability.assign` | 能力库 UI 操作 |
| 部署能力到成员 | `capability.deploy` | 团队能力部署 |
| 发起同步 | `sync.start` | `POST /synctasks` |
| 同步完成 | `sync.done` / `sync.failed` | SyncEngine 完成/失败 |
| 回滚同步 | `sync.rollback` | `POST /synctasks/:id/rollback` |
| 审批通过/拒绝 | `approval.decide` | 用户审批操作 |
| 桥调用 | `bridge.call` | 模式 B 互连桥调用 |

**查询**: `GET /api/audit?action=&targetType=&from=&to=` (预留, M6 实现)。"""
))

# ═══════════════════════════════════════════
# Apply all edits
# ═══════════════════════════════════════════

applied = 0
misses = []
for old, new in edits:
    if old in content:
        content = content.replace(old, new, 1)
        applied += 1
    else:
        misses.append(old[:60])

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Applied {applied}/{len(edits)} edits")
if misses:
    print("\nMISSES:")
    for m in misses:
        print(f"  - {m}")
