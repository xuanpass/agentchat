# A2A 接入设计 — OpenClaw + Hermes

> 状态：**已实现并验证**（2026-09-04 落地 + 真实端点 E2E）
> 日期：2026-09-03（设计）/ 2026-09-04（实现）
> 结论：**可行**。两个智能体均暴露官方原生 A2A v1.0 JSON-RPC 端点，一套统一 `a2a` 驱动即可同时接入。

---

## 1. 背景与结论

101 服务器（192.168.123.101）上 OpenClaw 与 Hermes 的 A2A 均已开启并实测可达。本项目当前适配层只有 `hermes` / `openclaw-ws` / `openclaw-cli` / `opencode` 四个驱动，**没有 A2A 驱动**。本设计新增一个统一 `a2a` 驱动，把 OpenClaw、Hermes（以及未来任何 A2A 框架：LangChain / CrewAI / Google ADK）归一接入。

### 1.1 实测端点数据（2026-09-03 SSH 探活）

| 智能体 | A2A 实现 | Agent Card | JSON-RPC 端点 | 协议版本 | 流式 | 推送 |
|---|---|---|---|---|---|---|
| **OpenClaw** | 官方 `stock:a2a` 插件 v2026.8.2 | `http://127.0.0.1:18789/.well-known/agent-card.json` ✅ | `http://192.168.123.101:18789/a2a/v1` | `1.0` | ❌ `streaming:false` | ❌ |
| **Hermes** | 官方内置插件（v0.20+） | `http://127.0.0.1:9900/.well-known/agent-card.json` ✅ | `http://127.0.0.1:9900/` | `1.0` | ✅ `streaming:true` | ✅ |

关键差异（驱动必须兼容）：

- **JSON-RPC 挂载路径不同**：OpenClaw 在 `/a2a/v1`，Hermes 在 `/`。→ Agent Card 的 `supportedInterfaces[].url` 才是唯一事实来源，**不可硬编码路径**。
- **流式能力不同**：OpenClaw `streaming:false`，Hermes `streaming:true`。→ 驱动必须做双路径（见 §6）。
- OpenClaw 已配好 `peers.hermes → http://192.168.123.101:9900`（带双向 token），说明两智能体间已能经 A2A 互通；控制台接入是**第三条旁路**（人 → 控制台 → A2A 端点），与它们的点对点互通互不干扰。

---

## 2. 决策记录

| # | 决策点 | 决议 |
|---|---|---|
| D1 | kind 建模 | **新增独立 `kind='a2a'`**。一个 A2A 连接 = 一个 A2A 端点，背后是 openclaw/hermes 由 Agent Card `name`/`provider` 自动识别，不渗入控制面 |
| D2 | 驱动数量 | **一个 `a2aDriver` 服务所有 A2A 连接**（协议层框架无关，无需 per-framework 驱动） |
| D3 | 能力同步 | A2A 不承载能力文件推送 → push/pull/diff/delete 返回 `unsupported`，仅 `listCapabilities` 从 Agent Card `skills[]` 只读编目 |
| D4 | 凭据 | 复用现有 AES-GCM 加密链路（`auth.type='token'`，`encrypted` 字段），注入 `Authorization: Bearer` |
| D5 | 流式降级 | 按 `capabilities.streaming` 分派：`true` 走 SSE 流式，`false` 走同步 `SendMessage` + `GetTask` 轮询 |

---

## 3. A2A v1.0 协议要点（写入依据）

### 3.1 发现 — Agent Card

```
GET /.well-known/agent-card.json
```

关键字段（实测确认）：

```jsonc
{
  "name": "hermes-wangxuan-20aseb3",
  "version": "1.0.0",
  "provider": { "organization": "Hermes Agent" },
  "supportedInterfaces": [
    { "url": "http://127.0.0.1:9900/", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }
  ],
  "capabilities": { "streaming": true, "pushNotifications": true,
                    "stateTransitionHistory": false, "extendedAgentCard": false },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    { "id": "toolset.browser", "name": "browser", "description": "...", "tags": ["browser","browser_navigate",...] }
  ]
}
```

- `supportedInterfaces[].url` = JSON-RPC 端点（OpenClaw 挂 `/a2a/v1`，Hermes 挂 `/`）。
- `capabilities.streaming` = 是否支持流式。
- `skills[]` = 该 agent 暴露的能力声明（→ 能力编目 §8）。

### 3.2 JSON-RPC 2.0 方法（v1.0 canonical）

