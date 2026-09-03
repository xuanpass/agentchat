<template>
  <div class="dashboard">
    <!-- 顶部统计卡片 -->
    <div class="stats-grid stagger-children">
      <SkeletonScreen v-if="loading" type="stats" />
      <template v-else>
      <div class="stat-card" @click="router.push('/sessions')" style="cursor:pointer">
        <div class="stat-icon sessions">◆</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.sessions }}</div>
          <div class="stat-label">会话</div>
        </div>
        <div class="stat-trend" v-if="stats.sessionsToday > 0">+{{ stats.sessionsToday }} 今日</div>
      </div>
      <div class="stat-card" @click="router.push('/connections')" style="cursor:pointer">
        <div class="stat-icon connections">◈</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.connected }}/{{ stats.connections }}</div>
          <div class="stat-label">实例在线</div>
        </div>
        <div class="stat-trend" :class="stats.connected === stats.connections ? 'ok' : 'warn'">
          {{ stats.connected === stats.connections ? '全部在线' : '部分离线' }}
        </div>
      </div>
      <div class="stat-card" @click="router.push('/alerts')" style="cursor:pointer">
        <div class="stat-icon alerts">🔔</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.alerts }}</div>
          <div class="stat-label">未确认告警</div>
        </div>
        <div class="stat-trend" :class="stats.alerts > 0 ? 'warn' : 'ok'">
          {{ stats.alerts > 0 ? '需处理' : '无告警' }}
        </div>
      </div>
      <div class="stat-card" @click="router.push('/teams')" style="cursor:pointer">
        <div class="stat-icon teams">⬢</div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.teams }}</div>
          <div class="stat-label">团队</div>
        </div>
        <div class="stat-trend" v-if="stats.projects > 0">{{ stats.projects }} 项目</div>
      </div>
      </template>
    </div>

    <!-- 实时更新提示条 -->
    <div v-if="realtimeUpdates.length > 0" class="realtime-bar" @click="realtimeUpdates = []">
      <span class="realtime-dot"></span>
      <span class="realtime-text">{{ realtimeUpdates[0].message }}</span>
      <span class="realtime-count">{{ realtimeUpdates.length }}</span>
    </div>

    <!-- 主体两栏 -->
    <div v-if="!loading" class="dashboard-grid">
      <!-- 左侧: 最近会话 -->
      <div class="card panel">
        <div class="panel-header">
          <h2>最近会话</h2>
          <router-link to="/sessions" class="link">查看全部 →</router-link>
        </div>
        <div v-if="recentSessions.length === 0" class="panel-empty">暂无会话</div>
        <div v-else class="session-list">
          <div
            v-for="s in recentSessions"
            :key="s.id"
            class="session-row"
            @click="goToSession(s.id)"
          >
            <div class="session-dot" :class="`status-${s.status}`"></div>
            <div class="session-info">
              <div class="session-title">{{ s.title || '未命名会话' }}</div>
              <div class="session-meta">{{ formatTime(s.last_active_at) }}</div>
            </div>
            <div class="session-conn">{{ getConnName(s.connection_id) }}</div>
          </div>
        </div>
      </div>

      <!-- 右侧: 实例状态 + 图表 + 快捷操作 -->
      <div class="dashboard-side">
        <!-- 会话趋势图 -->
        <div class="card panel">
          <div class="panel-header">
            <h2>会话趋势</h2>
            <div class="time-range">
              <button :class="{ active: timeRange === '1h' }" @click="timeRange = '1h'">1时</button>
              <button :class="{ active: timeRange === '24h' }" @click="timeRange = '24h'">24时</button>
              <button :class="{ active: timeRange === '7d' }" @click="timeRange = '7d'">7天</button>
            </div>
          </div>
          <div class="chart-wrapper">
            <ChartWidget type="bar" :data="filteredSessionTrend" @click="onChartClick" />
          </div>
        </div>

        <!-- 能力分布 -->
        <div class="card panel">
          <div class="panel-header"><h2>能力分布</h2></div>
          <div class="chart-wrapper donut-wrapper">
            <ChartWidget type="donut" :data="capabilityDistData" center-label="能力" />
            <div class="donut-legend">
              <div v-for="(item, i) in capabilityDistData" :key="i" class="legend-item">
                <span class="legend-dot" :style="{ background: item.color }"></span>
                <span class="legend-label">{{ item.label }}</span>
                <span class="legend-count">{{ item.value }}</span>
              </div>
              <div v-if="capabilityDistData.length === 0" class="legend-empty">暂无数据</div>
            </div>
          </div>
        </div>

        <!-- 运行状态分布 -->
        <div class="card panel">
          <div class="panel-header"><h2>运行状态分布</h2><router-link to="/runs" class="link">查看全部 →</router-link></div>
          <div class="chart-wrapper donut-wrapper">
            <ChartWidget type="pie" :data="runStatusData" center-label="运行" />
            <div class="donut-legend">
              <div v-for="(item, i) in runStatusData" :key="i" class="legend-item">
                <span class="legend-dot" :style="{ background: item.color }"></span>
                <span class="legend-label">{{ item.label }}</span>
                <span class="legend-count">{{ item.value }}</span>
              </div>
              <div v-if="runStatusData.length === 0" class="legend-empty">暂无运行</div>
            </div>
          </div>
        </div>

        <!-- 审计活动热力图 -->
        <div class="card panel">
          <div class="panel-header"><h2>操作活动</h2><router-link to="/audit" class="link">审计日志 →</router-link></div>
          <div class="chart-wrapper">
            <ChartWidget type="heatmap" :data="auditHeatmapData" />
          </div>
        </div>
        <!-- 实例状态 -->
        <div class="card panel">
          <div class="panel-header">
            <h2>实例状态</h2>
            <router-link to="/connections" class="link">管理 →</router-link>
          </div>
          <div v-if="connections.length === 0" class="panel-empty">暂无实例</div>
          <div v-else class="conn-list">
            <div v-for="c in connections" :key="c.id" class="conn-row">
              <div class="conn-dot" :class="`status-${c.status}`"></div>
              <div class="conn-info">
                <div class="conn-name">{{ c.name }}</div>
                <div class="conn-kind">{{ c.kind }}</div>
              </div>
              <div class="conn-caps">
                <span v-if="c.capabilities?.sessions" class="cap-pill">会话</span>
                <span v-if="c.capabilities?.skills" class="cap-pill">技能</span>
                <span v-if="c.capabilities?.plugins" class="cap-pill">插件</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 快捷操作 -->
        <div class="card panel">
          <div class="panel-header"><h2>快捷操作</h2></div>
          <div class="quick-actions">
            <button class="qa-btn" @click="$router.push('/sessions?new=1')">
              <span class="qa-icon">◆</span>
              <span class="qa-text">
                <span class="qa-title">新建会话</span>
                <span class="qa-desc">选择一个实例开始对话</span>
              </span>
            </button>
            <button class="qa-btn" @click="$router.push('/connections?new=1')">
              <span class="qa-icon">◈</span>
              <span class="qa-text">
                <span class="qa-title">接入智能体</span>
                <span class="qa-desc">添加新的智能体实例</span>
              </span>
            </button>
            <button class="qa-btn" @click="$router.push('/capabilities')">
              <span class="qa-icon">⬡</span>
              <span class="qa-text">
                <span class="qa-title">同步能力</span>
                <span class="qa-desc">从实例导入或同步能力</span>
              </span>
            </button>
            <button class="qa-btn" @click="$router.push('/skill-market')">
              <span class="qa-icon">✦</span>
              <span class="qa-text">
                <span class="qa-title">技能市场</span>
                <span class="qa-desc">浏览和安装社区技能</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import SkeletonScreen from '../components/SkeletonScreen.vue';
