path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

checks = [
    ('CapabilityFlags defined', 'interface CapabilityFlags' in content),
    ('TeamCapability model', 'interface TeamCapability' in content),
    ('SyncEngine interface', 'interface SyncEngine' in content),
    ('Notification channel', 'GET /api/notifications' in content),
    ('Stream recovery', 'Last-Event-ID' in content),
    ('Graceful shutdown', 'Graceful Shutdown' in content),
    ('Audit event catalog', 'audit_log' in content),
    ('GET /sessions/:id', 'sessions/:id` | 获取单个会话' in content or 'sessions/:id` |' in content),
    ('Server push events', 'connection.status' in content),
    ('SyncEngine state machine', 'pending → running → done' in content),
    ('Team capability workflow', 'scope' in content),
    ('NotificationBus', 'NotificationBus' in content),
]

ok = sum(1 for _, v in checks if v)
print(f'New architectural checks: {ok}/{len(checks)}')
for name, v in checks:
    mark = '[OK]' if v else '[FAIL]'
    print(f'  {mark} {name}')

# Check heading structure
import re
print('\n=== Section 5 heading structure ===')
for i, l in enumerate(content.split('\n')):
    if re(r'^#{2,4} 5\.', l):
        print(f'{i+1}: {l[:120]}')