| 方法 | 用途 | 本驱动是否使用 |
|---|---|---|
| `SendMessage` | 同步发消息（非流式） | ✅ OpenClaw 路径 |
| `SendStreamingMessage` | 流式发消息（SSE） | ✅ Hermes 路径 |
| `GetTask` | 查任务状态/产物 | ✅ 轮询 + 复用 |
| `ListTasks` | 列任务（分页） | ✅ listSessions |
| `CancelTask` | 取消任务 | ⭕ 可选 stopSession |
| `SubscribeToTask` | 订阅任务事件流 | ⭕ 预留 |

> 兼容提示：Hermes 同时支持 pre-1.0 的 path 别名（`message/send` 等），驱动统一用 v1.0 canonical 方法即可覆盖两端。

### 3.3 核心数据模型（官方 spec §4）

```jsonc
// Message
{ "messageId": "uuid", "role": "user", "contextId": "ctx-1",
  "parts": [{ "text": "你好", "mediaType": "text/plain" }] }

// Part（OneOf）
{ "text": "..." } | { "raw": "base64" } | { "url": "..." } | { "data": {...} }

// Task
{ "id": "task-1", "contextId": "ctx-1",
  "status": { "state": "working", "message": {...} },
  "artifacts": [], "history": [ Message... ] }

// TaskState
"submitted" | "working" | "input-required" | "completed"
| "failed" | "canceled" | "rejected" | "auth-required"
```

---

## 4. 驱动接口映射（核心）

`a2aDriver` 实现现有 `AgentConnectionDriver` 契约（`server/src/types.ts`），方法映射如下：

| 契约方法 | A2A 实现 | 说明 |
|---|---|---|
| `test(baseUrl, auth)` | GET `/.well-known/agent-card.json` | 解析 name/version/capabilities/skills；4s 超时 |
| `listSessions(conn)` | JSON-RPC `ListTasks` | 按 `contextId` 聚合为会话；首版可降级返回控制台 DB 已有会话 |
| `createSession(conn, opts)` | 本地生成 `contextId`(uuid) | A2A 无显式建会话操作，contextId 即会话标识 |
| `sendMessage(conn, ctxId, text)` | 双路径 `SendMessage` / `SendStreamingMessage` | 见 §6 |
| `stopSession(conn, ctxId)` | `CancelTask`（需 taskId） | 首版空实现，记录最近 taskId 后取消 |
| `listCapabilities(conn)` | Agent Card `skills[]` → `CapabilityMeta[]` | 只读编目，见 §8 |
| `pushCapability` | — | 返回 `unsupported`（A2A 无文件推送语义） |
| `pullCapability` | — | 返回 `unsupported` |
| `diffCapability` | — | 返回空 diff（`unchanged:[]`） |
| `deleteCapability` | — | 返回 `unsupported` |

### 4.1 端点与认证解析

- **JSON-RPC 端点**：从 Agent Card `supportedInterfaces[].url` 取，缓存于连接的 `endpoint.baseUrl`（用户填 agent-card 根 URL 或直接填 JSON-RPC URL，驱动统一归一）。
- **认证**：`auth.type='token'` → `decryptCredential(conn.auth)` → `Authorization: Bearer <token>`。
  - OpenClaw：填 peer 的 **outbound token**。
  - Hermes：填 `A2A_PEER_TOKENS` 里给本控制台分配的 token；若未设 token 则仅 localhost 可连。

---

## 5. 会话模型（contextId ↔ remoteSessionId）

A2A 的会话即 `contextId`，多轮对话靠同一 `contextId` 关联。映射：

```
AgentSession.remoteSessionId = A2A contextId（控制台本地生成 uuid）
createSession → 生成 contextId，落库，不调用远程
sendMessage → 每次 Message 携带 contextId
listSessions → ListTasks 按 contextId 去重（title 取最后一条 message 文本前 N 字）
```

> 设计取舍：A2A 服务端不持久化"空会话"，所以 `createSession` 是纯本地动作，首次 `sendMessage` 才在远端产生 Task。这与现有 Hermes 适配器的做法一致。

---

## 6. 双路径流式设计（关键）

