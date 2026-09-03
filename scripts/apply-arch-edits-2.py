path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# ── Fix 1: CapabilityFlags (corrected anchor) ──
edits.append((
    '  lastSeenAt?: number;\n  createdAt: number; updatedAt: number;\n}\n```\n\n### 4.2 团队 (Team)',
    '''  lastSeenAt?: number;
  createdAt: number; updatedAt: number;
}
```

/** 能力标志位(§4.1 AgentConnection.capabilities / §4.7 HealthProbe.capabilities 复用) */
interface CapabilityFlags {
  sessions: boolean; teams: boolean;
  skills: boolean; plugins: boolean; mcp: boolean; streaming: boolean;
}

### 4.2 团队 (Team)'''
))

# ── Fix 2: SyncEngine (corrected MCP anchor) ──
edits.append((
    '> **MCP 共享特殊说明**: MCP 服务器定义可能含密钥(如 command + env)。设计上**仅同步不含密钥的"骨架配置"**, 密钥由目标侧通过环境变量引用, 避免跨主机泄露敏感。这必须在 UI 中明示。',
    '''> **MCP 共享特殊说明**: MCP 服务器定义可能含密钥(如 command + env)。设计上**仅同步不含密钥的"骨架配置"**, 密钥由目标侧通过环境变量引用, 避免跨主机泄露敏感。这必须在 UI 中明示。

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

applied = 0
for old, new in edits:
    if old in content:
        content = content.replace(old, new, 1)
        applied += 1
    else:
        print(f"MISS: {old[:60]}")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Applied {applied}/{len(edits)} remaining edits")
