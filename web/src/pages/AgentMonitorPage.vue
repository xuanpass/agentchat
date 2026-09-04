<template>
  <div class="agent-monitor-page">
    <h1>智能体监控</h1>

    <!-- 总览 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总指标数</div>
        <div class="stat-value">{{ dashboard.overview?.totalMetrics ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">近5分钟</div>
        <div class="stat-value">{{ dashboard.overview?.recent5min ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃连接</div>
        <div class="stat-value">{{ dashboard.overview?.activeConnections ?? 0 }}</div>
      </div>
    </div>

    <!-- 实时指标 -->
    <div class="card">
      <h3>实时指标 (近5分钟)</h3>
      <div v-if="!dashboard.recent?.length" class="empty-sm">暂无数据</div>
      <div v-else class="metrics-grid">
        <div v-for="m in dashboard.recent" :key="m.metric_type" class="metric-card">
          <div class="metric-type">{{ metricLabel(m.metric_type) }}</div>
          <div class="metric-value">{{ formatValue(m.metric_type, m.avg) }}</div>
          <div class="metric-range">↑{{ formatValue(m.metric_type, m.max) }} ↓{{ formatValue(m.metric_type, m.min) }}</div>
          <div class="metric-count">{{ m.count }} 样本</div>
        </div>
      </div>
    </div>

    <!-- 连接器健康 -->
    <div class="card">
      <h3>连接器健康</h3>
      <div v-if="!dashboard.byConnection?.length" class="empty-sm">暂无数据</div>
      <table v-else class="data-table">
        <thead><tr><th>连接</th><th>错误率</th><th>延迟</th><th>吞吐量</th><th>最后活跃</th></tr></thead>
        <tbody>
          <tr v-for="c in dashboard.byConnection" :key="c.connection_id">
            <td class="mono">{{ c.connection_id?.slice(0, 12) ?? '-' }}...</td>
            <td><span :class="['badge', (c.error_rate || 0) > 5 ? 'crit' : 'ok']">{{ (c.error_rate || 0).toFixed(1) }}%</span></td>
            <td>{{ (c.avg_latency || 0).toFixed(0) }}ms</td>
            <td>{{ (c.throughput || 0).toFixed(1) }}/s</td>
            <td>{{ c.last_seen ? formatTs(c.last_seen) : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 趋势图 -->
    <div class="card">
      <h3>1小时趋势</h3>
      <div v-if="!dashboard.hourlyTrend?.length" class="empty-sm">暂无数据</div>
      <div v-else class="trend-chart">
        <div v-for="t in trendByType" :key="t.type" class="trend-row">
          <span class="trend-label">{{ metricLabel(t.type) }}</span>
          <div class="trend-bars">
            <div v-for="(v, i) in t.values" :key="i" class="trend-bar" :style="{ height: t.max > 0 ? (v / t.max * 60) + 4 : 4 + 'px' }"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模拟数据按钮 -->
    <div class="toolbar">
      <button @click="generateMockData">📊 生成模拟数据</button>
      <button @click="loadDashboard">刷新</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../api/client';

const dashboard = ref<any>({});

const trendByType = computed(() => {
  const trend = dashboard.value.hourlyTrend || [];
  const types = [...new Set(trend.map((t: any) => t.metric_type))];
  return types.map((type: unknown) => {
    const t = type as string;
    const points = trend.filter((pt: any) => pt.metric_type === t);
    const values = points.map((p: any) => p.avg);
    return { type: t, values, max: Math.max(...values, 1) };
  });
});

function metricLabel(type: string): string {
  return { latency: '延迟', throughput: '吞吐量', error_rate: '错误率', token_rate: 'Token速率', queue_depth: '队列深度', active_tasks: '活跃任务' }[type] || type;
}

function formatValue(type: string, val: number): string {
  if (val == null) return '-';
  if (type === 'latency') return val.toFixed(0) + 'ms';
  if (type === 'error_rate') return val.toFixed(1) + '%';
  if (type === 'throughput') return val.toFixed(1) + '/s';
  if (type === 'token_rate') return val.toFixed(0) + '/s';
  return val.toFixed(1);
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function loadDashboard() {
  dashboard.value = await api.get('/agent-metrics/dashboard');
}

async function generateMockData() {
  const types = ['latency', 'throughput', 'error_rate', 'token_rate', 'queue_depth', 'active_tasks'];
  const now = Date.now();
  const metrics = [];
  for (let i = 0; i < 60; i++) {
    for (const type of types) {
      let val = 0;
      if (type === 'latency') val = 200 + Math.random() * 800;
      else if (type === 'throughput') val = 5 + Math.random() * 20;
      else if (type === 'error_rate') val = Math.random() * 8;
      else if (type === 'token_rate') val = 100 + Math.random() * 500;
      else if (type === 'queue_depth') val = Math.floor(Math.random() * 10);
      else if (type === 'active_tasks') val = Math.floor(Math.random() * 5);
      metrics.push({ metricType: type, value: val, labels: {}, timestamp: now - i * 60000 });
    }
  }
  await api.post('/agent-metrics/batch', { metrics });
  await loadDashboard();
}

onMounted(loadDashboard);
</script>

<style scoped>
.agent-monitor-page { max-width: 960px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; padding: 14px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
.stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
.card { background: var(--surface); border-radius: 8px; border: 1px solid var(--border); padding: 16px; margin-bottom: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.metric-card { padding: 12px; background: var(--bg); border-radius: 8px; border: 1px solid var(--border); text-align: center; }
.metric-type { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.metric-value { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.metric-range { font-size: 10px; color: var(--text-muted); }
.metric-count { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
.empty-sm { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }
.mono { font-family: monospace; font-size: 11px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.badge.ok { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.crit { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
.data-table th { color: var(--text-muted); font-weight: 600; font-size: 11px; }

.trend-chart { display: flex; flex-direction: column; gap: 12px; }
.trend-row { display: flex; align-items: center; gap: 12px; }
.trend-label { width: 80px; font-size: 12px; color: var(--text-muted); text-align: right; }
.trend-bars { display: flex; align-items: flex-end; gap: 2px; height: 64px; flex: 1; }
.trend-bar { width: 6px; min-height: 4px; background: var(--accent); border-radius: 1px; transition: height 0.3s; }
</style>