import ChartWidget from '../components/ChartWidget.vue';
import { useEventSource } from '../composables/useEventSource';

const router = useRouter();
const loading = ref(true);
const sessions = ref<any[]>([]);
const connections = ref<any[]>([]);
const capabilities = ref<any[]>([]);
const teams = ref<any[]>([]);
const projects = ref<any[]>([]);
const runs = ref<any[]>([]);
const auditStats = ref<any>({});
const metricsHistory = ref<any[]>([]);
const realtimeUpdates = ref<any[]>([]); // SSE 实时更新队列

// 图表时间范围
const timeRange = ref<'7d' | '24h' | '1h'>('7d');
const chartLoading = ref(false);

// SSE 实时更新
const { onNotification } = useEventSource();
onNotification((event: any) => {
  // 连接状态变化 → 刷新连接列表
  if (event.type === 'connection.status' || event.type === 'connection.health') {
    fetchConnections();
    realtimeUpdates.value.unshift({
      type: 'connection',
      message: `${event.data?.name || '连接'}: ${event.data?.status || '更新'}`,
      ts: Date.now(),
    });
  }
  // 会话创建/删除
  if (event.type === 'session.created' || event.type === 'session.deleted') {
    fetchSessions();
    realtimeUpdates.value.unshift({
      type: 'session',
      message: event.type === 'session.created' ? `新会话: ${event.data?.title || '未命名'}` : `会话删除: ${event.data?.title || ''}`,
      ts: Date.now(),
    });
  }
  // 告警
  if (event.type === 'alert.created') {
    realtimeUpdates.value.unshift({
      type: 'alert',
      message: event.data?.message || '新告警',
      ts: Date.now(),
    });
  }
  // 保留最近 10 条
  if (realtimeUpdates.value.length > 10) {
    realtimeUpdates.value = realtimeUpdates.value.slice(0, 10);
  }
});