```
sendMessage(conn, ctxId, text)
  ├─ capabilities.streaming === true
  │    → POST {jsonrpc, method:"SendStreamingMessage", params:{message}}
  │    → 响应 text/event-stream
  │    → 逐帧解析 JSON-RPC enveloped 事件：
  │         TaskStatusUpdateEvent.status.message.parts[].text → "text.delta"
  │         TaskArtifactUpdateEvent → "tool.result" / 附件
  │         终态 state ∈ {completed,failed,canceled,rejected} → "done"/"error"
  │    → StreamBridge 转统一 SSE 事件
  │
  └─ capabilities.streaming === false   (OpenClaw)
       → POST {jsonrpc, method:"SendMessage", params:{message}}
       → result 为 Message（直接回复）或 Task（异步）
       → 若 Task 且 state 非终态：轮询 GetTask({id})，间隔 500ms，指数退避
       → 取 Task.history 最后一条 role=agent 的 parts[].text 作为完整回复
       → 一次性 emit "text.delta"(全文) + "done"
```

统一事件（沿用 ARCHITECTURE.md §5.2 schema）：`text.delta` / `tool.start` / `tool.result` / `done` / `error`。

**实现要点**：

1. OpenClaw 非流式路径是"阻塞等待"语义，超时上限用 `AOC_AGENT_TIMEOUT_MS`（默认 120s），与现有 openclaw-cli 一致。
2. `GetTask` 轮询要设最大轮询次数（如 240 次 × 500ms ≈ 120s），防悬挂。
3. 流式路径 SSE 需处理 `Last-Event-ID` 断点续传（若远端支持；首版可不做，靠前端 EventSource 自动重连）。

---

## 7. 能力编目（listCapabilities）

Agent Card `skills[]` → `CapabilityMeta`：

```ts
skills.map(s => ({
  name: s.id,                    // 如 "toolset.browser"
  type: 'skill',
  version: undefined,
  checksum: simpleChecksum(JSON.stringify(s)),
  sizeBytes: JSON.stringify(s).length,
}))
```

- Hermes：`toolset.a2a` / `toolset.browser` / `toolset.browser-cdp` ...
- OpenClaw：Agent Card 的 `skills`（如 `main`）

> 这些是**能力声明**，不是可推送的文件。能力库页对 A2A 连接应只展示只读列表，屏蔽"推送/拉取/同步"按钮（或置灰 + 标注"A2A 不支持能力同步"）。

---

## 8. 错误码映射

| 场景 | 映射 |
|---|---|
| agent-card 请求超时 / 连接拒绝 | `CONN_TIMEOUT` / `CONN_REFUSED` |
| HTTP 401 / 403 | `AUTH_FAILED` |
| agent-card 404 | `NOT_FOUND`（endpoint 填错） |
| JSON-RPC `error` 返回 | `INTERNAL`（携带 `error.message`） |
| 能力 push/pull/delete | `UNSUPPORTED` |
| 轮询超时悬挂 | `CONN_TIMEOUT`（UI 提示"远端可能仍在执行"） |

---

## 9. 改动文件清单

### 后端

| 文件 | 改动 |
|---|---|
| `server/src/types.ts` | `AgentKind` 加 `'a2a'` |
| `server/src/adapters/a2a.ts` | **新增**，实现 `AgentConnectionDriver`（核心，~250 行，纯 `fetch` + JSON-RPC，无需 ws 库） |
| `server/src/index.ts` | `main()` 内加 `registerDriver(a2aDriver)` + import |
| `server/src/routes/connections.ts` | `z.enum([...])` 加 `'a2a'` |
| `server/src/db/schema.ts` | `connections` 表 CHECK 约束加 `'a2a'` |

### 前端

| 文件 | 改动 |
|---|---|
| `web/src/stores/connections.ts` | 第 11 行 kind 类型、第 27 行分组对象加 `a2a` |
| `web/src/pages/ConnectionsPage.vue` | 连接向导加 `A2A` 选项（表单：名称 + agent-card/JSON-RPC URL + token）；kind 徽标样式 |

### ⚠️ DB migration（重点，不可只改 schema）

`schema.ts` 的 `migrate()` 仅执行 `CREATE TABLE IF NOT EXISTS`，**已存在的 `connections` 表不会因改 CHECK 约束而生效**。SQLite 无法直接改 CHECK，需重建表：

```
1. CREATE TABLE connections_new (…新 CHECK 含 'a2a'…)
2. INSERT INTO connections_new SELECT * FROM connections
3. DROP TABLE connections
4. ALTER TABLE connections_new RENAME TO connections
5. 重建 idx（外键引用 connections 的表用 ON DELETE CASCADE，重建同名表后需确认 FK 仍有效）
```

