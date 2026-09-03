# Agent Ops Console — 架构设计文档

> 一个用于接入远程智能体(OpenClaw / Hermes / OpenCode)、组建 Agent 团队、管理会话、并共享技能/插件/MCP 工具的 Web 前端应用。
> 本文档为**架构设计先行稿**, 评审通过后再进入编码。
> **评审状态**: ✅ 8 项决策已于 2026-08-05 拍板, 详见附录 A 与 `DECISION-SHEET.md`。

---

## 0. 文档状态与目标

| 项目 | 内容 |
|------|------|
| 文档版本 | v0.1 (设计评审稿) |
| 设计日期 | 2026-08-04 |
| 交付阶段 | 架构设计文档先行 (编码在评审后) |
| 核心能力 | ① 接入远程智能体 ② 组队 ③ 会话管理/创建 ④ 技能/插件/MCP 工具同步共享 |
| 共享深度 | **完整同步能力**(支持推送与拉取, 而不仅是只读浏览) |

---

## 1. 现状调研: 三个智能体的接入方式

> 依据公开文档调研结论。**这是确定适配层(Adapter)设计的事实基础。**

### 1.1 OpenClaw / EasyClaw

| 接入途径 | 说明 | 备注 |
|---|---|---|
| **Gateway Protocol** (WebSocket + RPC) | 官方推荐路径; `gateway.gateway.call` 等 RPC 方法 | 面向外部应用/脚本/Dashboard; 支持事件订阅、审批、流式 |
| **Gateway RPC Reference** | agents / sessions / tasks / models / tools / artifacts / approvals | 核心能力域, 最贴合本应用"会话管理 + 工具共享" |
| **HTTP `/tools/invoke`** | 单工具直接调用; Bearer token 认证 | 与 WS/HTTP 同端口多路复用 |
| **OpenAI 兼容 `/v1/*`** | 标准 ChatCompletions / Responses | token/password auth |
| **CLI** | `openclaw agent` `openclaw message` `openclaw gateway call` | 一次性脚本/子进程集成 |
| **Admin HTTP RPC 插件** | 控制平面 HTTP 路由 | 用于托管控制器 |
| **Auth** | 共享密钥 token / password, trusted-proxy | `gateway.auth.mode` |

**结论**: OpenClaw 是最适合作为"主控中枢"的系统 —— 具有完整的会话(RPC)、工具(HTTP invoke)、模型、审批、事件订阅能力, 且自带与远程智能体一致的 RPC 语义。

### 1.2 Hermes (Nous Research)

| 接入途径 | 说明 | 备注 |
|---|---|---|
| **serve 后端 (REST + WebSocket)** | `hermes serve --host 0.0.0.0 --port 9119`; REST `/api/status` + WS `/api/ws` `/api/events` | 桌面/Web UI 连接的后端 |
| **OpenAI 兼容 API Server** | `/v1/chat/completions` `/v1/responses` (SSE 流式), 端口 8642 | 任何 OpenAI 格式前端可接入 |
| **Web Dashboard** | 浏览器管理面板, 含 Skills / MCP / Models / Chat 页 | 自带技能/MCP管理页(可参考数据模型) |
| **Inbound Webhooks** | 端口 8644, 将 HTTP POST 转为 agent run | 触发型接入 |
| **Auth** | session token, basic auth, OAuth | `--insecure` + token 用于远程客户端 |
| **能力与管理** | `~/.hermes/config.yaml` (mcp_servers), `plugins/` 目录, skills; per-profile | 技能/插件/MCP 均为**文件/目录**形式 |

**关键点**: Hermes 的 Skills / Plugins / MCP 都是 `~/.hermes/` 下的**文件系统对象**(config.yaml 的 `mcp_servers:` 段、`plugins/hello-world/` 目录、skills 目录)。这意味着"共享能力"到 Hermes 侧实质是**文件/配置同步**。

### 1.3 OpenCode (SST → Anthropic)

| 接入途径 | 说明 | 备注 |
|---|---|---|
| **TUI** | 默认终端界面 | 需 PTY, 不适合浏览器直接嵌入 |
| **CLI 命令** | `opencode run "..."`(程序化/headless), `opencode agent create/list` | 非交互式自动化入口 |
| **serve / web 后端** | `opencode web --port 4096 --hostname 0.0.0.0` 起后端服务器 | 供 Web/移动端访问; `opencode attach <url>` 挂接 |
| **Attach** | 用 TUI 连接远程已运行后端, basic auth | WebSocket |
| **Auth** | `OPENCODE_SERVER_PASSWORD` / username | basic |
| **Agent 配置** | 基于 Markdown 的 agent 文件 + `/permissions` 权限矩阵 | 权限: bash, read, edit, glob, grep, webfetch, task, todowrite, websearch, lsp, skill |

**关键点**: OpenCode 最强的是**代码执行型 agent**(run/attach/web server)。它的"技能"式能力少, 但支持权限矩阵与多 agent; 会话为 session id 形式(continue/session/fork)。

---

## 2. 设计目标与边界

### 2.1 目标

1. **统一控制面**: 用一套 UI 管理三种异构远程智能体, 隐藏各自协议差异。
2. **Team 编排**: 把不同智能体组成"团队", 支持团队级会话/任务。
3. **会话生命周期**: 创建、列出、重入(resume)、关闭远程智能体会话。
4. **能力共享**: 将本地/其他智能体的**技能、插件、MCP 工具**推送到目标远程智能体, 并可拉取远程已有能力进行浏览/编排。
5. **智能体间互连(可选增强)**: 在团队任务中, 成员之间可经由 BFF 总线或原生桥直接协作(见 §5.5)。

### 2.2 明确边界(非本应用职责)

| 非职责 | 说明 |
|---|---|
| 智能体内部执行引擎 | 我们不重写 agent 推理, 只做编排与控制面 |
| LLM Provider 计费/密钥管理 | 密钥由各智能体侧管理(仅代理连接) |
| 消息渠道(Telegram/Discord 等) | 那属于各智能体自身的 gateway, 我们复用其结果 |
| 大规模集群调度/高可用 | 设计上可扩展, 但首版单机部署 |

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent Ops Console (Web Frontend)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ Agent中心 │ │ Team编排  │ │ 会话管理  │ │ 能力共享(MCP/技能)│  │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────┘  │
└───────────────┬───────────────────────────────────────────────┘
                │ (axios + native WebSocket + SSE)
