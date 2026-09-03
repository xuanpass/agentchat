<template>
  <div class="plugin-market-page">
    <h1>插件市场 2.0</h1>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <input v-model="searchQuery" @input="debounceSearch" placeholder="搜索插件..." class="search-input" />
      <select v-model="filterType">
        <option value="">全部类型</option>
        <option value="skill">技能</option>
        <option value="plugin">插件</option>
        <option value="mcp">MCP</option>
      </select>
      <select v-model="sortBy">
        <option value="created">最新</option>
        <option value="rating">评分</option>
        <option value="name">名称</option>
      </select>
    </div>

    <!-- 热门插件 -->
    <div v-if="popular.length > 0" class="card">
      <h3>🔥 热门插件</h3>
      <div class="popular-list">
        <div v-for="p in popular" :key="p.id" class="popular-item" @click="viewPlugin(p)">
          <span class="pop-name">{{ p.name }}</span>
          <span class="pop-rating">⭐ {{ p.avg_rating?.toFixed(1) }} ({{ p.review_count }})</span>
        </div>
      </div>
    </div>

    <!-- 插件列表 -->
    <div class="card">
      <h3>全部插件 ({{ plugins.length }})</h3>
      <div v-if="plugins.length === 0" class="empty-sm">暂无插件</div>
      <div v-else class="plugin-grid">
        <div v-for="p in plugins" :key="p.id" class="plugin-card">
          <div class="plugin-header">
            <span class="plugin-name">{{ p.name }}</span>
            <span :class="['badge', 'type-' + p.type]">{{ p.type }}</span>
          </div>
          <div class="plugin-meta">
            <span>v{{ p.version || '1.0.0' }}</span>
            <span>{{ formatSize(p.sizeBytes) }}</span>
            <span v-if="p.avgRating > 0">⭐ {{ p.avgRating.toFixed(1) }} ({{ p.reviewCount }})</span>
          </div>
          <div class="plugin-actions">
            <button @click="viewPlugin(p)" class="secondary small">详情</button>
            <button @click="showReviewModal(p)" class="small">评分</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 插件详情 Modal -->
    <div v-if="selectedPlugin" class="modal-overlay" @click.self="selectedPlugin = null">
      <div class="modal wide">
        <h2>{{ selectedPlugin.name }}</h2>
        <div class="detail-row"><strong>类型:</strong> {{ selectedPlugin.type }}</div>
        <div class="detail-row"><strong>版本:</strong> {{ selectedPlugin.version || '1.0.0' }}</div>
        <div class="detail-row"><strong>大小:</strong> {{ formatSize(selectedPlugin.sizeBytes) }}</div>
        <div class="detail-row"><strong>评分:</strong> ⭐ {{ selectedPlugin.avgRating?.toFixed(1) || '-' }} ({{ selectedPlugin.reviewCount || 0 }} 评论)</div>

        <!-- 依赖检查 -->
        <h3 style="margin-top: 16px;">依赖</h3>
        <div v-if="depsLoading" class="empty-sm">检查中...</div>
        <div v-else-if="deps.length === 0" class="empty-sm">无依赖</div>
        <div v-else>
          <div v-for="d in deps" :key="d.dependsOn" class="dep-item" :class="{ satisfied: d.satisfied }">
            <span>{{ d.installed?.name || d.dependsOn }}</span>
            <span :class="['badge', d.satisfied ? 'ok' : 'crit']">{{ d.satisfied ? '✓' : '✗' }}</span>
          </div>
        </div>

        <!-- 评论 -->
        <h3 style="margin-top: 16px;">评论</h3>
        <div v-if="reviews.length === 0" class="empty-sm">暂无评论</div>
        <div v-else class="review-list">
          <div v-for="r in reviews" :key="r.id" class="review-item">
            <div class="review-header">
              <span class="review-rating">{{ '⭐'.repeat(r.rating) }}</span>
              <span class="review-user">{{ r.user_id }}</span>
            </div>
            <div class="review-comment">{{ r.comment || '无评论' }}</div>
          </div>
        </div>

        <div class="form-actions">
          <button @click="selectedPlugin = null" class="secondary">关闭</button>
        </div>
      </div>
    </div>

    <!-- 评分 Modal -->
    <div v-if="showReview" class="modal-overlay" @click.self="showReview = false">
      <div class="modal">
        <h2>为 {{ reviewingPlugin?.name }} 评分</h2>
        <div class="form-row">
          <label>评分</label>
          <div class="rating-input">
            <span v-for="n in 5" :key="n" class="star" :class="{ active: n <= reviewForm.rating }" @click="reviewForm.rating = n">⭐</span>
          </div>
        </div>
        <div class="form-row">
          <label>评论</label>
          <textarea v-model="reviewForm.comment" rows="3" placeholder="可选"></textarea>
        </div>
        <div class="form-actions">
          <button @click="submitReview" :disabled="!reviewForm.rating">提交</button>
          <button @click="showReview = false" class="secondary">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';

