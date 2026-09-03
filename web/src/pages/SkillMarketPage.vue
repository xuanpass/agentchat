<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">技能市场</h1>
      <div class="header-actions">
        <span class="cache-info" v-if="cachedAt">缓存 {{ formatTime(cachedAt) }}</span>
        <button class="btn" @click="refresh" :disabled="loading">
          {{ loading ? '刷新中...' : '↻ 刷新' }}
        </button>
      </div>
    </div>

    <!-- 搜索 + 分类 -->
    <div class="market-toolbar">
      <input
        v-model="query"
        class="search-input"
        placeholder="🔍 搜索技能名称或描述..."
        @input="onSearch"
      />
      <div class="category-tabs">
        <button
          v-for="cat in categories"
          :key="cat.name"
          class="cat-tab"
          :class="{ active: activeCategory === cat.name }"
          @click="activeCategory = cat.name"
        >
          {{ cat.name }} <span class="cat-count">{{ cat.count }}</span>
        </button>
      </div>
    </div>

    <!-- 加载态 -->
    <div v-if="loading && items.length === 0" class="empty">加载中...</div>

    <!-- 空态 -->
    <div v-else-if="items.length === 0" class="empty">
      <div class="empty-icon">🔍</div>
      <div>没有找到匹配的技能</div>
    </div>

    <!-- 技能网格 -->
    <div v-else class="skill-grid">
      <div v-for="s in items" :key="s.id" class="card skill-card">
        <div class="skill-head">
          <span class="skill-name">{{ s.name }}</span>
          <span class="skill-category">{{ s.categoryZh }}</span>
        </div>
        <div class="skill-desc">{{ s.descriptionZh || s.description || '暂无描述' }}</div>
        <div class="skill-actions">
          <button class="btn btn-sm" @click="showDetail(s)">详情</button>
          <button
            v-if="!s.imported"
            class="btn btn-sm btn-primary"
            @click="importSkill(s)"
            :disabled="importingId === s.id"
          >
            {{ importingId === s.id ? '导入中...' : '导入' }}
          </button>
          <span v-else class="imported-badge">✓ 已导入</span>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > size" class="pagination">
      <button class="btn btn-sm" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="page-info">第 {{ page }} 页 / 共 {{ Math.ceil(total / size) }} 页 ({{ total }})</span>
      <button class="btn btn-sm" :disabled="page * size >= total" @click="page++">下一页</button>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="detailItem" class="modal-overlay" @click.self="detailItem = null">
      <div class="card modal modal-large">
        <h2>{{ detailItem.name }}</h2>
        <div class="detail-row"><label>分类</label><span>{{ detailItem.categoryZh }}</span></div>
        <div class="detail-row"><label>来源</label><span>{{ detailItem.source }}</span></div>
        <div class="detail-row"><label>描述</label><p class="detail-desc">{{ detailItem.descriptionZh || detailItem.description || '暂无描述' }}</p></div>
        <div class="detail-row" v-if="detailItem.url"><label>源地址</label><a :href="detailItem.url" target="_blank" class="detail-link">{{ detailItem.url }}</a></div>
        <div class="modal-actions">
          <button class="btn" @click="detailItem = null">关闭</button>
          <button
            v-if="!detailItem.imported"
            class="btn btn-primary"
            @click="importSkill(detailItem)"
            :disabled="importingId === detailItem.id"
          >
            {{ importingId === detailItem.id ? '导入中...' : '导入到本地能力库' }}
          </button>
          <span v-else class="imported-badge">✓ 已导入</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();

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

const items = ref<SkillMarketEntry[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const query = ref('');
const activeCategory = ref('全部');
const loading = ref(false);
const cachedAt = ref<number | null>(null);
const importingId = ref<string | null>(null);
const detailItem = ref<SkillMarketEntry | null>(null);

let searchTimer: any = null;

const filteredItems = computed(() => {
  let result = items.value;
  if (activeCategory.value !== '全部') {
    result = result.filter((s) => s.categoryZh === activeCategory.value);
  }
  if (query.value.trim()) {
    const q = query.value.toLowerCase();
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.descriptionZh?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q)
    );
  }
  return result;
});

async function fetchSkills() {
  loading.value = true;
  try {
    const res = await api.get<{ items: SkillMarketEntry[]; total: number; cachedAt: number }>(
      `/api/skill-market/skills?page=${page.value}&size=${size.value}&q=${encodeURIComponent(query.value)}&categoryZh=${encodeURIComponent(activeCategory.value)}`
    );
    items.value = res.items;
    total.value = res.total;
    cachedAt.value = res.cachedAt;
  } catch (e: any) {
    console.error('获取技能市场失败:', e);
  } finally {
    loading.value = false;
  }
}

async function fetchCategories() {
  try {
    categories.value = await api.get<{ name: string; count: number }[]>('/skill-market/categories');
  } catch (e) {
    console.error('获取分类失败:', e);
  }
}

function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page.value = 1; fetchSkills(); }, 300);
}

async function refresh() {
  loading.value = true;
  try {
    await api.post('/skill-market/refresh', {});
    await Promise.all([fetchSkills(), fetchCategories()]);
  } catch (e) {
    console.error('刷新失败:', e);
  } finally {
    loading.value = false;
  }
}

function showDetail(s: SkillMarketEntry) {
  detailItem.value = s;
}

async function importSkill(s: SkillMarketEntry) {
  importingId.value = s.id;
  try {
    const cap = await api.post<any>('/skill-market/skills/' + s.id + '/import', {});
    s.imported = true;
    s.capabilityId = cap.id;
    if (detailItem.value?.id === s.id) detailItem.value.imported = true;
    toast.success(`已导入: ${s.name}`);
  } catch (e: any) {
    toast.error(`导入失败: ${e.message}`);
  } finally {
    importingId.value = null;
  }
}

function formatTime(ts: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString();
}

watch([page, activeCategory], () => fetchSkills());

onMounted(() => {
  fetchSkills();
  fetchCategories();
});
</script>

<style scoped>
.header-actions { display: flex; align-items: center; gap: 12px; }
.cache-info { font-size: 12px; color: var(--text-muted); }

.market-toolbar { margin-bottom: 16px; }
.search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 12px;
}
.search-input:focus { outline: none; border-color: var(--accent); }

.category-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.cat-tab {
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.cat-tab:hover { border-color: var(--accent); color: var(--accent); }
.cat-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.cat-count { opacity: 0.6; font-size: 11px; }

.skill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.skill-card { padding: 14px; display: flex; flex-direction: column; }
.skill-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.skill-name { font-weight: 600; font-size: 14px; }
.skill-category { font-size: 11px; background: var(--accent-light); color: var(--accent); padding: 1px 8px; border-radius: 10px; white-space: nowrap; }
.skill-desc { color: var(--text-muted); font-size: 13px; line-height: 1.5; margin-bottom: 12px; flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.skill-actions { display: flex; gap: 6px; align-items: center; }
.imported-badge { font-size: 12px; color: var(--green); font-weight: 500; }

.pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 24px; }
.page-info { font-size: 13px; color: var(--text-muted); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 480px; padding: 24px; }
.modal-large { width: 600px; max-height: 80vh; overflow-y: auto; }
.modal h2 { margin-bottom: 16px; font-size: 18px; }
.detail-row { margin-bottom: 12px; }
.detail-row label { display: block; font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; }
.detail-desc { line-height: 1.6; font-size: 13px; }
.detail-link { font-size: 12px; word-break: break-all; color: var(--accent); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; align-items: center; }
</style>