┌───────────────▼───────────────────────────────────────────────┐
│   API Gateway / BFF (Node.js + Fastify/Express)               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  适配层 Adapter Layer                                     │ │
│  │  ┌──────────────┬──────────────┬──────────────┐         │ │
│  │  │ OpenClaw适配器│ Hermes适配器  │ OpenCode适配器│         │ │
│  │  └──────────────┴──────────────┴──────────────┘         │ │
│  │        统一 AgentConnection 接口契约                        │ │
│  └──────────────┬──────────────────────────────────────────┘ │
│         能力同步引擎 Skill/Plugin/MCP Sync Engine              │
│          对拍/哈希/推送/拉取/差异/回滚                           │
│           元数据 + 连接配置 + 团队 + 会话索引 (SQLite)           │
└───────┬───────────┬───────────────┬───────────────────────────┘
        │           │               │
   ┌────▼────┐ ┌────▼────┐   ┌─────▼─────┐
   │ OpenClaw │ │  Hermes  │   │  OpenCode │
   │ Gateway  │ │ serve+   │   │ web server│
   │ (WS/RPC) │ │ API(8642)│   │ (4096/attach)
   └──────────┘ └─────────┘   └───────────┘
          (远程主机, 经 内网/Tailscale/公网 TLS)
```

### 3.1 分层说明

| 层 | 职责 | 关键技术 |
|---|---|---|
| **前端** | 六个功能页(智能体/团队/会话/能力库/项目/技能市场) + 全局状态 | Vue 3 + TypeScript + Pinia + WebSocket |
| **BFF / API Gateway** | 统一 REST + 流式桥接, 避免浏览器直连异构协议(CORS/认证差异) | Node.js (Fastify) |
| **适配层** | 把三套异构协议归一为 `AgentConnection` 契约 | 接口 + 三个实现 |
| **能力同步引擎** | 技能/插件/MCP 的双向同步 | 哈希比对 + 传输 + 回滚 |
| **存储** | 连接配置、团队、会话索引、同步记录 | SQLite (Node 内置 `node:sqlite`, 实验性) |

> **为什么需要 BFF**: 三种智能体协议、端口、认证、CORS 差异巨大(OpenClaw 是 gateway token; Hermes 是 session/basic; OpenCode 是 basic + OpenCode-only WS)。浏览器直连既不安全也不可行。BFF 承担: 凭据管理、协议适配、SSE/WS 转前端流、统一鉴权。

---

## 4. 核心数据模型

### 4.1 连接 (Connection) — 接入的智能体

```ts
interface AgentConnection {
  id: string;                     // uuid
  name: string;                   // "研发三人组 - hermes worker"
  kind: 'openclaw' | 'hermes' | 'opencode';
  endpoint: {
    baseUrl: string;              // ws(s)://host:port 或 http(s)://host:port
    openaiPath?: string;          // 可选, hermes/opencode 的 /v1 地址
  };
  auth: {
    type: 'token' | 'basic' | 'password' | 'none';
    // 敏感字段: 端到端加密后落库(见 §7 安全)
  };
  profile?: string;               // hermes per-profile 支持
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  capabilities: {                 // 探测到的能力位
    sessions: boolean; teams: boolean;
    skills: boolean; plugins: boolean; mcp: boolean;
    streaming: boolean;
  };
  lastSeenAt?: number;
  createdAt: number; updatedAt: number;
}
```

/** 能力标志位(§4.1 AgentConnection.capabilities / §4.7 HealthProbe.capabilities 复用) */
interface CapabilityFlags {
  sessions: boolean; teams: boolean;
  skills: boolean; plugins: boolean; mcp: boolean; streaming: boolean;
}

### 4.2 团队 (Team)

```ts
interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];          // 引用 connectionId + 角色
  version: number;                // 乐观锁, 支持并发编辑
  createdAt: number; updatedAt: number;
}
interface TeamMember {
  connectionId: string;
  role: 'lead' | 'worker' | 'reviewer' | 'observer';
  status: 'online' | 'busy' | 'offline' | 'error';
  interop: (InteropMechanism)[];   // 该成员参与的互连机制(§5.5)
  // 团队级上下文注入, 见 §5.3; 成员互连见 §5.5
}
```

### 4.3 会话 (Session)

```ts
interface AgentSession {
  id: string;
  connectionId: string;           // 归属哪个实例(Connection) — 多对一: 一个实例 0..N 个会话
  teamId?: string;                // 可选, 属于哪个团队
  projectId?: string;             // 可选, 关联的工作目录项目(§4.6)
  remoteSessionId: string;        // 远程智能体侧的会话标识(sessionId/session uuid)
  title: string;
  createdAt: number; lastActiveAt: number;
  status: 'idle' | 'running' | 'streaming' | 'done' | 'error';
  meta: Record<string, any>;      // 各协议特有(如 opencode fork/agent、hermes profile)
}

> **多会话确认**: 一个 `Connection`(远程智能体实例) 可同时持有 **0..N 个 `AgentSession`**(对话/任务)。
> 会话列表按 `connectionId` 聚合(一个实例下多条会话); 团队会话再按 `teamId` 归属。
> 关系: `Connection 1 ── N Session`、`Team 1 ── N Session`(可选)。
```

### 4.4 能力包 (Capability) — 技能/插件/MCP

```ts
// 统一描述一个可共享的能力单元
interface Capability {
  id: string;                       // 本地索引 id
  type: 'skill' | 'plugin' | 'mcp';
  name: string;                     // 唯一名(如 "browser-tool", "hello-world", "project_fs")
  version?: string;
  sourceKind: 'openclaw'|'hermes'|'opencode'|'local';
  payload: CapabilityPayload;        // 见下
  checksum: string;                 // 内容指纹, 用于差异同步
  sizeBytes: number;
  installedOn: string[];            // connectionId[] 已部署目标
  lastSyncedAt?: Record<string, number>;
}

type CapabilityPayload =
  | { kind: 'file';     path: string; encoding: 'utf8'|'base64'; content: string }   // 单文件(skill)
  | { kind: 'dir';      tree: { path: string; encoding: 'utf8'|'base64'; content: string }[] } // 目录(plugin)
  | { kind: 'config';   config: Record<string, any> }                                  // mcp_servers 配置块
