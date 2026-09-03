path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# ── Fix 1: Add SkillMarketEntry (corrected anchor, no --- before ### 4.6) ──
edits.append((
    '> 关系: `Team 1 ── N TeamCapability ── N Capability`。\n\n### 4.6 项目 (Project)',
    '''> 关系: `Team 1 ── N TeamCapability ── N Capability`。

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

### 4.6 项目 (Project)'''
))

# ── Fix 2: Directory structure (corrected anchors) ──
# Remove old duplicate adapters line
edits.append((
    '│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + 契约\n',
    ''
))

# Update services to include SkillMarketService
edits.append((
    '│   ├── services/           # ConnectionManager / SyncEngine\n',
    '│   ├── services/           # ConnectionManager / SyncEngine / SkillMarketService\n'
))

# Update adapters line to include claw123
edits.append((
    '│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + StreamBridge\n',
    '│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + claw123.ts(技能市场)\n'
))

# ── Fix 3: Add Claw123Adapter to API table note ──
# (Already done in first script - /api/skill-market/* endpoints)

applied = 0
misses = []
for old, new in edits:
    if old in content:
        content = content.replace(old, new, 1)
        applied += 1
    else:
        misses.append(old[:80])

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Applied {applied}/{len(edits)} remaining edits")
if misses:
    print("\nMISSES:")
    for m in misses:
        print(f"  - {repr(m[:80])}")
