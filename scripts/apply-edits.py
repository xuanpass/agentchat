import re

path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# ═══════════════════════════════════════════
# 🔴 CRITICAL FIXES
# ═══════════════════════════════════════════

# ── Fix 1: Add createdAt/updatedAt to AgentConnection ──
edits.append((
    '  lastSeenAt?: number;\n}',
    '  lastSeenAt?: number;\n  createdAt: number; updatedAt: number;\n}'
))

# ── Fix 2: Add §4.7 Supporting Types after Project section ──
project_end = """> 关系: `Connection 1 ── N Project`、`Project 1 ── N Session`。

---

## 5. 关键子系统设计"""

project_new = """> 关系: `Connection 1 ── N Project`、`Project 1 ── N Session`。

### 4.7 驱动契约支撑类型 (Supporting Types)

> §5.1 适配层接口引用的类型在此统一定义, 避免适配器实现时各自解释。

```ts
/** createSession 的选项(§5.1 AgentConnectionDriver.createSession) */
interface SessionCreateOpts {
  title?: string;
  projectId?: string;             // 绑定项目 -> 驱动注入 rootPath 为工作目录(§4.6)
  teamId?: string;                // 可选, 归属团队
  initialMessage?: string;        // 创建后首条消息(可选, 不发则会话 idle)
  model?: string;                 // 指定模型(可选)
  agent?: string;                 // opencode agent / hermes profile
  meta?: Record<string, any>;     // 各协议特有
}

/** sendMessage 返回的流句柄(§5.1 AgentConnectionDriver.sendMessage) */
interface StreamHandle {
  sessionId: string;
  protocol: 'sse' | 'ws';
  close(): void;                  // 关闭流(不影响会话本身)
  closed: boolean;
}

/** test/health 探测结果(§5.1 AgentConnectionDriver.test / ConnectionManager.health) */
interface HealthProbe {
  ok: boolean;
  latencyMs: number;
  capabilities: CapabilityFlags;  // 与 AgentConnection.capabilities 同形
  error?: string;
  remoteInfo?: { version?: string; model?: string; kind?: string };
}

/** pushCapability 返回(§5.1 AgentConnectionDriver.pushCapability) */
interface SyncResult {
  ok: boolean;
  name: string;
  action: 'added' | 'updated' | 'unchanged';
  error?: string;
  checksum?: string;
}

/** listCapabilities 返回的元数据(不含 payload, 轻量编目) */
interface CapabilityMeta {
  name: string;
  type: 'skill' | 'plugin' | 'mcp';
  version?: string;
  checksum: string;
  sizeBytes: number;
  description?: string;
}

/** diffCapability 返回(§5.1 AgentConnectionDriver.diffCapability) */
interface DiffResult {
  name: string;
  status: 'added' | 'changed' | 'removed' | 'unchanged';
  sourceChecksum?: string;
  targetChecksum?: string;
}
```

---

## 5. 关键子系统设计"""

edits.append((project_end, project_new))

# ── Fix 3: better-sqlite3 -> node:sqlite in §3.1 ──
edits.append((
    '| **存储** | 连接配置、团队、会话索引、同步记录 | SQLite (better-sqlite3) |',
    '| **存储** | 连接配置、团队、会话索引、同步记录 | SQLite (Node 内置 `node:sqlite`, 实验性) |'
))

# ── Fix 4: Add POST /sessions/:id/message + PATCH /sessions/:id ──
edits.append((
    '| `DELETE` | `/sessions/:id` | 关闭会话 |',
    '| `POST` | `/sessions/:id/message` | 向会话发消息( body: { text: string } ) |\n| `PATCH` | `/sessions/:id` | 更新会话(如 rename title) |\n| `GET` | `/sessions/:id/history` | 获取会话历史消息 |\n| `DELETE` | `/sessions/:id` | 关闭会话 |'
))