```

### 4.5 运行/任务 (Run / Task) —— 团队编排的执行单元

> 会话(Session)是"与某智能体的持久对话"; **任务(Run)** 是"团队里一次被派发/执行的工作单元"。两者解耦, 使一个团队会话可承载多次任务、并支持审计与重放。

```ts
interface AgentRun {
  id: string;                    // uuid
  teamId?: string;               // 可选, 归属团队
  sessionIds: string[];          // 参与本次任务的成员会话(可多个)
  traceId: string;               // 关联 TeamMessage 调用链(§5.5.3)
  status: 'queued' | 'dispatch' | 'running' | 'awaiting' | 'done' | 'failed' | 'cancelled';
  strategy: 'serial' | 'fanout' | 'review';   // 编排模式(§5.3)
  context?: { goal: string; instructions?: string; injectedTeamContext?: string };
  events: RunEvent[];            // 派发/回传/审批/完成 日志(审计)
  createdAt: number; updatedAt: number;
}
type RunEvent =
  | { kind: 'dispatch';   to: string; text: string; ts: number }
  | { kind: 'respond';    from: string; text: string; ts: number }
  | { kind: 'approval';   action: string; by: 'human'|'agent'; decision: 'approve'|'reject'; ts: number }
  | { kind: 'finish';     to: string; result: string; ts: number };
```

**归属关系**: `Connection`(一台智能体) → `Team`(成员角色) → `Session`(对话) / `Run`(任务执行); `Capability`(能力) 可按团队或按成员分配。

### 4.9 团队能力分配 (TeamCapability) —— 团队 ↔ 能力 多对多

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

> 关系: `Team 1 ── N TeamCapability ── N Capability`。

### 4.10 技能市场条目 (SkillMarketEntry) —— 外部技能源缓存

> Claw123.ai(claw123.ai)是 OpenClaw 精选技能导航站(5177+ 技能, 32 分类)。本模型缓存从该市场获取的技能索引, 作为「外部只读源」供用户浏览、搜索并导入本地能力仓库。

```ts
interface SkillMarketEntry {
  id: string;                        // `${source}:${name}` (如 "claw123:browser-tool")
  source: 'claw123';                 // 来源市场(首版仅 claw123, 预留扩展)
  name: string;                      // 技能名
  descriptionZh: string;             // 中文描述
  description?: string;              // 原始描述(原文)
  categoryZh: string;                // 中文分类
  url: string;                       // SKILL.md 源地址(用于导入时 fetch)
  imported: boolean;                 // 是否已导入本地能力仓库
  capabilityId?: string;             // 导入后关联的 Capability.id(§4.4)
  cachedAt: number;                  // 缓存时间
}
```

**与现有模型的关系**:
- `SkillMarketEntry` 是**只读缓存**, 不参与能力同步引擎(§5.4)的推送/拉取;
- 用户选择导入 → BFF 从 `url` 获取 SKILL.md → 创建 `Capability(type='skill', sourceKind='local')` → 后续经同步引擎推送到目标智能体;
- `imported + capabilityId` 维护市场条目 ↔ 本地能力的单向关联。

**数据源**: Claw123 API `/api/skills.zh.json`, 字段包括 `name` / `description_zh` / `category_zh` / `url`; 数据每日 06:00 自动同步, BFF 侧缓存 TTL 24h(可配)。

---

### 4.6 项目 (Project) —— 远程工作目录绑定

> 评审确认: **"本地目录的项目管理" = 工作目录绑定**; 且目录位于**远程智能体所在机器**, 控制台只登记/配置, **不涉及文件传输**。

```ts
interface AgentProject {
  id: string;                        // uuid
  name: string;                      // 显示名(如 "agent-ops-console")
  connectionId: string;              // 归属哪个实例(目录在该实例所在机器)
  rootPath: string;                  // 该实例机器上的绝对路径(如 /home/user/workspace/app 或 D:\proj\app)
  description?: string;
  defaultModel?: string;             // 可选, 用模型
  defaultAgent?: string;             // 可选, opencode 用到的 agent / hermes profile
  contextHint?: string;              // 注入会话的上下文提示(项目说明/约定)
  sessions: string[];                // 已在该项目上开过的 sessionId(审计/恢复用)
  createdAt: number; updatedAt: number;
}
```

**用途**: 
1. **会话上下文**: 创建会话时带 `projectId`, 驱动把 `rootPath` 作为该智能体的工作目录(OpenCode 即在该目录跑 `run`; Hermes 的 terminal.cwd; OpenClaw 的工作目录参数)。
2. **多会话复用**: 同一项目可在同一实例上开多条会话(见 §4.3), 关联到同一 `projectId`。
3. **多项目**: 一个实例可有 0..N 个项目; 一个项目归属一个实例(目录在某台机器上)。

**边界**: 
- 目录路径是**远程端机器**上的路径, 由实例所在机解析; 控制台只存字符串, 不校验远程是否真实存在(可在 test/发现时探测)。
- 不做本地↔远程文件同步(本实例目录由远程自行管理)。
- 项目归属实例, 不直接归属团队; 团队会话可引用成员各自的 projectId。

> 关系: `Connection 1 ── N Project`、`Project 1 ── N Session`。

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

### 5.0 端到端数据流 (E2E Flow)

> 两条核心链路的完整路径, 帮助实现时对齐各层职责。

#### 5.0.1 用户发消息 → 流式响应

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

#### 5.0.2 用户推能力 X → 目标实例

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

## 5. 关键子系统设计

### 5.1 适配层: 统一 `AgentConnection` 契约

每个适配器实现同一接口, BFF 只依赖接口:

```ts
interface AgentConnectionDriver {
  kind: string;
  test(baseUrl, auth): Promise<HealthProbe>;       // 探测连通 + capabilities
  listSessions(conn): Promise<AgentSession[]>;
  createSession(conn, opts: SessionCreateOpts): Promise<AgentSession>; // opts 可含 projectId → rootPath(§4.6)
  resumeSession(conn, sessionId): Promise<void>;
  deleteSession(conn, sessionId): Promise<void>;
  sendMessage(conn, sessionId, text): Promise<StreamHandle>; // 返回事件流
  stopSession(conn, sessionId): Promise<void>;

