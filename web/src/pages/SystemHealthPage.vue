<template>
  <div class="system-health-page">
    <h1>系统健康中心</h1>

    <!-- 整体状态 -->
    <div class="overall-health" :class="`health-${health.overall}`">
      <div class="health-icon">{{ overallIcon }}</div>
      <div class="health-info">
        <div class="health-status">{{ overallLabel }}</div>
        <div class="health-ts">检查时间: {{ formatTs(health.timestamp) }}</div>
      </div>
      <button @click="load" class="btn-refresh">↻</button>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">数据库状态</div>
        <div class="stat-value" :class="health.database?.status === 'healthy' ? 'text-ok' : 'text-danger'">
          {{ health.database?.status === 'healthy' ? '✓' : '✕' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">连接在线</div>
        <div class="stat-value">{{ health.connections?.connected ?? 0 }}/{{ health.connections?.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">DB 表数</div>
        <div class="stat-value">{{ health.database?.tableCount ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">运行时间</div>
        <div class="stat-value">{{ formatUptime(health.uptime) }}</div>
      </div>
    </div>

    <!-- 连接健康 -->
    <div class="card">
      <h3>连接健康</h3>
      <div v-if="!health.connections?.details?.length" class="empty-sm">暂无连接</div>
      <table v-else class="data-table">
        <thead><tr><th>连接</th><th>类型</th><th>状态</th><th>健康</th><th>最后活跃</th></tr></thead>
        <tbody>
          <tr v-for="c in health.connections.details" :key="c.id">
            <td>{{ c.name }}</td>
            <td><span class="badge">{{ c.kind }}</span></td>
            <td><span :class="['badge', c.status === 'connected' ? 'ok' : 'warn']">{{ c.status }}</span></td>
            <td>
              <span :class="['health-dot', `dot-${c.health}`]"></span>
              {{ c.health }}
            </td>
            <td>{{ c.last_seen_at ? formatTs(c.last_seen_at) : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 数据库表 -->
    <div class="card">
      <h3>数据库表 ({{ health.database?.tableCount ?? 0 }})</h3>
      <div v-if="!health.database?.tableSizes" class="empty-sm">无数据</div>
      <div v-else class="table-sizes">
        <div v-for="(count, name) in health.database.tableSizes" :key="name" class="table-size-item">
          <span class="table-name">{{ name }}</span>
          <span class="table-count">{{ count.toLocaleString() }} 行</span>
        </div>
      </div>
    </div>

    <!-- 服务统计 -->
    <div class="card">
      <h3>服务统计</h3>
      <div v-if="!health.services" class="empty-sm">无数据</div>
      <div v-else class="service-grid">
        <div class="service-card">
          <div class="service-title">会话</div>
          <div class="service-row"><span>总计</span><strong>{{ health.services.sessions?.total ?? 0 }}</strong></div>
          <div class="service-row"><span>活跃(1h)</span><strong>{{ health.services.sessions?.active ?? 0 }}</strong></div>
        </div>
        <div class="service-card">
          <div class="service-title">运行</div>
          <div class="service-row"><span>总计</span><strong>{{ health.services.runs?.total ?? 0 }}</strong></div>
          <div class="service-row"><span>运行中</span><strong>{{ health.services.runs?.running ?? 0 }}</strong></div>
          <div class="service-row"><span>失败(24h)</span><strong class="text-danger">{{ health.services.runs?.failed24h ?? 0 }}</strong></div>
        </div>
        <div class="service-card">
          <div class="service-title">告警</div>
          <div class="service-row"><span>总计</span><strong>{{ health.services.alerts?.total ?? 0 }}</strong></div>
          <div class="service-row"><span>未确认</span><strong class="text-warn">{{ health.services.alerts?.unacked ?? 0 }}</strong></div>
        </div>
        <div class="service-card">
          <div class="service-title">审计</div>
          <div class="service-row"><span>总计</span><strong>{{ health.services.audit?.total ?? 0 }}</strong></div>
          <div class="service-row"><span>24h</span><strong>{{ health.services.audit?.recent24h ?? 0 }}</strong></div>
        </div>
      </div>
    </div>

    <!-- 内存使用 -->
    <div class="card">
      <h3>进程内存</h3>
      <div v-if="!health.memory" class="empty-sm">无数据</div>
      <div v-else class="memory-grid">
        <div class="memory-item"><span class="mem-label">RSS</span><span class="mem-value">{{ formatBytes(health.memory.rss) }}</span></div>
        <div class="memory-item"><span class="mem-label">堆总计</span><span class="mem-value">{{ formatBytes(health.memory.heapTotal) }}</span></div>
        <div class="memory-item"><span class="mem-label">堆已用</span><span class="mem-value">{{ formatBytes(health.memory.heapUsed) }}</span></div>
        <div class="memory-item"><span class="mem-label">外部</span><span class="mem-value">{{ formatBytes(health.memory.external) }}</span></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../api/client';

const health = ref<any>({});

const overallIcon = computed(() => {
  const s = health.value.overall;
  if (s === 'healthy') return '✅';
  if (s === 'degraded') return '⚠️';
  return '❌';
});

const overallLabel = computed(() => {
  const s = health.value.overall;
  if (s === 'healthy') return '系统运行正常';
  if (s === 'degraded') return '部分服务降级';
  return '系统异常';
});

async function load() {
  try {
    health.value = await api.get('/system-health');
  } catch { /* ignore */ }
}

function formatTs(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

function formatUptime(seconds: number) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

onMounted(load);
</script>

<style scoped>
.overall-health { display: flex; align-items: center; gap: 16px; padding: 20px; border-radius: 8px; margin-bottom: 16px; }
.overall-health.health-healthy { background: var(--success-bg); border: 1px solid var(--success); }
.overall-health.health-degraded { background: var(--warning-bg); border: 1px solid var(--warning); }
.overall-health.health-critical { background: var(--danger-bg); border: 1px solid var(--danger); }
.health-icon { font-size: 36px; }
.health-info { flex: 1; }
.health-status { font-size: 18px; font-weight: 600; }
.health-ts { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.btn-refresh { padding: 6px 14px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); cursor: pointer; }
.text-ok { color: var(--success); }
.text-danger { color: var(--danger); }
.text-warn { color: var(--warning); }
.health-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.dot-healthy { background: var(--success); }
.dot-unhealthy { background: var(--danger); }
.dot-unknown { background: var(--text-muted); }
.table-sizes { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.table-size-item { display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface); border-radius: 4px; }
.table-name { font-family: monospace; font-size: 12px; }
.table-count { font-size: 12px; color: var(--text-muted); }
.service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.service-card { padding: 14px; background: var(--surface); border-radius: 6px; border: 1px solid var(--border); }
.service-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-muted); }
.service-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.memory-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.memory-item { display: flex; flex-direction: column; padding: 12px; background: var(--surface); border-radius: 6px; }
.mem-label { font-size: 11px; color: var(--text-muted); }
.mem-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
</style>
