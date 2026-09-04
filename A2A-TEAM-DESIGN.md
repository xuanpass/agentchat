# A2A 团队编排设计

## 目标
让 OpenClaw + Hermes 在 BFF 协作下完成多步骤任务（lead → worker → reviewer 流水线）。

## 新增 API

### 1. POST /api/teams/:id/broadcast
团队广播：lead 发送消息，所有 worker 异步响应，结果聚合返回。
- 请求: `{ message: string, role?: 'lead' }`
- 响应: `{ traceId, results: [{ connectionId, role, response, timestamp }] }`
- 实现：遍历 members（排除 lead），对每个 worker 调 driver.sendMessage，收集 response

### 2. POST /api/teams/:id/orchestrate
编排模式：lead 接收用户请求，依次调用 worker → reviewer。
- 请求: `{ prompt: string, steps: [{ role: 'worker'|'reviewer', connectionId: string, promptTemplate: string }] }`
- 响应: `{ traceId, chain: [{ step, connectionId, role, input, output, timestamp }] }`
- 实现：串行调用每个 step，上一步输出作为下一步输入（promptTemplate 支持 {{previous}} 占位符）

### 3. GET /api/teams/:id/collab-history
查看团队的协作历史记录。
- 响应: `{ runs: [{ id, type: 'broadcast'|'orchestrate', prompt, results, timestamp }] }`

## DB 变更
新增 `team_collab_runs` 表（可选，默认存内存 + SQLite WAL）：
```sql
CREATE TABLE IF NOT EXISTS team_collab_runs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  type TEXT NOT NULL CHECK(type IN ('broadcast', 'orchestrate')),
  prompt TEXT NOT NULL,
  results TEXT NOT NULL,  -- JSON array of {role, connectionId, response}
  created_at INTEGER NOT NULL
);
```

## 前端变更
TeamsPage.vue 新增两个按钮：
- 「广播消息」→ 弹出 modal，输入 message，发送到所有 worker
- 「编排协作」→ 弹出 modal，选择 worker + 输入 prompt，按流水线执行

## 实现顺序
1. 后端：team_collab_runs 表 + broadcast/orchestrate 路由
2. 前端：广播/编排 modal
3. E2E 测试