  // 能力同步
  listCapabilities(conn): Promise<CapabilityMeta[]>;
  pushCapability(conn, cap: Capability): Promise<SyncResult>;
  pullCapability(conn, name): Promise<Capability>;
  diffCapability(conn, cap): Promise<DiffResult>;
  deleteCapability(conn, name): Promise<void>;
}
```

**各适配器实现要点:**

| 操作 | OpenClaw | Hermes | OpenCode |
|---|---|---|---|
| 连通/会话 | Gateway RPC: `sessions.*` | `serve` WS + REST `/api/status` | `opencode web` server / `attach` |
| 发消息/流式 | RPC `agent.*` + `agent.wait`, 事件订阅 | OpenAI `/v1/responses` SSE 或 `/api/ws` | `opencode run`(非交互) 或 server WS |
| 建会话 | RPC session create | Responses `store:true` 或 PTY | `--session`/`continue` |
| 技能同步 | skill 目录 / MCP 配置(与 hermes 同为文件) | `~/.hermes/...` config.yaml mcp_servers + skills 目录 | 权限矩阵/agent md(有限) |
| MCP 共享 | MCP config | config.yaml `mcp_servers:` | opencode config + mcp |

#### 5.1.1 多实例与连接生命周期

> 针对评审澄清: **三种智能体(openclaw / hermes / opencode), 每种可有多个实例, 每种可配置多个远程智能体。**

**驱动(Driver)与实例(Connection)的关系**:

```
适配层
 ├─ openclaw.ts 驱动  <── 服务所有 kind='openclaw' 的 Connection
 ├─ hermes.ts   驱动  <── 服务所有 kind='hermes'   的 Connection
 └─ opencode.ts 驱动  <── 服务所有 kind='opencode' 的 Connection
```

- 每个 **`kind` 对应一个驱动实现**(共享协议逻辑与契约);
- 每个 **`AgentConnection` 记录一条远程智能体实例**(独立 `id`/`name`/endpoint/auth, §4.1);
- 同一种 `kind` 可有 **0..N 个 Connection**(如 3 台 Hermes、2 台 OpenCode), 各自独立建连、独立会话、独立能力同步。

**连接生命周期(每个 Connection 独立管理)**: BFF 持有一个 `ConnectionManager`:

```ts
interface ConnectionManager {
  registry: Map<connectionId, ManagedConnection>;
  connect(id): Promise<void>;      // 按需建立底层连接(WS/SSE/attach)
  disconnect(id): Promise<void>;
  reconnect(id): Promise<void>;    // 断线重连(指数退避)
  ensureConnected(id): Promise<void>; // 惰性建连: 操作前若未连接则先建
  health(id): Promise<HealthProbe>;   // 探活 + 刷新 capabilities/status
}
```

**连接策略(按 `kind` 与场景)**:
1. **惰性建连(默认)**: 会话/同步操作前 `ensureConnected`; 空闲超过阈值可 `disconnect` 释放, 避免占用大量远程实例的长连接。
2. **常驻连接(可配)**: 对高频实例(如团队 lead)可 `connect` 后保持, 减少反复握手开销。
3. **断线重连**: 统一指数退避; 恢复后重新拉取该 Connection 的 sessions/capabilities 索引。
4. **隔离**: 每个 Connection 的连接状态、错误、重连互不影响; 一个实例不可用不影响其他 0..N 个同 `kind` 实例。

**前端表现**: 智能体页按 `kind` 分组折叠, 每组下列出该种的所有实例(连接卡), 状态灯区分 `connected / error / disconnected`。新增连接向导选 `kind` → 填 endpoint/auth → 测试 → 保存, 即可加入任意一种的实例列表。

> **异构差异**: OpenCode 不原生具备 Hermes/OpenClaw 那种"技能目录"，其"能力共享"更切合 MCP 与 agent/permission 配置。同步引擎需对每种能力类型按 `type` 分派适配器内实现, 而非统一强制全类型支持 —— 不支持的类型返回 `unsupported` 并在 UI 明示。

### 5.2 会话管理

- **创建**: 选智能体(或团队) → `createSession` → 落库索引 → 返回会话。
- **重入**: 前端保持 `remoteSessionId`, 刷新后用 `resumeSession` 恢复历史。
- **流式**: 统一事件流格式, BFF 把异构流(OpenClaw RPC event / Hermes SSE / OpenCode)转为前端统一 schema:

```jsonc
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

> BFF 的 `/sessions/:id/stream` 端点: 前端 `EventSource` 连接后, BFF 找到该 sessionId 对应的适配器 + 原生流, 把 `StreamBridge` 输出的统一事件 pipe 到 SSE 响应。前端完全不感知后端协议差异。

**流中断恢复策略**:
- 每个统一事件携带递增 `seq`(该 sessionId 下从 0开始的序列号);
- SSE 支持 `Last-Event-ID` 标准头, 前端 EventSource 重连时自动带上;
- BFF 维护一个环形缓冲区(默认最近 200 事件 / 会话), 重连时从 `Last-Event_ID+1` 回放;
- 缓冲区溢出或 BFF 重启导致无法回放 → 前端收到 `{ "type": "meta", "resumed": false, "reason": "buffer_overflow" }`, 前端标记流为「部分丢失」并从当前继续;
- 对 OpenCode 非交互模式(`run`): 轮询模式天然无中断问题, 不适用回放。

#### 5.2.1 系统通知通道 (Notification Channel)

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

### 5.3 团队编排 (Team)

> **重要前提(见 §5.5)**: 团队协作分两种模式 —— **App 编排转述**(控制面, 经 BFF)与**成员自组织直连**(执行面, 智能体间互连)。本节描述 App 负责的编排; 互连机制详见 §5.5。

**两种协作模式**:

| 模式 | 谁传递消息 | 适用场景 | 特点 |
|---|---|---|---|
| **A. App 编排转述** | BFF 作为 Hub | 审批重、需 UI 全程可见、成员无互连能力 | 可靠/可审计/延迟略高/受限于单点 |
| **B. 成员自组织直连** | 成员间通过原生桥直接互调(§5.5) | 高频协作、去中心化、智能体互相查数据/派活 | 低延迟、需能力互连、需发现目录 |

**App 编排层的组长模式(可配置)**:

1. **串行编排(默认)**: `lead`(或任一 agent)按顺序把子任务派发给 `worker` 成员, 传递团队上下文摘要。实现: BFF 维护一条 "orchestration state machine"。
2. **并行 Fan-out**: 一个任务拆分为 N 个子任务, 并行发给多个成员会话, 汇总在 lead。
3. **评审环(Review loop)**: `reviewer` 对 `worker` 产物做质量门禁, 不通过则打回。

> 模式 A/B 不互斥: 同一团队可混合使用(例如 lead 用 A 派发主任务, worker 之间用 B 直连协作细节), 由 `TeamMember.interop`(§4.2) 决定每个成员参与哪种互连。

**团队上下文注入**: 每个成员在创建会话时, 在 system prompt / instructions 中注入: 团队目标、成员角色、**成员发现目录(含可互连队友的调用方式)**、共享能力清单、约定格式。这与"能力共享"联动 —— 团队可被分配一组共享技能/MCP。

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

