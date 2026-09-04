<template>
  <div class="audit-page">
    <div class="page-header">
      <h1 class="page-title">审计日志</h1>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-mini">
        <span class="stat-num">{{ stats.total ?? 0 }}</span>
        <span class="stat-label">总记录</span>
      </div>
      <div class="stat-mini">
        <span class="stat-num">{{ stats.recent24h ?? 0 }}</span>
        <span class="stat-label">24h 内</span>
      </div>
      <div class="stat-mini" v-for="a in stats.byAction ?? []" :key="a.action">
        <span class="stat-num">{{ a.count }}</span>
        <span class="stat-label">{{ actionLabel(a.action) }}</span>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <button
        v-for="f in actionFilters" :key="f.value"
        class="filter-chip"
        :class="{ active: filterAction === f.value }"
        @click="filterAction = f.value; fetchLogs()"
      >{{ f.label }}</button>
    </div>

    <!-- 日志列表 -->
    <SkeletonScreen v-if="loading" type="lines" :count="8" />
    <div v-else-if="logs.length === 0" class="empty">
      <div class="empty-icon">📋</div>
      <div>暂无审计记录</div>
      <div style="margin-top:8px;font-size:13px">系统会自动记录所有创建、更新、删除操作</div>
    </div>

    <div v-else class="audit-list">
      <div v-for="log in logs" :key="log.id" class="audit-item" @click="showDetail(log)">
        <span class="audit-action" :class="`act-${log.action}`">{{ actionLabel(log.action) }}</span>
        <span class="audit-target">{{ log.targetType }}{{ log.targetId ? ' · ' + log.targetId.slice(0, 10) : '' }}</span>
        <span class="audit-time">{{ formatTime(log.ts) }}</span>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="hasMore && !loading" class="load-more">
      <button class="btn" @click="loadMore">加载更多</button>
    </div>

    <!-- 详情 Modal -->
    <div v-if="selectedLog" class="modal-overlay" @click.self="selectedLog = null">
      <div class="card modal">
        <h2>审计详情</h2>
        <div class="detail-grid">
          <div class="detail-item"><label>ID</label><span>{{ selectedLog.id }}</span></div>
          <div class="detail-item"><label>操作</label><span class="audit-action" :class="`act-${selectedLog.action}`">{{ actionLabel(selectedLog.action) }}</span></div>
          <div class="detail-item"><label>目标类型</label><span>{{ selectedLog.targetType ?? '-' }}</span></div>
          <div class="detail-item"><label>目标 ID</label><span class="mono">{{ selectedLog.targetId ?? '-' }}</span></div>
          <div class="detail-item"><label>时间</label><span>{{ formatTime(selectedLog.ts) }}</span></div>
          <div class="detail-item"><label>操作者</label><span>{{ selectedLog.actor }}</span></div>
        </div>
        <div class="detail-section" v-if="selectedLog.detail">
          <label>详情 (JSON)</label>
          <pre class="detail-json">{{ JSON.stringify(selectedLog.detail, null, 2) }}</pre>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="selectedLog = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { api } from '../api/client';
import SkeletonScreen from '../components/SkeletonScreen.vue';

const loading = ref(false);
const logs = ref<any[]>([]);
const stats = ref<any>({});
const filterAction = ref('');
const selectedLog = ref<any>(null);
const offset = ref(0);
const hasMore = ref(false);
const PAGE_SIZE = 50;

const actionFilters = [
  { value: '', label: '全部' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'sync', label: '同步' },
];

async function fetchLogs() {
  loading.value = true;
  offset.value = 0;
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' });
    if (filterAction.value) params.set('action', filterAction.value);
    const data = await api.get(`/audit?${params}`);
    logs.value = data as any[];
    hasMore.value = (data as any[]).length >= PAGE_SIZE;
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  offset.value += PAGE_SIZE;
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset.value) });
  if (filterAction.value) params.set('action', filterAction.value);
  const data = await api.get<any[]>(`/audit?${params}`);
  logs.value = [...logs.value, ...(data as any[])];
  hasMore.value = (data as any[]).length >= PAGE_SIZE;
}

async function fetchStats() {
  try {
    stats.value = await api.get('/audit/stats');
  } catch { /* ignore */ }
}

function showDetail(log: any) {
  selectedLog.value = log;
}

function actionLabel(a: string) {
  const map: Record<string, string> = {
    create: '创建', update: '更新', delete: '删除', sync: '同步',
  };
  return map[a] ?? a;
}

function formatTime(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

onMounted(() => { fetchLogs(); fetchStats(); });
</script>

<style scoped>
.audit-page { max-width: 900px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-mini { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; display: flex; flex-direction: column; align-items: center; min-width: 70px; }
.stat-num { font-size: 18px; font-weight: 700; }
.stat-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.filter-bar { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-chip { padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg); font-size: 12px; cursor: pointer; transition: all 0.2s; }
.filter-chip:hover { border-color: var(--accent); }
.filter-chip.active { background: var(--accent); color: white; border-color: var(--accent); }

.audit-list { display: flex; flex-direction: column; gap: 4px; }
.audit-item { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
.audit-item:hover { background: var(--bg); }
.audit-action { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; min-width: 40px; text-align: center; }
.act-create { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
.act-update { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.act-delete { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.act-sync { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; }
.audit-target { flex: 1; font-size: 13px; color: var(--text); }
.audit-time { font-size: 12px; color: var(--text-muted); }

.load-more { text-align: center; margin-top: 16px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 480px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.detail-item label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.detail-item .mono { font-family: monospace; font-size: 12px; }
.detail-section label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600; }
.detail-json { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