> 备选（更省事）：**移除 kind 的 CHECK 约束**，kind 合法性只交给应用层 zod 校验。这样未来加新 kind 不再动 DB。但现有 DB 表仍带旧 CHECK，仍需一次性重建。二者迁移成本相同，**推荐直接移除 CHECK**，长期收益更好。

---

## 10. 端到端数据流（发消息）

```
前端 AgentChatPage 输入
  → POST /sessions/:id/message  (BFF)
    → sessions route 查 session → 取 connectionId → getDriver('a2a')
      → a2aDriver.sendMessage(conn, contextId, text)
        ├─ streaming=true:  SendStreamingMessage → SSE 逐帧 → StreamBridge 统一事件
        └─ streaming=false: SendMessage → (Task? 轮询 GetTask) → 一次性全文事件
      → BFF pipe 到 /sessions/:id/stream (SSE)
        → 前端 UnifiedStream 渲染
```

---

## 11. 验证计划（落地后执行）

| # | 验证项 | 方法 | 预期 |
|---|---|---|---|
| 1 | Agent Card 探活 | `test()` 连 `http://192.168.123.101:18789` 与 `http://127.0.0.1:9900` | 均 `ok:true`，capabilities 正确（OpenClaw streaming=false） |
| 2 | OpenClaw 非流式对话 | 经控制台向 OpenClaw A2A 连接发"你好" | 返回 agent 文本回复，session 落库 |
| 3 | Hermes 流式对话 | 经控制台向 Hermes A2A 连接发消息 | SSE 流式逐字返回 + done |
| 4 | 多轮上下文 | 同一会话连发两条，第二条引用第一条 | contextId 关联正确，agent 记得上文 |
| 5 | 能力编目 | 打开能力库看 A2A 连接 | 只读列出 `toolset.*` / skills，无推送按钮 |
| 6 | 错误路径 | 填错 token / 停掉 9900 | 返回 `AUTH_FAILED` / `CONN_REFUSED`，UI toast |
| 7 | 构建/单测 | `npm -w server run build` + `npm -w server run test` | 通过，无回归 |

---

## 12. 风险与坑

1. **JSON-RPC 路径不可硬编码**（OpenClaw `/a2a/v1` vs Hermes `/`）—— 一律从 Agent Card `supportedInterfaces[].url` 取。
2. **OpenClaw 无流式** —— 若驱动只做 SSE 流式，OpenClaw 会挂死；必须双路径（§6）。
3. **DB CHECK 约束** —— 只改 schema 不生效，需重建表或移除 CHECK（§9）。
4. **认证形态** —— OpenClaw 用 outbound token、Hermes 用 bearer token，但两者都是 `Authorization: Bearer`，统一走 `auth.type='token'` 即可；连接表单需标注"OpenClaw 填 outbound token / Hermes 填 peer token"。
5. **能力同步是语义盲区** —— A2A 的 `skills` 是声明不是文件，UI 若误引导用户"推送 skill"会 404/unsupported，必须显式屏蔽。
6. **taskId 缺失下的 stopSession** —— A2A 无"按 contextId 取消"，需在 sendMessage 时记录最近 `taskId`，stopSession 才有对象可 cancel。

---

## 附录：实测 Agent Card 原始响应（节选，供实现比对）

```jsonc
// OpenClaw (http://127.0.0.1:18789/.well-known/agent-card.json)
{"name":"OpenClaw","description":"OpenClaw agent gateway using the Agent2Agent protocol.",
 "supportedInterfaces":[{"url":"http://192.168.123.101:18789/a2a/v1",
   "protocolBinding":"JSONRPC","protocolVersion":"1.0"}],
 "version":"2026.8.2","capabilities":{"streaming":false,"pushNotifications":false},
 "defaultInputModes":["text/plain"],"defaultOutputModes":["text/plain"],
 "skills":[{"id":"main","name":"main",...}]}

// Hermes (http://127.0.0.1:9900/.well-known/agent-card.json)
{"name":"hermes-wangxuan-20aseb3","description":"Hermes Agent — a general-purpose agent reachable over A2A.",
 "supportedInterfaces":[{"url":"http://127.0.0.1:9900/","protocolBinding":"JSONRPC","protocolVersion":"1.0"}],
 "capabilities":{"streaming":true,"pushNotifications":true,"stateTransitionHistory":false,"extendedAgentCard":false},
 "skills":[{"id":"toolset.a2a",...},{"id":"toolset.browser",...},{"id":"toolset.browser-cdp",...}]}
```