> 长度控制: 团队上下文注入不超过 2000 token; 超长时截断成员发现目录(仅保留同团队队友), 优先保 team goal + role。

> **首版范围建议**: 模式 A(手动编排 + 团队聚合视图)作为默认; 模式 B 的"原生工具/指令桥"作为 M3 之后的增强项逐步启用。评审时需确认此优先级。

### 5.4 能力同步引擎 (Skill / Plugin / MCP)

这是本题要求"完整同步"的部分, 拆为 4 个阶段:

1. **编目/Enumerate**: 从各适配器 `listCapabilities` 拉取远程已有能力, 与本地索引合并, 建立 `Capability` 对象 + 内容 `checksum`(对目录递归哈希)。
2. **差异/Diff**: 对每个目标智能体 + 每个能力型计算 `checksum` 差异, 得出 `added / changed / removed / unchanged` 集合。
3. **传输/Transfer**: 按差异执行:
   - **推 (push)**: 本地能力 → 目标智能体。Hermes/OpenClaw 写文件/配置; MCP 写 `config.yaml`/mcp 配置块后触发 reload。
   - **拉 (pull)**: 目标智能体能力 → 本地仓库(便于在多个智能体间复制"从 A 同步到 B")。
4. **验证/Verify + 回滚**: 推送后探测该能力是否可用(`listCapabilities` 复核)。失败时基于 `lastSyncedAt` 快照回滚之前版本。

> **MCP 共享特殊说明**: MCP 服务器定义可能含密钥(如 command + env)。设计上**仅同步不含密钥的"骨架配置"**, 密钥由目标侧通过环境变量引用, 避免跨主机泄露敏感。这必须在 UI 中明示。

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

**状态机**: `pending → running → done | failed | cancelled`, 每个目标独立记录 `SyncResult`。

### 5.5 智能体间通信模型 (Agent ↔ Agent 互连)【新增】

> 为回答评审问题"是否考虑了 3 种智能体间的通信"而新增。原架构为纯**星型(hub-and-spoke)**: 一切经由 BFF 中转, 成员间无法直接互调。现升级为 **控制面(星型) + 执行面(可选直连/桥) 双层模型**。

**通信族职责**:
| 层 | 覆盖范围 | 路径 |
|---|---|---|
| **控制面** | 接入/状态/会话生命周期/能力同步/UI | App ↔ BFF ↔ 各 Agent(星型, 必须) |
| **执行面** | 团队任务中成员间的"查数据/派活/回传" | Agent ↔ Agent(直连或桥, 可选增强) |

#### 5.5.1 三种互连机制(按成员能力匹配)

| 机制 | 原理 | 适用 | 成本 |
|---|---|---|---|
| **1. 经 BFF 编排总线(默认回退)** | App 作为 Hub 转述/聚合, 维持现状 | 全部 | 低(已有 §5.3) |
| **2. 原生工具/指令桥(推荐主打)** | 给被调方注册一个 "agent-tool"; 调用方把它当普通工具直接调用(OpenClaw `/tools/invoke`、Hermes API/MCP); 双向各装一个"伙伴连接"工具 | OpenClaw ↔ Hermes(原生互操作最佳) | 中 |
| **3. 消息渠道 / webhook 桥** | 用双方都有的 inbound(OpenClaw 渠道、Hermes webhook :8644), 或脚本封装(`opencode run` → 结果回传)当"队友消息循环" | OpenClaw↔Hermes↔OpenCode(OpenCode 需 shell 包装) | 中(OpenCode 略高) |

**如何决策某对成员用哪种机制**:
1. 读取成员 `interop`(§4.2 新增字段) → 双方交集为可用机制;
2. 偏好顺序: 原生工具/指令桥 > 渠道/webhook 桥 > BFF 编排总线;
3. 最差回退到 BFF 即所有组合都可能互操作, 只是路径与性能不同。

#### 5.5.2 成员发现目录 (Member Directory)

让一个智能体能"找到另一个智能体"。由 BFF 汇总各适配器 `listMembers()`(OpenClaw 的 agent 列表 / Hermes 的 profile / OpenCode 的 agent 列表)建立统一目录:

```ts
interface MemberDescriptor {
  id: string;
  connectionId: string;
  name: string;
  kind: 'openclaw' | 'hermes' | 'opencode';
  teamId?: string;
  status: 'online' | 'busy' | 'offline';
  interop: (InteropMechanism)[];   // ['bff-bus']  | ['bff-bus','native-tool','channel-webhook']
  callableEndpoint?: string;        // 原生工具/桥的调用地址(如 OpenCode attach url)
  capabilities: string[];           // 该成员可用技能/MCP 名称
}
type InteropMechanism = 'bff-bus' | 'native-tool' | 'channel-webhook';
```

**注入**: 每个成员会话创建时, 把"可用队友"的子集(同一团队 + 在线 + 可达)注入 system context, 使智能体知道"可以叫谁、怎么叫"。

#### 5.5.3 队内消息信封 (TeamMessage Envelope)

无论走哪种互连机制, 内容语义统一, 便于审计、路由与上下文汇聚:

```jsonc
{
  "schema": "team-message/v1",
  "traceId": "t-…",                 // 贯穿一次团队任务的调用链
  "from": "member:hermes-worker",
  "to":   "member:opencaw-lead",
  "teamId": "team:…",
  "relay": "bff-bus | native-tool | channel-webhook",
  "payload": { "type": "query | dispatch | respond | approval", "text": "…", "attachments": [] },
  "ts": 1770000000000
}
```

**能力**: ① 统一 `traceId` 让 App/审计端把一次团队任务的跨成员消息串起来; ② BFF 可把直连消息也镜像到控制面用于审计与 UI 展示; ③ webhook 桥/工具桥只需按各自协议做 Envelope ↔ 原生格式互换。

#### 5.5.4 简化实现路径(建议演进顺序)

1. **先且仅**: 模式 A(BFF 编排总线) + 成员发现目录 + Envelope 落地 —— 成员已可"看到"队友, 但调用仍走 App 转述(可靠, 覆盖面 100%)。
2. **再启用**: OpenClaw↔Hermes 原生工具/指令桥(互操作性最好的那条), 验证 Envelope 互换。
3. **后补**: OpenCode 通过 shell 包装的 run/attach 桥, 覆盖三方互连。

### 5.6 技能市场集成 (Skill Market Integration)

