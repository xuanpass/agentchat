path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Check all skill market additions
checks = [
    ('SkillMarketEntry model', 'interface SkillMarketEntry' in content),
    ('SkillMarketService interface', 'interface SkillMarketService' in content),
    ('Claw123Adapter interface', 'interface Claw123Adapter' in content),
    ('§5.6 Skill Market section', '### 5.6 技能市场集成' in content),
    ('API /api/skill-market/skills', '/api/skill-market/skills' in content),
    ('API /api/skill-market/refresh', '/api/skill-market/refresh' in content),
    ('API /api/skill-market/categories', '/api/skill-market/categories' in content),
    ('API import endpoint', 'skill-market/skills/:id/import' in content),
    ('Frontend skill market sidebar', '技能市场 (SkillMarket)' in content),
    ('Frontend skill market page desc', '技能市场页' in content),
    ('Directory claw123.ts', 'claw123.ts' in content),
    ('Directory SkillMarketService', 'SkillMarketService' in content),
    ('Milestone M5.5', 'M5.5 技能市场' in content),
    ('SkillMarketEntry §4.10', '### 4.10 技能市场条目' in content),
    ('Import flow', 'importSkill' in content),
    ('Cache strategy', 'TTL 24h' in content),
    ('CapabilityFlags defined', 'interface CapabilityFlags' in content),
    ('§5.7 Graceful Shutdown', '### 5.7 优雅关闭与恢复' in content),
    ('§5.8 Consistency', '### 5.8 同步一致性与竞态' in content),
]

ok = sum(1 for _, v in checks if v)
print(f'Skill market checks: {ok}/{len(checks)}')
for name, v in checks:
    mark = '[OK]' if v else '[FAIL]'
    print(f'  {mark} {name}')

# Check heading structure
import re
print('\n=== Key headings ===')
for i, l in enumerate(content.split('\n')):
    if re.match(r'^#{2,4} (4|5)\.', l) and ('4.10' in l or '5.6' in l or '5.7' in l or '5.8' in l):
        print(f'{i+1}: {l[:120]}')

print(f'\nDocument: {len(content)} chars, {content.count(chr(10))} lines')
