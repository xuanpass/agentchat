path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# Fix 6: Error response format (anchor changed after Fix 5)
edits.append((
    '**流式约定**: `/sessions/:id/stream` 为 Server-Sent Events(事件 schema 见 §5.2)。消息发送走 `POST /sessions/:id/message`',
    """**统一错误响应**: 所有 API 错误返回统一 schema, 前端据此做 toast / retry / 错误边界:

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

**流式约定**: `/sessions/:id/stream` 为 Server-Sent Events(事件 schema 见 §5.2)。消息发送走 `POST /sessions/:id/message`"""
))

# Fix 9: Directory structure (correct indentation)
edits.append((
    '│   │   ├── sync-engine/        # enum/diff/transfer/verify/rollback\n│   │   ├── bridge/             # 异构流 → 统一 SSE 事件\n│   │   ├── crypto.ts           # 凭据加密\n│   │   └── db/                 # SQLite schema + migration',
    '│   │   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + StreamBridge\n│   │   ├── services/           # ConnectionManager / SyncEngine\n│   │   ├── bridge/             # 异构流 → 统一 SSE 事件 (StreamBridge 基类 + 各适配器实现)\n│   │   ├── crypto.ts           # 凭据加密\n│   │   └── db/                 # SQLite schema + migration'
))

# Fix 10: Web directory (correct indentation)
edits.append((
    '│   │   ├── pages/              # Connections/Teams/Sessions/Capabilities\n│   │   ├── components/         # UnifiedStream/ToolCallCard/ConnWizard/SyncConsole...',
    '│   │   ├── pages/              # Connections/Teams/Sessions/Capabilities/Projects\n│   │   ├── components/         # UnifiedStream/ToolCallCard/ConnWizard/SyncConsole...'
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
