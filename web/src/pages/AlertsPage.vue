<template>
  <div>
    <h1>告警中心</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总告警</div>
        <div class="stat-value">{{ stats.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未确认</div>
        <div class="stat-value warn">{{ stats.unacknowledged ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">严重</div>
        <div class="stat-value crit">{{ criticalCount }}</div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <select v-model="filterSeverity">
        <option value="">全部级别</option>
        <option value="info">信息</option>
        <option value="warning">警告</option>
        <option value="critical">严重</option>
      </select>
      <select v-model="filterAck">
        <option value="">全部状态</option>
        <option value="0">未确认</option>
        <option value="1">已确认</option>
      </select>
      <button @click="acknowledgeAll" :disabled="!hasUnack">确认全部</button>
      <button @click="cleanupAck">清理已确认</button>
      <button @click="loadAlerts">刷新</button>
    </div>

    <!-- 告警列表 -->
    <div v-if="loading" class="skeleton">加载中...</div>
    <div v-else-if="alerts.length === 0" class="empty">
      <p>暂无告警</p>
    </div>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>级别</th>
          <th>类型</th>
          <th>消息</th>
          <th>来源</th>
          <th>时间</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in alerts" :key="a.id" :class="{ unack: !a.acknowledged }">
          <td>
            <span :class="['badge', 'sev-' + a.severity]">{{ sevLabel(a.severity) }}</span>
          </td>
          <td>{{ a.type }}</td>
          <td class="msg-cell">{{ a.message }}</td>
          <td>{{ a.source_type ?? '-' }}</td>
          <td>{{ formatTs(a.created_at) }}</td>
          <td>
            <span :class="['badge', a.acknowledged ? 'acked' : 'unacked']">
              {{ a.acknowledged ? '已确认' : '未确认' }}
            </span>
          </td>
          <td>
            <button v-if="!a.acknowledged" @click="ack(a.id)">确认</button>
            <button @click="del(a.id)" class="danger">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '../api/client';
const alerts = ref<any[]>([]);
const stats = ref<any>({});
const loading = ref(false);
const filterSeverity = ref('');
const filterAck = ref('');

const hasUnack = computed(() => alerts.value.some(a => !a.acknowledged));
const criticalCount = computed(() => alerts.value.filter(a => a.severity === 'critical').length);

async function loadAlerts() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filterSeverity.value) params.set('severity', filterSeverity.value);
    if (filterAck.value !== '') params.set('acknowledged', filterAck.value);
    const res = await api.get('/alerts?' + params.toString());
    alerts.value = Array.isArray(res) ? res : [];
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

async function loadStats() {
  try { stats.value = await api.get('/alerts/stats'); } catch {}
}

function sevLabel(s: string) {
  return { info: '信息', warning: '警告', critical: '严重' }[s] ?? s;
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

async function ack(id: string) {
  await api.patch(`/alerts/${id}`, { acknowledged: true });
  loadAlerts();
  loadStats();
}

async function acknowledgeAll() {
  await api.post('/alerts/acknowledge-all', { severity: filterSeverity.value || undefined });
  loadAlerts();
  loadStats();
}

async function del(id: string) {
  await api.delete(`/alerts/${id}`);
  loadAlerts();
  loadStats();
}

async function cleanupAck() {
  await api.delete('/alerts?olderThanDays=7');
  loadAlerts();
  loadStats();
}

// 自动刷新
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  loadAlerts();
  loadStats();
  timer = setInterval(() => { loadAlerts(); loadStats(); }, 15000);
});

// 监听筛选
watch([filterSeverity, filterAck], () => { loadAlerts(); });
</script>

<style scoped>
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 20px; min-width: 120px;
}
.stat-label { font-size: 12px; color: var(--text-dim); }
.stat-value { font-size: 24px; font-weight: 700; }
.stat-value.warn { color: var(--warn); }
.stat-value.crit { color: var(--danger); }

.toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar select, .toolbar button {
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 12px; cursor: pointer;
}
.toolbar button:hover { background: var(--surface-hover); }
.toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }

.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td {
  padding: 8px 12px; text-align: left;
  border-bottom: 1px solid var(--border); font-size: 13px;
}
.data-table th { color: var(--text-dim); font-weight: 600; }
.data-table tr.unack { background: rgba(255, 180, 0, 0.04); }
.msg-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600;
}
.sev-info { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.sev-warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.sev-critical { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.acked { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
.unacked { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }

.empty { text-align: center; padding: 40px; color: var(--text-dim); }
.skeleton { padding: 20px; color: var(--text-dim); }
button.danger { color: var(--danger); margin-left: 4px; }
</style>
