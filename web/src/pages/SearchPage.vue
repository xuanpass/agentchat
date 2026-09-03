<template>
  <div class="search-page">
    <div class="page-header">
      <h1 class="page-title">搜索</h1>
    </div>

    <!-- 搜索输入框 -->
    <div class="search-input-bar">
      <span class="search-icon">⌕</span>
      <input
        v-model="inputQuery"
        @keydown.enter="doSearch"
        placeholder="搜索会话、消息、能力... (Enter 搜索)"
        class="search-input-large"
        ref="searchInput"
      />
      <button class="btn btn-primary" @click="doSearch" :disabled="!inputQuery.trim()">搜索</button>
    </div>

    <!-- 搜索历史 -->
    <div v-if="searchHistory.length > 0 && !results && !loading" class="search-history">
      <div class="history-header">
        <span>最近搜索</span>
        <button class="btn btn-sm" @click="clearHistory">清除</button>
      </div>
      <div class="history-tags">
        <span v-for="(h, i) in searchHistory" :key="i" class="history-tag" @click="inputQuery = h; doSearch()">
          {{ h }}
        </span>
      </div>
    </div>

    <SkeletonScreen v-if="loading" type="lines" :count="5" />
    <div v-else-if="!results" class="empty"><div class="empty-icon">⌕</div><div>输入关键词开始搜索</div></div>
    <div v-else-if="totalCount === 0" class="empty"><div class="empty-icon">◇</div><div>无匹配结果</div><div style="margin-top:8px;font-size:13px">尝试其他关键词</div></div>

    <div v-else class="search-results">
      <!-- 会话结果 -->
      <div v-if="results.sessions?.length" class="search-section">
        <h2 class="section-title">会话 ({{ results.sessions.length }})</h2>
        <div class="card result-card" v-for="r in results.sessions" :key="r.id" @click="goToSession(r.id)">
          <div class="result-icon">◆</div>
          <div class="result-info">
            <div class="result-name">{{ r.title }}</div>
            <div class="result-meta">{{ r.status }} · {{ formatTime(r.lastActiveAt) }}</div>
          </div>
        </div>
      </div>

      <!-- 消息结果 -->
      <div v-if="results.messages?.length" class="search-section">
        <h2 class="section-title">消息 ({{ results.messages.length }})</h2>
        <div class="card result-card" v-for="(r, i) in results.messages" :key="i" @click="goToSession(r.sessionId)">
          <div class="result-icon">💬</div>
          <div class="result-info">
            <div class="result-name">{{ r.sessionTitle }}</div>
            <div class="result-snippet" v-html="highlightSnippet(r.snippet, query)"></div>
            <div class="result-meta">{{ r.role }} · {{ formatTime(r.timestamp) }}</div>
          </div>
        </div>
      </div>

      <!-- 能力结果 -->
      <div v-if="results.capabilities?.length" class="search-section">
        <h2 class="section-title">能力 ({{ results.capabilities.length }})</h2>
        <div class="card result-card" v-for="r in results.capabilities" :key="r.id" @click="goToCapabilities">
          <div class="result-icon">⬡</div>
          <div class="result-info">
            <div class="result-name">{{ r.name }}</div>
            <div class="result-meta">{{ r.capType }} · {{ r.sourceKind }}<span v-if="r.version"> · v{{ r.version }}</span></div>
          </div>
        </div>
      </div>

      <!-- 实例结果 -->
      <div v-if="results.connections?.length" class="search-section">
        <h2 class="section-title">实例 ({{ results.connections.length }})</h2>
        <div class="card result-card" v-for="r in results.connections" :key="r.id" @click="goToConnections">
          <div class="result-icon">◈</div>
          <div class="result-info">
            <div class="result-name">{{ r.name }}</div>
            <div class="result-meta">{{ r.kind }} · {{ r.status }}</div>
          </div>
        </div>
      </div>

      <!-- 团队结果 -->
      <div v-if="results.teams?.length" class="search-section">
        <h2 class="section-title">团队 ({{ results.teams.length }})</h2>
        <div class="card result-card" v-for="r in results.teams" :key="r.id" @click="goToTeams">
          <div class="result-icon">⬢</div>
          <div class="result-info">
            <div class="result-name">{{ r.name }}</div>
            <div class="result-meta">{{ r.description }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import SkeletonScreen from '../components/SkeletonScreen.vue';

const router = useRouter();
const query = ref('');
const inputQuery = ref('');
const loading = ref(false);
const results = ref<any>(null);
const searchInput = ref<HTMLElement>();
const searchHistory = ref<string[]>([]);

const HISTORY_KEY = 'aoc-search-history';
const MAX_HISTORY = 8;

function loadHistory() {
  try {
    searchHistory.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { searchHistory.value = []; }
}

function saveHistory(q: string) {
  if (!q.trim()) return;
  const filtered = searchHistory.value.filter((h) => h !== q);
  searchHistory.value = [q, ...filtered].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value));
}