> 集成外部技能市场 Claw123.ai, 提供技能浏览、搜索、导入能力。这是「外部技能源 → 本地能力仓库 → 目标智能体」的入口。

**架构定位**: Claw123 是**只读外部源** — 控制台只消费不产出。导入的技能进入本地 Capability 仓库(§4.4), 后续经现有同步引擎(§5.4)推送到目标智能体。

```
Claw123.ai (外部 API, /api/skills.zh.json)
  ↓ fetch (每日定时 or 手动刷新)
BFF SkillMarketService
  ↓ 缓存 + 全文索引
SQLite (skill_market_cache 表)
  ↓ 浏览/搜索/分页
前端技能市场页
  ↓ 用户选择 + 点击导入
BFF 从 entry.url 获取 SKILL.md → 解析 → 创建 Capability 记录
  ↓ 经同步引擎推送 (复用 §5.4)
目标远程智能体
```

**SkillMarketService 接口**(BFF 内部, §9 `services/SkillMarketService`):

```ts
interface SkillMarketService {
  /** 从 Claw123 API 拉取完整技能列表, 缓存到本地 SQLite */
  refresh(force?: boolean): Promise<{ total: number; updated: number }>;

  /** 搜索技能(基于缓存, 支持中文全文搜索) */
  search(query: string, categoryZh?: string, page?: number, size?: number)
    : Promise<{ items: SkillMarketEntry[]; total: number; page: number }>;

  /** 获取单个技能详情 */
  getDetail(id: string): Promise<SkillMarketEntry>;

  /** 获取分类列表(含技能计数) */
  categories(): Promise<{ name: string; count: number }[]>;

  /** 导入技能: fetch SKILL.md → 创建 Capability → 建立关联 */
  importSkill(id: string): Promise<Capability>;
}
```

**Claw123Adapter**(§9 `adapters/claw123.ts`):

```ts
interface Claw123Adapter {
  /** 获取完整技能列表 */
  fetchSkills(): Promise<RawSkillMarketItem[]>;

  /** 获取单个技能的 SKILL.md 内容(用于导入) */
  fetchSkillMd(url: string): Promise<string>;
}

interface RawSkillMarketItem {
  name: string;
  description_zh: string;
  category_zh: string;
  url: string;
}
```

**导入流程**(`importSkill`):
1. 查 `SkillMarketEntry` → 取 `url`;
2. `Claw123Adapter.fetchSkillMd(url)` 获取 SKILL.md 原始文本;
3. 解析 SKILL.md frontmatter(名称/描述/依赖);
4. 创建 `Capability(type='skill', sourceKind='local', payload={kind:'file', content: SKILL.md})`;
5. 更新 `SkillMarketEntry.imported=true + capabilityId`;
6. 返回 Capability, 后续由用户经同步引擎推送至目标智能体。

**缓存策略**:
- 首次访问技能市场 → 自动 `refresh`;
- 缓存 TTL 24h(可配 `AOC_SKILL_MARKET_TTL_MS`);
- 前端显示「缓存时间」+ 「强制刷新」按钮;
- 后端定时任务: 每日 06:30(市场同步后 30min)自动 refresh。

**边界**:
- 不写入 Claw123(纯消费);
- 不自动安装 — 导入仅需下载 SKILL.md 创建 Capability 记录, 推送至目标智能体仍需用户手动操作同步;
- 导入失败(SKILL.md 不可达/格式异常) → 返回错误, 不创建 Capability;
- 同一技能重复导入 → 基于 `name` 幂等校验, 已存在则更新内容而非重复创建。

### 5.7 优雅关闭与恢复 (Graceful Shutdown)

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

### 5.8 同步一致性与竞态 (Consistency)

**背景**: 能力同步与团队编排都涉及"多个远程目标 + 异步执行", 必须显式处理竞态, 否则会出现半推状态、版本错乱、重复派发。

**关键约束**:
1. **目标级原子性**: 对**单个**目标智能体的单次 push 视为一个事务; 若该目标内部(如写 config.yaml 后再 reload)中途失败, 回滚到 `lastSyncedAt` 快照。
2. **跨目标非原子(可预见的弱一致)**: 一次"推多个目标"是**尽力而为**的扇出 —— 每个目标独立事务, 各自成功/失败独立记录; UI 以结构化 diff 展示每个目标的结果, 不阻塞其它目标。
3. **版本控制**: `AgentTeam.version`(乐观锁)防并发编辑团队; `Capability.lastSyncedAt` 记录每目标最后推送时间。
4. **幂等**: push 以 `capability.name + checksum` 为幂等键, 重复执行不产生脏数据; 队内消息以 `traceId + messageId` 去重。
5. **冲突解决**: 两用户同时推不同版本同一能力到同一目标 -> `Capability.checksum`(乐观锁)校验, 后者 CAS 失败收到 `SYNC_CONFLICT` 错误, UI 提示"目标侧已有新版本, 请刷新后重试"; 两用户同时编辑同一团队 -> `AgentTeam.version`(乐观锁)防并发覆盖, 后者收到冲突提示。
6. **超时/悬挂**: 所有对外调用(agent 运行、webhook 桥)设超时; 超时置 `Run.status='failed'` 并在 UI 明示"结果可能仍会在目标侧继续", 避免 UI 与真实不一致。
7. **回滚范围**: 回滚只作用于**最近一次同步涉及的 capability+目标**, 带 before/after checksum 校验, 防止回滚掉他人并发推送的新版本("CAS" 校验)。

---

## 6. API 设计 (BFF, REST 前缀 `/api`)