---

## 13. 实现状态（2026-09-04）

已落地并通过真实端点 E2E。代码改动：

| 文件 | 改动 |
|---|---|
| `server/src/adapters/a2a.ts` | **新增**，~525 行纯 `fetch` + JSON-RPC。Agent Card 自动发现、`rewriteHost` 跨机修正、双路径取文本（统一走 `SendMessage`，SSE 不作为文本通道）、`GetTask` 轮询、`unsupported` 语义 |
| `server/src/types.ts` | `AgentKind` + `sourceKind` 加 `'a2a'` |
| `server/src/routes/connections.ts` | zod `kind` enum 加 `'a2a'` |
| `server/src/index.ts` | `registerDriver(a2aDriver)` |
| `server/src/db/migrations.ts` | **新增** `migrateDropKindCheck()`：幂等重建 `connections` 表移除 kind CHECK（先 `PRAGMA foreign_keys=OFF`，带行数校验 + `foreign_key_check`） |
| `server/src/db/index.ts` | 启动调用 `migrateDropKindCheck()` |
| `server/src/db/schema.ts` | `kind` 列去掉 CHECK 约束（新建库即新 schema） |
| `web/src/stores/connections.ts` | `kind` union 加 `'a2a'`；分组加 a2a 桶 |
| `web/src/style.css` | `.kind-a2a` 徽标配色 |
| `web/src/pages/ConnectionsPage.vue` | 向导加 A2A 选项 + 地址/认证提示文案 |
| `web/src/pages/CapabilitiesPage.vue` | 远端为 a2a 时禁用「导入到本地」按钮（skills 是声明非文件） |

### 13.1 实测修正（与原设计稿的差异，已写入代码注释）

1. **JSON-RPC 路径不可硬编码** — OpenClaw `/a2a/v1`、Hermes `/`，一律取 Agent Card `supportedInterfaces[].url`（含 `rewriteHost` 跨机修正：card 里常是 `127.0.0.1`，需换回用户填的 host）。
2. **Hermes 的 SSE 不吐文本** — 虽声明 `streaming:true`，实测 `SendStreamingMessage` 只发状态事件。故**取文本统一走同步 `SendMessage`**（Hermes 同步返回带 `artifacts[].parts[].text`；OpenClaw 同）。设计稿 §6 的「Hermes 走流式」路径降级为不依赖流式，驱动对两端行为一致。
3. **文本提取优先级**：`task.artifacts[].parts[].text` → `task.status.message.parts[].text` → `history` 末条 agent 消息。Hermes 对部分超短 prompt（如「reply pong」）会返回空文本，换正常 prompt（如「3+4=?」）即正常返回「7」，属对端行为非适配器问题。
4. **TaskState 实测带 `TASK_STATE_` 前缀** — 归一处理 `completed` / `task_state_completed` 等多种形态。
5. **OpenClaw 网关（`:18789` systemd user 服务）此前未运行**，本次验证前已 `systemctl --user start openclaw-gateway` 拉起。拉起后完整 BFF E2E 跑通（建连接→会话→发「3+4=?」→ 远端回复 **"7"** → 能力编目返回 `autocli` skill），与 Hermes 同构验证成立。

### 13.2 验证记录

- `npx vitest run`：**155 单测全过**（未引入回归）
- `npm -w web run build`：前端构建通过
- `npm -w server run build`：后端 tsc 构建通过（既有代码残留 tsc 报错与本改动无关）
- **BFF E2E**（起真实服务 → 101 两个端点均跑通）：
  - **Hermes (`:9900`)**：`POST /api/connections`(kind=a2a,token) → 建会话 → 发「3+4=?」→ **远端回复 "7"** ✅ → 能力编目返回 `skills[]` ✅
  - **OpenClaw (`:18789`)**：`POST /api/connections`(kind=a2a,token) → status `connected` → 建会话 → 发「3+4=?」→ **远端回复 "7"** ✅ → 能力编目返回 `autocli` skill ✅
  - 两个冒烟连接均删除 → 清理无残留
- **原始问题「能用 A2A 接入这 2 个智能体么」→ 已实证回答：能，两个都通**（统一 `a2a` 驱动，各填地址+token 即可）
- DB 迁移：`kind CHECK` 已移除、`foreign_key_check` 通过、业务数据零丢失

