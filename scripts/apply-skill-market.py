path = r'D:\工程\agent-ops-console\ARCHITECTURE.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

edits = []

# ═══════════════════════════════════════════
# 1. Add SkillMarketEntry data model (§4.10)
# ═══════════════════════════════════════════
edits.append((
    '''> 关系: `Team 1 ── N TeamCapability ── N Capability`。

---

### 4.6 项目 (Project) —— 远程工作目录绑定''',
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

### 4.6 项目 (Project) —— 远程工作目录绑定'''
))

# ═══════════════════════════════════════════
# 2. Add §5.8 Skill Market Integration
# ═══════════════════════════════════════════
edits.append((
    '''### 5.6 优雅关闭与恢复 (Graceful Shutdown)''',
    '''### 5.6 技能市场集成 (Skill Market Integration)

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

### 5.7 优雅关闭与恢复 (Graceful Shutdown)'''
))

# Fix §5.6 reference in the old consistency section to §5.7
edits.append((
    '''### 5.7 同步一致性与竞态 (Consistency)''',
    '''### 5.8 同步一致性与竞态 (Consistency)'''
))

# Also fix references to §5.6/§5.7 in text
edits.append((
    '见 §5.6.2',
    '见 §5.8.2'
))

# ═══════════════════════════════════════════
# 3. Add skill-market API endpoints to §6.2
# ═══════════════════════════════════════════
edits.append((
    '| `GET` | `/health` | 框架健康检查 |',
    '| `GET` | `/health` | 框架健康检查 |\n| `GET` | `/api/skill-market/skills` | 技能市场列表(搜索/分类/分页, query: q/categoryZh/page/size) |\n| `GET` | `/api/skill-market/skills/:id` | 技能详情 |\n| `POST` | `/api/skill-market/skills/:id/import` | 导入技能到本地能力仓库 |\n| `POST` | `/api/skill-market/refresh` | 强制刷新市场缓存 |\n| `GET` | `/api/skill-market/categories` | 分类列表(含技能计数) |'
))

# ═══════════════════════════════════════════
# 4. Update frontend design §8.1
# ═══════════════════════════════════════════

# Update sidebar to include skill market
edits.append((
    '''│   └── 项目   (Projects)       — 远程工作目录绑定管理(新建会话时选项目, §4.6)
└── 顶部全局状态条(连接健康轮询 /api/health + 进行中同步任务 + 断开提示)''',
    '''│   └── 项目   (Projects)       — 远程工作目录绑定管理(新建会话时选项目, §4.6)
│   └── 技能市场 (SkillMarket)   — Claw123 技能浏览/搜索/导入(§5.6)
└── 顶部全局状态条(连接健康轮询 /api/health + 进行中同步任务 + 断开提示)'''
))

# Add skill market page description
edits.append((
    '''- **能力库页**: 三 Tab(技能/插件/MCP)。''',
    '''- **技能市场页**: 左分类导航(32 分类) + 顶搜索框 + 技能卡片网格; 点击卡片展开详情弹窗(描述/来源/分类) + 「导入」按钮; 导入后该技能出现在能力库页, 可经同步引擎推送到目标智能体。顶部显示缓存时间 + 强制刷新按钮。
- **能力库页**: 三 Tab(技能/插件/MCP)。'''
))

# Update page count references from 五个 to 六个
edits.append((
    '五个功能页(智能体/团队/会话/能力库/项目)',
    '六个功能页(智能体/团队/会话/能力库/项目/技能市场)'
))

edits.append((
    '路由 | Vue Router(五个页面)',
    '路由 | Vue Router(六个页面)'
))

# ═══════════════════════════════════════════
# 5. Update directory structure §9
# ═══════════════════════════════════════════
edits.append((
    '│   ├── services/           # ConnectionManager / SyncEngine\n│   ├── bridge/             # 异构流 → 统一 SSE 事件 (StreamBridge 基类 + 各适配器实现)',
    '│   ├── services/           # ConnectionManager / SyncEngine / SkillMarketService\n│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + claw123.ts(技能市场)\n│   ├── bridge/             # 异构流 → 统一 SSE 事件 (StreamBridge 基类 + 各适配器实现)'
))

# Remove duplicate adapters line
edits.append((
    '│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + 契约\n│   ├── adapters/           # openclaw.ts / hermes.ts / opencode.ts + claw123.ts(技能市场)',
    ''
))

# Update web pages directory
edits.append((
    '│   ├── pages/              # Connections/Teams/Sessions/Capabilities/Projects',
    '│   ├── pages/              # Connections/Teams/Sessions/Capabilities/Projects/SkillMarket'
))

# ═══════════════════════════════════════════
# 6. Add milestone for skill market
# ═══════════════════════════════════════════
edits.append((
    '| **M5 能力同步** | 技能/插件/MCP 同步引擎 + 能力库页 | 双向推拉 diff 展示 + 回滚 |',
    '| **M5 能力同步** | 技能/插件/MCP 同步引擎 + 能力库页 | 双向推拉 diff 展示 + 回滚 |\n| **M5.5 技能市场** | Claw123 集成 + 技能市场页 | 浏览/搜索/导入技能到本地能力仓库 |'
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