### 6.1 配置参考 (Environment Variables)

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
| `POST` | `/connections` | 接入新智能体(测试连通 + 探测能力) |
| `GET` / `GET :id` | `/connections` | 列出/详情 |
| `PATCH` | `/connections/:id` | 更新连接/凭据 |
| `DELETE` | `/connections/:id` | 移除 |
| `POST` | `/connections/:id/test` | 连通性测试 |
| `POST` | `/connections/:id/discover` | 重新探测 capabilities |
| `GET/POST` | `/teams` | 团队列表/创建 |
| `GET/PATCH/DELETE` | `/teams/:id` | 团队详情/成员编辑/删除 |
| `POST` | `/sessions` | 创建会话(body: connectionId 或 teamId + 首条消息); 同一 connectionId 可建多个会话 |
| `GET` | `/sessions` | 会话列表(可按 connection/team 过滤、按 connectionId 分组聚合) |
| `GET` | `/sessions/:id` | 获取单个会话详情 |
| `GET` | `/sessions/:id/stream` | SSE 事件流(发消息 + 流式接收) |
| `POST` | `/sessions/:id/message` | 向会话发消息( body: { text: string } ) |
| `PATCH` | `/sessions/:id` | 更新会话(如 rename title) |
| `GET` | `/sessions/:id/history` | 获取会话历史消息 |
| `DELETE` | `/sessions/:id` | 关闭会话 |
| `GET/POST` | `/projects` | 项目列表/创建(绑定某实例的远程工作目录, §4.6) |
| `GET/PATCH/DELETE` | `/projects/:id` | 项目详情/更新/删除 |
| `GET` | `/connections/:id/projects` | 某实例下的项目列表 |
| `GET` | `/capabilities` | 本地能力仓库列表 |
| `POST` | `/capabilities/import` | 从某连接拉取(pull)能力 |
| `GET` | `/members` | 成员发现目录(汇总各连接 agent/profile, §5.5.2) |
| `POST` | `/teams/:id/message` | 队内消息(App 编排总线方式派发, Envelope, §5.5.3) |
| `GET` | `/teams/:id/traces/:traceId` | 按 traceId 查看一次团队任务的跨成员调用链(审计) |
| `POST` | `/synctasks` | 发起同步任务(push 一组能力到目标连接) |
| `GET` | `/synctasks/:id` | 轮询同步进度(结构化 diff 视图) |
| `POST` | `/synctasks/:id/rollback` | 回滚一次同步 |
| `GET` | `/health` | 框架健康检查 |
| `GET` | `/api/skill-market/skills` | 技能市场列表(搜索/分类/分页, query: q/categoryZh/page/size) |
| `GET` | `/api/skill-market/skills/:id` | 技能详情 |
| `POST` | `/api/skill-market/skills/:id/import` | 导入技能到本地能力仓库 |
| `POST` | `/api/skill-market/refresh` | 强制刷新市场缓存 |
| `GET` | `/api/skill-market/categories` | 分类列表(含技能计数) |

**统一错误响应**: 所有 API 错误返回统一 schema, 前端据此做 toast / retry / 错误边界:

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

**流式约定**: `/sessions/:id/stream` 为 Server-Sent Events(事件 schema 见 §5.2)。消息发送走 `POST /sessions/:id/message`, 读走 SSE, 解耦请求与持续事件。当适配器原生为 WebSocket(如 OpenClaw/OpenCode WS)时, BFF 内部将 `POST /sessions/:id/message` 桥接为 WS 发送, 将 WS 下行事件转 SSE 推向前端, 前端只感知 SSE。

---

## 7. 安全设计

| 威胁 | 对策 |
|---|---|
| 远程智能体凭据泄露 | 前端 → BFF 全程 TLS; 凭据用应用级 secret 加密(AES-GCM)落库, 密钥存环境变量; BFF 不把明文凭据回传前端 |
| 未授权用户操作 | BFF 前置认证(首版本地单用户 + session cookie/token; 预留 OAuth) |
| MCP 配置含密钥 | 同步仅传"骨架", 密钥用占位/环境引用(见 §5.4) |
| 跨智能体越权 | 同步引擎每次 push/pull 校验目标连接归属与角色权限(lead 才可改团队共享能力) |
| **互连桥任意工具执行**(高风险) | 模式 B(§5.5)让成员 A 直接调用成员 B 的工具 = **在 B 机器上执行代码**。必须: ① 桥调用受被调方的 permission/审批策略约束(OpenClaw 审批、OpenCode `/permissions`、Hermes 澄清/审批); ② 双向"伙伴连接工具"仅暴露白名单动作, 不透传任意 shell/文件写; ③ 记录所有桥调用到 audit 并附 `traceId` |
| 审批旁路 | 所有 `approval.request` 事件(会话审批、桥调用、同步高影响推送到 audit 表)必须经 BFF 汇聚后可人工批准/拒绝, 默认拒绝; 审批动作本身可审计 |
| CORS/CSRF | BFF 统一收口, 严格 origin 白名单 + CSRF token |
| 审计 | 记录所有同步/会话/团队变更到 SQLite audit 表(操作者、目标、capability、时间) |

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

**查询**: `GET /api/audit?action=&targetType=&from=&to=` (预留, M6 实现)。

---

## 8. 前端设计 (Vue 3)

### 8.1 页面结构

```
Agent Ops Console
├── 侧边栏导航
│   ├── 智能体 (Connections)    — 接入/连接状态/能力探针
│   ├── 团队   (Teams)          — 组队/成员角色/团队级能力分配
│   ├── 会话   (Sessions)       — 会话列表 + 聊天/流式工作台
│   ├── 能力库 (Capabilities)   — 技能/插件/MCP 统一仓库 + 同步控制台
│   └── 项目   (Projects)       — 远程工作目录绑定管理(新建会话时选项目, §4.6)
│   └── 技能市场 (SkillMarket)   — Claw123 技能浏览/搜索/导入(§5.6)
└── 顶部全局状态条(连接健康轮询 /api/health + 进行中同步任务 + 断开提示)
```

- **智能体页**: 卡片网格, 每条显示 kind 徽标 + 状态灯; 新增连接向导(选协议 → 填 endpoint/auth → "测试连接" → 探测能力 → 保存)。
- **团队页**: 团队卡片, 展开显示成员(角色徽标)+ 共享能力芯片; 编辑支持拖拽成员。
- **会话页**: 左列表(会话), 中聊天流(UnifiedStream 渲染器: 文本/Tool call/审批), 右成员面板(团队时)。支持"新建会话"(可绑定某实例的项目目录, 见 §4.6)、多成员并行视图; 团队会话可切换到 **Run/Trace 视图**(按 traceId 展示一次团队任务的跨成员派发/回传/完成时间线, 数据来自 `/teams/:id/traces`)。
- **项目页**: 项目列表(按归属实例分组), 新建/编辑项目(填实例 + 远程 rootPath), 展示该项目下已开的会话。

