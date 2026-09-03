import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';

interface SkillMarketEntry {
  id: string;
  source: string;
  name: string;
  descriptionZh: string;
  description?: string;
  categoryZh: string;
  url: string;
  imported: boolean;
  capabilityId?: string;
  cachedAt: number;
}

const MARKET_SKILLS: Array<Omit<SkillMarketEntry, 'imported' | 'capabilityId'>> = [
  { id: 'autocli', source: 'builtin', name: 'autocli', descriptionZh: '55+ 社交/内容网站自动化操作', categoryZh: '自动化', url: '', cachedAt: Date.now() },
  { id: 'docx', source: 'builtin', name: 'docx', descriptionZh: 'Word 文档创建/编辑/转换', categoryZh: '文档处理', url: '', cachedAt: Date.now() },
  { id: 'pdf', source: 'builtin', name: 'pdf', descriptionZh: 'PDF 读取/OCR/编辑/翻译', categoryZh: '文档处理', url: '', cachedAt: Date.now() },
  { id: 'xlsx', source: 'builtin', name: 'xlsx', descriptionZh: 'Excel 创建/编辑/分析/公式', categoryZh: '文档处理', url: '', cachedAt: Date.now() },
  { id: 'powerpoint-editor', source: 'builtin', name: 'powerpoint', descriptionZh: 'PPT 创建/编辑/修复/导出', categoryZh: '文档处理', url: '', cachedAt: Date.now() },
  { id: 'github-operations', source: 'builtin', name: 'github', descriptionZh: 'GitHub 仓库/Issue/PR 管理', categoryZh: '开发工具', url: '', cachedAt: Date.now() },
  { id: 'stock-data-pro', source: 'builtin', name: 'stock-data-pro', descriptionZh: 'A股/港股/美股数据查询', categoryZh: '金融数据', url: '', cachedAt: Date.now() },
  { id: 'tongdaxin', source: 'builtin', name: 'tongdaxin', descriptionZh: '通达信 MCP 指标/选股', categoryZh: '金融数据', url: '', cachedAt: Date.now() },
  { id: 'iwencai', source: 'builtin', name: 'iwencai', descriptionZh: '同花顺问财智能选股', categoryZh: '金融数据', url: '', cachedAt: Date.now() },
  { id: 'eastmoney-operations', source: 'builtin', name: 'eastmoney', descriptionZh: '东方财富资讯/选股/模拟交易', categoryZh: '金融数据', url: '', cachedAt: Date.now() },
  { id: 'tts-asr', source: 'builtin', name: 'tts-asr', descriptionZh: '文字转语音 / 语音识别', categoryZh: 'AI 能力', url: '', cachedAt: Date.now() },
  { id: 'video-gen', source: 'builtin', name: 'video-gen', descriptionZh: 'AI 视频生成与成片制作', categoryZh: 'AI 能力', url: '', cachedAt: Date.now() },
  { id: 'image-gen', source: 'builtin', name: 'image-gen', descriptionZh: 'AI 图片生成/编辑', categoryZh: 'AI 能力', url: '', cachedAt: Date.now() },
  { id: 'frontend-design-fusion', source: 'builtin', name: 'frontend-design', descriptionZh: '前端 UI/原型生成', categoryZh: '开发工具', url: '', cachedAt: Date.now() },
  { id: 'karpathy-llm-wiki', source: 'builtin', name: 'llm-wiki', descriptionZh: 'LLM 知识库管理', categoryZh: '知识管理', url: '', cachedAt: Date.now() },
  { id: 'ima-skill', source: 'builtin', name: 'ima-skill', descriptionZh: 'IME 知识库/笔记操作', categoryZh: '知识管理', url: '', cachedAt: Date.now() },
  { id: 'browser-tool', source: 'builtin', name: 'browser', descriptionZh: '浏览器自动化(Chrome/Edge)', categoryZh: '自动化', url: '', cachedAt: Date.now() },
  { id: 'web-extract', source: 'builtin', name: 'web-extract', descriptionZh: '60+ 站点零风险数据抓取', categoryZh: '自动化', url: '', cachedAt: Date.now() },
  { id: 'deep-research', source: 'builtin', name: 'deep-research', descriptionZh: '多源深度研究报告', categoryZh: 'AI 能力', url: '', cachedAt: Date.now() },
  { id: 'find-skills', source: 'builtin', name: 'find-skills', descriptionZh: '技能发现与安装', categoryZh: '系统', url: '', cachedAt: Date.now() },
];

function getImportedIds(): Set<string> {
  try {
    const rows = getDb().prepare('SELECT id FROM capabilities').all() as any[];
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

export async function skillMarketRoutes(app: FastifyInstance) {
  app.get('/skill-market/skills', async function handler(req) {
    const query = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(query.size) || 20));
    const q = (query.q || '').trim();
    const cat = query.categoryZh || '全部';

    const importedIds = getImportedIds();
    let filtered = MARKET_SKILLS.map((s) => ({
      ...s,
      imported: importedIds.has(s.id),
      capabilityId: importedIds.has(s.id) ? s.id : undefined,
    }));

    if (cat !== '全部') {
      filtered = filtered.filter((s) => s.categoryZh === cat);
    }
    if (q) {
      const lower = q.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(lower) || (s.descriptionZh || '').toLowerCase().includes(lower)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * size;
    const items = filtered.slice(start, start + size);

    return { items, total, cachedAt: Date.now() };
  });

  app.get('/skill-market/categories', async function handler() {
    const map = new Map<string, number>();
    for (const s of MARKET_SKILLS) {
      map.set(s.categoryZh, (map.get(s.categoryZh) || 0) + 1);
    }
    const entries: Array<{ name: string; count: number }> = [];
    map.forEach((count, name) => entries.push({ name, count }));
    return [{ name: '全部', count: MARKET_SKILLS.length }, ...entries];
  });

  app.post('/skill-market/refresh', async function handler() {
    return { ok: true, cachedAt: Date.now() };
  });

  app.post('/skill-market/skills/:id/import', async function handler(req, reply) {
    const params = req.params as { id: string };
    const skill = MARKET_SKILLS.find((s) => s.id === params.id);
    if (!skill) return reply.code(404).send({ error: '技能不存在' });

    const importedIds = getImportedIds();
    if (importedIds.has(skill.id)) return reply.code(409).send({ error: '已导入' });

    getDb().prepare(
      `INSERT INTO capabilities (id, type, name, version, source_kind, payload, checksum, size_bytes, installed_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum`
    ).run(
      skill.id, 'skill', skill.name, null, 'local',
      JSON.stringify({ kind: 'file', content: '# ' + skill.name + '\n\n' + skill.descriptionZh }),
      'chk-' + Date.now(), skill.descriptionZh.length, '[]', Date.now()
    );

    return reply.code(201).send({ id: skill.id, name: skill.name, ok: true });
  });
}