function clearHistory() {
  searchHistory.value = [];
  localStorage.removeItem(HISTORY_KEY);
}

function highlightSnippet(snippet: string, q: string): string {
  if (!q || !snippet) return escapeHtml(snippet);
  const escaped = escapeHtml(snippet);
  const escapedQ = escapeHtml(q);
  const idx = escaped.toLowerCase().indexOf(escapedQ.toLowerCase());
  if (idx === -1) return escaped;
  return escaped.slice(0, idx) +
    '<mark>' + escaped.slice(idx, idx + escapedQ.length) + '</mark>' +
    escaped.slice(idx + escapedQ.length);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

const totalCount = computed(() => {
  if (!results.value) return 0;
  const r = results.value;
  return (r.sessions?.length || 0) + (r.messages?.length || 0) + (r.capabilities?.length || 0) + (r.connections?.length || 0) + (r.teams?.length || 0);
});

async function doSearch() {
  const q = inputQuery.value.trim();
  if (!q) return;
  query.value = q;
  saveHistory(q);
  loading.value = true;
  try {
    const result = await api.get<any>(`/search?q=${encodeURIComponent(q)}`);
    results.value = result.results;
  } catch (e) {
    console.error('Search failed:', e);
    results.value = null;
  } finally {
    loading.value = false;
  }
}

function goToSession(id: string) { router.push(`/sessions?id=${id}`); }
function goToCapabilities() { router.push('/capabilities'); }
function goToConnections() { router.push('/connections'); }
function goToTeams() { router.push('/teams'); }

function formatTime(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString();
}

onMounted(() => {
  loadHistory();
  nextTick(() => (searchInput.value as HTMLInputElement)?.focus());
});
</script>

<style scoped>
.search-page { display: flex; flex-direction: column; gap: 16px; }

/* ── 搜索输入 ── */
.search-input-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color var(--transition);
}

.search-input-bar:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.search-icon { font-size: 18px; color: var(--text-dim); flex-shrink: 0; }

.search-input-large {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 15px;
  color: var(--text);
  outline: none;
  padding: 0;
}

.search-input-large::placeholder { color: var(--text-dim); }

/* ── 搜索历史 ── */
.search-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
}

.history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.history-tag {
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition);
}

.history-tag:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}

/* ── 搜索结果 ── */
.search-results { display: flex; flex-direction: column; gap: 20px; }
.search-section { display: flex; flex-direction: column; gap: 8px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }

.result-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  transition: all var(--transition);
}

.result-card:hover { border-color: var(--accent); background: var(--surface-hover); }

.result-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  background: var(--accent-light);
  color: var(--accent);
  flex-shrink: 0;
}

.result-info { flex: 1; min-width: 0; }
.result-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-snippet { font-size: 12px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-snippet :deep(mark) { background: var(--accent-light); color: var(--accent); padding: 0 2px; border-radius: 2px; }
.result-meta { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
</style>
