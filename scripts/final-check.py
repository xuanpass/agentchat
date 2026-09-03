import re

with open(r'D:\工程\agent-ops-console\ARCHITECTURE.md', 'r', encoding='utf-8') as f:
    content = f.read()

gaps = [
    ('SessionCreateOpts defined', 'interface SessionCreateOpts' in content),
    ('StreamHandle defined', 'interface StreamHandle' in content),
    ('HealthProbe defined', 'interface HealthProbe' in content),
    ('SyncResult defined', 'interface SyncResult' in content),
    ('CapabilityMeta defined', 'interface CapabilityMeta' in content),
    ('DiffResult defined', 'interface DiffResult' in content),
    ('POST /sessions/:id/message', 'sessions/:id/message' in content),
    ('node:sqlite', 'node:sqlite' in content),
    ('AgentConnection timestamps', 'createdAt: number; updatedAt: number;' in content),
    ('Error response format', '统一错误响应' in content),
    ('Bridge details', 'Bridge)如何处理异构流' in content),
    ('Config reference', '### 6.1 配置参考' in content),
    ('Directory structure updated', 'ConnectionManager / SyncEngine' in content),
    ('E2E flow diagrams', '端到端数据流' in content),
    ('Team context template', '## Team Context' in content),
    ('Conflict resolution', '冲突解决' in content),
    ('Frontend states', '前端状态指引' in content),
]

ok = sum(1 for _, v in gaps if v)
print(f'Gaps addressed: {ok}/{len(gaps)}')
for name, v in gaps:
    mark = '[OK]' if v else '[FAIL]'
    print(f'  {mark} {name}')

# Check section references
refs = re.findall(r'§(\d+\.\d+)', content)
missing = []
for r in set(refs):
    if f'### {r} ' not in content and f'## {r} ' not in content and f'#### {r} ' not in content:
        missing.append(r)
if missing:
    print(f'\nUnresolved section references: {missing}')
else:
    print('\nAll section references resolve')

# Check no remaining better-sqlite3
if 'better-sqlite3' in content:
    print('  [WARN] Still mentions better-sqlite3')
else:
    print('[OK] better-sqlite3 fully replaced')

print(f'\nFinal document: {len(content)} chars, {content.count(chr(10))} lines')