const stats = computed(() => ({
  sessions: sessions.value.length,
  sessionsToday: sessions.value.filter((s) => {
    const d = new Date(s.last_active_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length,
  connections: connections.value.length,
  connected: connections.value.filter((c) => c.status === 'connected').length,
  capabilities: capabilities.value.length,
  plugins: capabilities.value.filter((c) => c.type === 'plugin').length,
  teams: teams.value.length,
  projects: projects.value.length,
  runs: runs.value.length,
  alerts: realtimeUpdates.value.filter(u => u.type === 'alert').length,
}));

// ── 图表数据 ──
const sessionTrendData = computed(() => {
  // 按天统计最近 7 天的会话数
  const days: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    days[key] = 0;
  }
  for (const s of sessions.value) {
    const d = new Date(s.last_active_at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (days[key] !== undefined) days[key]++;
  }
  const colors = ['#6366f1', '#6366f1', '#6366f1', '#6366f1', '#6366f1', '#6366f1', '#22c55e'];
  return Object.entries(days).map(([label, value], i) => ({ label, value, color: colors[i] }));
});

const capabilityDistData = computed(() => {
  // 按类型统计能力分布
  const typeMap: Record<string, number> = {};
  for (const c of capabilities.value) {
    typeMap[c.type || 'other'] = (typeMap[c.type || 'other'] || 0) + 1;
  }
  return Object.entries(typeMap).map(([label, value]) => ({ label, value }));
});

// 运行状态分布
const runStatusData = computed(() => {
  const colors: Record<string, string> = {
    queued: '#9ca3af', running: '#3b82f6', done: '#22c55e', failed: '#ef4444', cancelled: '#6b7280',
  };
  const labels: Record<string, string> = {
    queued: '排队中', running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消',
  };
  const statusMap: Record<string, number> = {};
  for (const r of runs.value) {
    statusMap[r.status] = (statusMap[r.status] || 0) + 1;
  }
  return Object.entries(statusMap).map(([label, value]) => ({
    label: labels[label] || label, value, color: colors[label] || '#6366f1',
  }));
});

// 审计活动热力图 (最近 7 天)
const auditHeatmapData = computed(() => {
  const days: { label: string; value: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    days.push({ label: key, value: 0 });
  }
  // 用 byAction 数据作为总活动量
  const byAction = auditStats.value?.byAction || [];
  const totalActions = byAction.reduce((s: number, a: any) => s + (a.count || 0), 0);
  // 均匀分布作为占位 (实际应该按天查询)
  days.forEach((d, i) => {
    d.value = Math.round(totalActions / 7) + (i === 6 ? totalActions % 7 : 0);
  });
  return days;
});

const recentSessions = computed(() => sessions.value.slice(0, 6));

const connNameMap = computed(() => {
  const m: Record<string, string> = {};
  connections.value.forEach((c) => { m[c.id] = c.name; });
  return m;
});

function getConnName(id: string) {
  return connNameMap.value[id] || id?.slice(0, 8) || '—';
}

function formatTime(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString();
}

function goToSession(id: string) {
  router.push(`/sessions?id=${id}`);
}

async function fetchSessions() {
  sessions.value = await api.get<any[]>('/sessions').catch(() => []);
}

async function fetchConnections() {
  connections.value = await api.get<any[]>('/connections').catch(() => []);
}

async function fetchAll() {
  loading.value = true;
  try {
    const [s, c, cap, t, p, r, a, h] = await Promise.all([
      api.get<any[]>('/sessions'),
      api.get<any[]>('/connections'),
      api.get<any[]>('/capabilities'),
      api.get<any[]>('/teams'),
      api.get<any[]>('/projects'),
      api.get<any[]>('/runs?limit=50'),
      api.get<any>('/audit/stats').catch(() => ({})),
      api.get<any[]>('/metrics/history').catch(() => []),
    ]);
    sessions.value = s;
    connections.value = c;
    capabilities.value = cap;
    teams.value = t;
    projects.value = p;
    runs.value = r;
    auditStats.value = a;
    metricsHistory.value = h;
  } catch (e) {
    console.error('Failed to fetch dashboard data:', e);
  } finally {
    loading.value = false;
  }
}

// 图表时间范围筛选
const filteredSessionTrend = computed(() => {
  const now = Date.now();
  const rangeMs = {
    '7d': 7 * 86400000,
    '24h': 24 * 3600000,
    '1h': 3600000,
  }[timeRange.value];

  // 如果有历史数据, 用历史数据
  if (metricsHistory.value.length > 0) {
    const cutoff = now - rangeMs;
    return metricsHistory.value
      .filter(m => m.ts >= cutoff)
      .map(m => ({
        label: new Date(m.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        value: m.sessions,
        color: '#6366f1',
      }));
  }

  // 否则用当前会话数据 (按天统计)
  const days = timeRange.value === '7d' ? 7 : timeRange.value === '24h' ? 1 : 1;
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    buckets[key] = 0;
  }
  for (const s of sessions.value) {
    const d = new Date(s.last_active_at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (buckets[key] !== undefined) buckets[key]++;
  }
  return Object.entries(buckets).map(([label, value]) => ({ label, value, color: '#6366f1' }));
});

let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  fetchAll();
  // 低频轮询作为兜底 (60s, SSE 为主)
  refreshTimer = setInterval(fetchAll, 60_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

// 图表点击交互
function onChartClick(data: any) {
  if (data?.label) {
    // 点击运行状态图表 → 跳转到运行记录页并筛选
    router.push({ path: '/runs', query: { status: data.rawLabel || '' } });
  }
}
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 20px; }

/* ── 统计卡片网格 ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: var(--shadow);
  transition: border-color var(--transition);
  position: relative;
  overflow: hidden;
}

.stat-card:hover { border-color: var(--border-light); }

.stat-card::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  opacity: 0.06;
  transform: translate(20%, -20%);
}

.stat-card:nth-child(1)::after { background: var(--accent); }
.stat-card:nth-child(2)::after { background: var(--green); }
.stat-card:nth-child(3)::after { background: var(--purple); }
.stat-card:nth-child(4)::after { background: var(--cyan); }

.stat-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.stat-icon.sessions { background: var(--accent-light); color: var(--accent); }
.stat-icon.connections { background: var(--green-dim); color: var(--green); }
.stat-icon.capabilities { background: rgba(168, 85, 247, 0.15); color: var(--purple); }
.stat-icon.teams { background: rgba(6, 182, 212, 0.15); color: var(--cyan); }

.stat-info { flex: 1; min-width: 0; }
.stat-value { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
.stat-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.stat-trend {
  position: absolute;
  top: 14px;
  right: 16px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg);
  padding: 2px 8px;
  border-radius: 10px;
}

.stat-trend.ok { color: var(--green); background: var(--green-dim); }
.stat-trend.warn { color: var(--yellow); background: var(--yellow-dim); }

/* ── 主体网格 ── */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  align-items: start;
}

/* ── 面板通用 ── */
.panel { padding: 0; overflow: hidden; }
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.panel-header h2 { font-size: 15px; font-weight: 600; }
.panel-loading, .panel-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); }
.link { font-size: 12px; color: var(--accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

/* ── 会话列表 ── */
.session-list { padding: 4px 0; }
.session-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  cursor: pointer;
  transition: background var(--transition);
}
.session-row:hover { background: var(--surface-hover); }
.session-row + .session-row { border-top: 1px solid var(--border); }
.session-dot { flex-shrink: 0; }
.session-info { flex: 1; min-width: 0; }
.session-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.session-conn { font-size: 11px; color: var(--text-dim); background: var(--bg); padding: 2px 8px; border-radius: 10px; white-space: nowrap; }

/* ── 实例状态 ── */
.conn-list { padding: 4px 0; }
.conn-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
}
.conn-row + .conn-row { border-top: 1px solid var(--border); }
.conn-dot { flex-shrink: 0; }
.conn-info { flex: 1; min-width: 0; }
.conn-name { font-size: 13px; font-weight: 500; }
.conn-kind { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
.conn-caps { display: flex; gap: 4px; }
.cap-pill { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--accent-light); color: var(--accent); }

/* ── 快捷操作 ── */
.quick-actions { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.qa-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
}
.qa-btn:hover { border-color: var(--accent); background: var(--surface-hover); }
.qa-icon {
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
.qa-text { display: flex; flex-direction: column; gap: 2px; }
.qa-title { font-size: 13px; font-weight: 500; }
.qa-desc { font-size: 11px; color: var(--text-muted); }

/* ── 图表 ── */
.chart-wrapper {
  padding: 16px;
  min-height: 160px;
}

.donut-wrapper {
  display: flex;
  align-items: center;
  gap: 20px;
}

.donut-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label { flex: 1; color: var(--text); }
.legend-count { color: var(--text-muted); font-weight: 600; }
.legend-empty { color: var(--text-dim); font-size: 12px; text-align: center; padding: 12px 0; }

/* ── 响应式 ── */
@media (max-width: 1200px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .dashboard-grid { grid-template-columns: 1fr; }
}

/* ── 实时更新条 ── */
.realtime-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 8px;
  background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2);
  cursor: pointer; transition: all 0.2s;
}
.realtime-bar:hover { background: rgba(99, 102, 241, 0.12); }
.realtime-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #22c55e; animation: pulse 2s infinite;
}
.realtime-text { flex: 1; font-size: 12px; color: var(--text); }
.realtime-count {
  font-size: 11px; padding: 1px 8px; border-radius: 10px;
  background: var(--primary); color: #fff; font-weight: 600;
}

/* ── 时间范围选择器 ── */
.time-range { display: flex; gap: 4px; }
.time-range button {
  padding: 2px 8px; border-radius: 4px; font-size: 11px;
  background: transparent; border: 1px solid var(--border);
  color: var(--text-dim); cursor: pointer;
}
.time-range button.active {
  background: var(--primary); color: #fff; border-color: var(--primary);
}
.time-range button:hover:not(.active) {
  background: var(--surface-hover);
}

/* ── 统计卡片点击 ── */
.stat-card { cursor: pointer; }
.stat-card:hover { border-color: var(--primary); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