const plugins = ref<any[]>([]);
const popular = ref<any[]>([]);
const searchQuery = ref('');
const filterType = ref('');
const sortBy = ref('created');
const selectedPlugin = ref<any>(null);
const showReview = ref(false);
const reviewingPlugin = ref<any>(null);
const deps = ref<any[]>([]);
const depsLoading = ref(false);
const reviews = ref<any[]>([]);
const reviewForm = ref({ rating: 5, comment: '' });
let searchTimer: any = null;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

async function loadPlugins() {
  const params = new URLSearchParams();
  if (searchQuery.value) params.set('q', searchQuery.value);
  if (filterType.value) params.set('type', filterType.value);
  if (sortBy.value) params.set('sort', sortBy.value);
  plugins.value = await api.get<any[]>(`/api/plugins/search?${params}`);
}

async function loadPopular() {
  popular.value = await api.get<any[]>('/api/plugins/popular');
}

function debounceSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(loadPlugins, 300);
}

function viewPlugin(p: any) {
  selectedPlugin.value = p;
  loadDeps(p.id);
  loadReviews(p.id);
}

async function loadDeps(id: string) {
  depsLoading.value = true;
  try {
    const result = await api.get<any>(`/api/plugin-dependencies/check?capabilityId=${id}`);
    deps.value = result.dependencies || [];
  } catch { deps.value = []; }
  depsLoading.value = false;
}

async function loadReviews(id: string) {
  reviews.value = await api.get<any[]>(`/api/plugin-reviews?capabilityId=${id}`);
}

function showReviewModal(p: any) {
  reviewingPlugin.value = p;
  reviewForm.value = { rating: 5, comment: '' };
  showReview.value = true;
}

async function submitReview() {
  await api.post('/api/plugin-reviews', {
    capabilityId: reviewingPlugin.value.id,
    rating: reviewForm.value.rating,
    comment: reviewForm.value.comment,
  });
  showReview.value = false;
  if (selectedPlugin.value) loadReviews(selectedPlugin.value.id);
}

onMounted(() => { loadPlugins(); loadPopular(); });
</script>

<style scoped>
.plugin-market-page { max-width: 960px; }
.search-bar { display: flex; gap: 8px; margin-bottom: 16px; }
.search-input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.search-bar select { padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
.card { background: var(--surface); border-radius: 8px; border: 1px solid var(--border); padding: 16px; margin-bottom: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; }
.popular-list { display: flex; gap: 8px; flex-wrap: wrap; }
.popular-item { padding: 6px 12px; background: var(--bg); border-radius: 6px; cursor: pointer; display: flex; gap: 6px; align-items: center; font-size: 12px; border: 1px solid var(--border); transition: all 0.2s; }
.popular-item:hover { border-color: var(--accent); }
.pop-name { font-weight: 600; }
.pop-rating { color: var(--text-muted); }
.plugin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.plugin-card { padding: 14px; background: var(--bg); border-radius: 8px; border: 1px solid var(--border); }
.plugin-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.plugin-name { font-weight: 600; font-size: 13px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.badge.type-skill { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.badge.type-plugin { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
.badge.type-mcp { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.ok { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.crit { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
.plugin-meta { display: flex; gap: 10px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
.plugin-actions { display: flex; gap: 6px; }
.empty-sm { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); max-height: 80vh; overflow-y: auto; }
.modal.wide { width: 560px; }
.modal h2 { margin: 0 0 16px; font-size: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.form-row textarea { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); box-sizing: border-box; resize: vertical; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }
.detail-row { margin-bottom: 6px; font-size: 13px; }

.dep-item { display: flex; justify-content: space-between; padding: 6px 8px; background: var(--bg); border-radius: 4px; margin-bottom: 4px; font-size: 12px; }
.dep-item:not(.satisfied) { border: 1px solid rgba(239, 68, 68, 0.3); }

.review-list { display: flex; flex-direction: column; gap: 8px; }
.review-item { padding: 10px; background: var(--bg); border-radius: 6px; }
.review-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
.review-rating { font-size: 12px; }
.review-user { font-size: 11px; color: var(--text-muted); }
.review-comment { font-size: 12px; }

.rating-input { display: flex; gap: 4px; }
.star { font-size: 24px; cursor: pointer; opacity: 0.3; transition: opacity 0.2s; }
.star.active { opacity: 1; }
</style>