**前端状态指引**(全局):
- **Loading**: 所有异步操作(连接测试/会话创建/同步)显示 skeleton 或 spinner; 流式文本区域显示"正在思考..."打字指示器。
- **Error**: BFF 返回 `error.code` 时, 右上角 toast 显示 `message` + 重试按钮(若有); 整页错误用 Error Boundary 兜底(提示 + 刷新)。
- **Empty**: 列表为空时显示插图 + 引导文案(如"还没有接入任何智能体, 点击 + 开始")。
- **离线**: 连接状态灯变红 + 顶部横幅提示"与 {name} 断开", 自动重连后消失。
- **技能市场页**: 左分类导航(32 分类) + 顶搜索框 + 技能卡片网格; 点击卡片展开详情弹窗(描述/来源/分类) + 「导入」按钮; 导入后该技能出现在能力库页, 可经同步引擎推送到目标智能体。顶部显示缓存时间 + 强制刷新按钮。
- **能力库页**: 三 Tab(技能/插件/MCP)。每行: 名称/版本/来源/已部署目标/状态。同步控制台为**状态机**: `选择来源 → 选择目标 → 预览diff → 执行 → 流式进度 → 结果(按目标逐项) → 可回滚`; 每个目标独立成功/失败展示(见 §5.7.2), 并标注"MCP 仅同步骨架配置"。

### 8.2 关键技术栈

| 关注点 | 选型 |
|---|---|
| 框架 | Vue 3 + TypeScript |
| 状态 | Pinia (connections/teams/sessions/sync store) |
| 流式 | 前端用原生 `EventSource`(/sessions/:id/stream) + `WebSocket`(需要双向时) |
| HTTP | axios(带拦截器注入 BFF token) |
| 路由 | Vue Router(六个页面) |
| 样式 | 浅色 dashboard + 一个 accent; 克制卡片化, 以表格/分割线为主(高密度运维 UI) |

> **遵循 A11y**: 状态用颜色+文字双通道, 流式文本加 `aria-live="polite"`, 触控目标 ≥44px。

---

## 9. 目录结构(建议)

```
agent-ops-console/
├── server/                     # BFF (Node.js Fastify)
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/             # connections/teams/sessions/capabilities/synctasks
│   │   │   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + claw123.ts(技能市场)
│   │   ├── services/           # ConnectionManager / SyncEngine / SkillMarketService
│   │   ├── bridge/             # 异构流 → 统一 SSE 事件 (StreamBridge 基类 + 各适配器实现)
│   │   ├── crypto.ts           # 凭据加密
│   │   └── db/                 # SQLite schema + migration
│   └── package.json
├── web/                        # 前端 (Vue 3 + Vite)
│   ├── src/
│   │   ├── pages/              # Connections/Teams/Sessions/Capabilities/Projects/SkillMarket
│   │   ├── components/         # UnifiedStream/ToolCallCard/ConnWizard/SyncConsole...
│   │   ├── stores/             # Pinia
│   │   ├── api/                # BFF client
│   │   └── types/              # 共享类型 + 事件 schema
│   └── package.json
├── docs/
└── README.md
```

---

## 10. 里程碑 (Roadmap)

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0 调研+设计**(本文档) | 接入方式调研、架构、评审 | 评审通过 |
| **M1 接入骨架** | BFF + OpenClaw 适配器 + 前端智能体页 | 能接入真实 OpenClaw, 显示状态与能力探针 |
| **M2 会话管理** | sessions API + 统一流式渲染 + 会话页 | 创建/重入/关闭 OpenClaw 会话并流式对话 |
| **M3 多适配器** | Hermes + OpenCode 适配器 | 三种智能体均可接入+会话 |
| **M3.5 成员发现+队内消息** | 成员目录 + TeamMessage Envelope + BFF 编排总线 | 同一团队内成员可互相"看到"并经由 App 转述互发队内消息 |
| **M4 团队编排** | 团队 + 手动/串行编排 + 团队会话视图 | 组队并派发任务, 汇总结果 |
| **M4.5 原生工具/指令桥** | OpenClaw↔Hermes 互连桥(执行面直连) | 两智能体可经原生工具直接互调, Envelope 互换验证 |
| **M5 能力同步** | 技能/插件/MCP 同步引擎 + 能力库页 | 双向推拉 diff 展示 + 回滚 |
| **M5.5 技能市场** | Claw123 集成 + 技能市场页 | 浏览/搜索/导入技能到本地能力仓库 |
| **M6 收尾** | 安全加固、审计、文档、打包部署 | 完整可交付 |

> **依赖外部条件**: 各远程智能体需开放相应 endpoint(Hermes `serve`/API、OpenCode `web` 后端、OpenClaw gateway), 并提供测试实例。M1 起需具备至少一个 OpenClaw 测试环境。

---

## 附录 A: 已定决策 (2026-08-05 评审拍板)

| # | 决策点 | 决议 | 说明 |
|---|---|---|---|
| 1 | 编排模式首发 | ✅ **手动编排优先** | 串行状态机自动编排推迟, 见 §5.3 |
| 2 | OpenCode 能力边界 | ✅ **仅 MCP + agent/权限配置; 技能/插件类对 OpenCode 返回 unsupported** | 不伪造非原生能力, 见 §5.1 |
| 3 | 部署形态 | ✅ **本机快速开发(前端+BFF 双进程)** | 交付时再加 Docker Compose/TLS |
| 4 | MCP 密钥策略 | ✅ **仅同步骨架配置 + 目标侧环境变量引用** | 防跨主机泄密, 见 §5.4 |
| 5 | 凭据持久化 | ✅ **BFF 加密落库**(AES-GCM, 密钥存环境变量) | 见 §7 |
| 6 | 认证模型 | ✅ **本地单用户, 预留 OAuth/多用户扩展** | 见 §7 |
| 7 | 模式 B 互连桥暴露 | ✅ **仅限内网/Tailscale + lead 角色可启用; 公网默认禁用** | 跨主机代码执行红线, 见 §7 |
| 8 | Run 首版范围 | ✅ **手动派发 + Run/Trace 记录; 自动编排推迟 M4** | 见 §4.5 |

> 附加(前端技术栈): **Vue 3 + TypeScript + Pinia**(沿用架构推荐, 已在 §8 定稿)。

---

## 附录 B: 参考来源

- OpenClaw docs — External apps(Gateway 集成路径): `docs.openclaw.ai/zh-CN/gateway/external-apps`, `tools-invoke-http-api`, Gateway Protocol / RPC / CLI(`agent`,`message`).
- Hermes (Nous Research) — Web Dashboard(`hermes serve` :9119, `/api/status`, `/api/ws`,`/api/events`,`/api/pty`), API Server(`/v1/chat/completions`,`/v1/responses`, SSE, :8642), inbound webhooks(:8644), `~/.hermes/` config.yaml mcp_servers + plugins + skills.
- OpenCode (SST→Anthropic) — TUI 默认; CLI `run`/`agent`/`attach`; `opencode web --port --hostname` 后端服务器, basic auth; agent 权限矩阵。