# ── Fix 5: Fix streaming convention text ──
edits.append((
    '**流式约定**: `/sessions/:id/stream` 为 Server-Sent Events(事件 schema 见 §5.2)。写消息走 POST, 读走 SSE, 解耦请求与持续事件。',
    '**流式约定**: `/sessions/:id/stream` 为 Server-Sent Events(事件 schema 见 §5.2)。消息发送走 `POST /sessions/:id/message`, 读走 SSE, 解耦请求与持续事件。当适配器原生为 WebSocket(如 OpenClaw/OpenCode WS)时, BFF 内部将 `POST /sessions/:id/message` 桥接为 WS 发送, 将 WS 下行事件转 SSE 推向前端, 前端只感知 SSE。'
))

# ═══════════════════════════════════════════
# 🟡 MEDIUM FIXES
# ═══════════════════════════════════════════

# ── Fix 6: Add unified error response format ──
error_block = """/**流式约定**: `/sessions/:id/stream`"""

error_new = """/**统一错误响应**: 所有 API 错误返回统一 schema, 前端据此做 toast / retry / 错误边界:

```jsonc
// HTTP 4xx/5xx 响应体
{
  "error": {
    "code": "CONN_TIMEOUT",       // 机器可读枚举(见下表)
    "message": "连接超时",         // 人类可读
    "details": { "url": "...", "ms": 5000 },  // 可选上下文
    "traceId": "t-..."              // 关联 BFF 请求日志
  }
}
```

| 错误码 | 含义 |
|---|---|
| `CONN_TIMEOUT` | 连接远程智能体超时 |
| `CONN_REFUSED` | 远程智能体拒绝连接 |
| `AUTH_FAILED` | 远程智能体认证失败 |
| `UNSUPPORTED` | 该 kind 不支持此操作(如 OpenCode 推 skill) |
| `NOT_FOUND` | 连接/会话/能力不存在 |
| `SYNC_CONFLICT` | 同步冲突(CAS 校验失败) |
| `RATE_LIMITED` | BFF 限流 |
| `INTERNAL` | BFF 内部错误 |

**流式约定**: `/sessions/:id/stream`"""

edits.append((error_block, error_new))

# ── Fix 7: Bridge layer details in §5.2 ──
bridge_old = """```jsonc
// 前端事件流统一格式 (SSE over HTTP, 或 WS)
{ "type": "meta",     "sessionId": "...", "model": "...", "title": "..." }
{ "type": "text.delta", "content": "部分" }
{ "type": "tool.start", "tool": "terminal", "args": {...} }
{ "type": "tool.result", "tool": "terminal", "ok": true, "summary": "..." }
{ "type": "approval.request", "action": "...", "permissions": [...] }
{ "type": "done", "reason": "stop", "usage": {...} }
{ "type": "error", "code": "...", "message": "..." }
```"""

bridge_new = """```jsonc
// 前端事件流统一格式 (SSE over HTTP)
{ "type": "meta",     "sessionId": "...", "model": "...", "title": "..." }
{ "type": "text.delta", "content": "部分" }
{ "type": "tool.start", "tool": "terminal", "args": {...} }
{ "type": "tool.result", "tool": "terminal", "ok": true, "summary": "..." }
{ "type": "approval.request", "action": "...", "permissions": [...] }
{ "type": "done", "reason": "stop", "usage": {...} }
{ "type": "error", "code": "...", "message": "..." }
```

**桥接层(Bridge)如何处理异构流 -> 统一 SSE 事件**:

每个适配器内部实现 `StreamBridge`, 负责把原生协议事件转成上述统一格式:

| 智能体 | 原生流 | 桥接策略 |
|---|---|---|
| **OpenClaw** | Gateway WS RPC 事件订阅(`agent.*` / `sessions.*`) | 适配器持有持久 WS, 订阅事件流; 收到 RPC 回调后按 `method` 分类: `agent.text.delta` -> `text.delta`, `agent.tool.*` -> `tool.start/tool.result`, `agent.approval` -> `approval.request`, `agent.done` -> `done` |
| **Hermes** | `/v1/responses` SSE(`content_delta` / `message_end` 等) | 适配器 `fetch` SSE 流, 逐事件解析: `content_delta` -> `text.delta`, `message_end` -> `done`; 错误 event -> `error` |
| **OpenCode** | `opencode web` WS 双向流 | 适配器连 WS, 订阅 `output` / `result` 事件; `output` -> `text.delta`, `result` -> `done`; 非交互模式(`run`)则轮询结果, 按进度 emit -> 最终 `done` |

> BFF 的 `/sessions/:id/stream` 端点: 前端 `EventSource` 连接后, BFF 找到该 sessionId 对应的适配器 + 原生流, 把 `StreamBridge` 输出的统一事件 pipe 到 SSE 响应。前端完全不感知后端协议差异。"""

edits.append((bridge_old, bridge_new))

# ── Fix 8: Config reference table ──
config_old = """| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/connections` |"""

config_new = """### 6.1 配置参考 (Environment Variables)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AOC_PORT` | `3001` | BFF 监听端口 |
| `AOC_HOST` | `127.0.0.1` | BFF 监听地址 |
| `AOC_CORS_ORIGIN` | `*`(开发) | 允许的前端 origin(生产环境应限制) |
| `AOC_SECRET_KEY` | (必填) | AES-GCM 凭据加密密钥(32 字节 hex) |
| `AOC_IDLE_DISCONNECT_MS` | `300000`(5min) | 空闲连接自动断连阈值(0=禁用) |
| `AOC_MAX_RETRY` | `5` | 断线重连最大次数 |
| `AOC_LOG_LEVEL` | `info` | 日志级别 |

### 6.2 REST API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/connections` |"""

edits.append((config_old, config_new))

# ── Fix 9: Update directory structure ──
edits.append((
    '├── sync-engine/        # enum/diff/transfer/verify/rollback\n│   ├── bridge/             # 异构流 -> 统一 SSE 事件\n│   ├── crypto.ts           # 凭据加密\n│   └── db/                 # SQLite schema + migration',
    '├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + StreamBridge\n│   ├── services/           # ConnectionManager / SyncEngine\n│   ├── bridge/             # 异构流 -> 统一 SSE 事件 (StreamBridge 基类 + 各适配器实现)\n│   ├── crypto.ts           # 凭据加密\n│   └── db/                 # SQLite schema + migration'
))

# ── Fix 10: Update web directory in §9 ──
edits.append((
    '│   ├── pages/              # Connections/Teams/Sessions/Capabilities\n│   ├── components/         # UnifiedStream/ToolCallCard/ConnWizard/SyncConsole...',
    '│   ├── pages/              # Connections/Teams/Sessions/Capabilities/Projects\n│   ├── components/         # UnifiedStream/ToolCallCard/ConnWizard/SyncConsole...'
))

# ── Fix 11: Add E2E flow diagrams ──
e2e_old = """## 5. 关键子系统设计"""

e2e_new = """## 5.0 端到端数据流 (E2E Flow)

> 两条核心链路的完整路径, 帮助实现时对齐各层职责。

### 5.0.1 用户发消息 -> 流式响应

```
用户输入 -> 前端 POST /sessions/:id/message
  -> BFF route 查找 sessionId -> 对应适配器
    -> 适配器把文本发至远程智能体:
        OpenClaw: WS RPC agent.send / agent.wait
        Hermes:   POST /v1/responses (SSE) -> 流式
        OpenCode: WS send / opencode run
    -> 远程智能体返回原生流
      -> 适配器 StreamBridge 转统一事件
        -> BFF pipe 到 SSE 响应
          -> 前端 EventSource 监听 -> UnifiedStream 渲染器按 type 分发
```

### 5.0.2 用户推能力 X -> 目标实例

```
用户在能力库选 X -> 选目标实例 Y -> POST /synctasks
  -> BFF SyncEngine:
    1. enum: 从 X 读取 payload, 从 Y.listCapabilities() 读取目标现有能力
    2. diff: 比 checksum -> added/changed/removed/unchanged
    3. 前端展示 diff 预览, 用户确认
    4. transfer: Y.pushCapability(cap) -> 写入远程端(文件/配置)
    5. verify: Y.listCapabilities() 复核
    -> 成功: 更新 Capability.installedOn / lastSyncedAt
    -> 失败: 基于 checksum 快照回滚
  -> 前端展示每个目标独立结果
```

---

## 5. 关键子系统设计"""

edits.append((e2e_old, e2e_new))

# ── Fix 12: Team context injection template in §5.3 ──
team_ctx_old = '**团队上下文注入**: 每个成员在创建会话时, 在 system prompt / instructions 中注入: 团队目标、成员角色、**成员发现目录(含可互连队友的调用方式)**、共享能力清单、约定格式。这与"能力共享"联动 —— 团队可被分配一组共享技能/MCP。'

team_ctx_new = """**团队上下文注入**: 每个成员在创建会话时, 在 system prompt / instructions 中注入: 团队目标、成员角色、**成员发现目录(含可互连队友的调用方式)**、共享能力清单、约定格式。这与"能力共享"联动 —— 团队可被分配一组共享技能/MCP。

注入模板(各适配器按自身 prompt 格式适配):

```
## Team Context
Team: {team_name}
Your Role: {role}
Goal: {team_goal}

## Teammates
{_each_member: name + role + kind + callable_via}

## Shared Capabilities
{list_of_shared_capability_names}

## Output Format
Reply with: {target} | {status} | {blockers}
```

> 长度控制: 团队上下文注入不超过 2000 token; 超长时截断成员发现目录(仅保留同团队队友), 优先保 team goal + role。"""

edits.append((team_ctx_old, team_ctx_new))

# ── Fix 13: Add conflict resolution in §5.6 ──
edits.append((
    '5. **超时/悬挂**:',
    '5. **冲突解决**: 两用户同时推不同版本同一能力到同一目标 -> `Capability.checksum`(乐观锁)校验, 后者 CAS 失败收到 `SYNC_CONFLICT` 错误, UI 提示"目标侧已有新版本, 请刷新后重试"; 两用户同时编辑同一团队 -> `AgentTeam.version`(乐观锁)防并发覆盖, 后者收到冲突提示。\n6. **超时/悬挂**:'
))

edits.append((
    '6. **回滚范围**:',
    '7. **回滚范围**:'
))

# ── Fix 14: Frontend states guidance ──
states_old = '- **项目页**: 项目列表(按归属实例分组), 新建/编辑项目(填实例 + 远程 rootPath), 展示该项目下已开的会话。'

states_new = """- **项目页**: 项目列表(按归属实例分组), 新建/编辑项目(填实例 + 远程 rootPath), 展示该项目下已开的会话。

**前端状态指引**(全局):
- **Loading**: 所有异步操作(连接测试/会话创建/同步)显示 skeleton 或 spinner; 流式文本区域显示"正在思考..."打字指示器。
- **Error**: BFF 返回 `error.code` 时, 右上角 toast 显示 `message` + 重试按钮(若有); 整页错误用 Error Boundary 兜底(提示 + 刷新)。
- **Empty**: 列表为空时显示插图 + 引导文案(如"还没有接入任何智能体, 点击 + 开始")。
- **离线**: 连接状态灯变红 + 顶部横幅提示"与 {name} 断开", 自动重连后消失。"""

edits.append((states_old, states_new))

# ── Fix 15: Update global status bar ──
edits.append((
    '└── 顶部全局状态条(连接健康、进行中同步任务)',
    '└── 顶部全局状态条(连接健康轮询 /api/health + 进行中同步任务 + 断开提示)'
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
