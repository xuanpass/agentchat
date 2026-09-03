<template>
  <div class="runs-page">
    <div class="page-header">
      <h1 class="page-title">运行记录</h1>
      <button class="btn btn-primary" @click="showCreate = true">+ 新建运行</button>
    </div>

    <!-- 状态筛选 -->
    <div class="filter-bar">
      <button
        v-for="f in statusFilters" :key="f.value"
        class="filter-chip"
        :class="{ active: filterStatus === f.value }"
        @click="filterStatus = f.value"
      >{{ f.label }}</button>
    </div>

    <!-- 列表 -->
    <SkeletonScreen v-if="loading" type="lines" :count="6" />
    <div v-else-if="filteredRuns.length === 0" class="empty">
      <div class="empty-icon">⟳</div>
      <div>暂无运行记录</div>
      <div style="margin-top:8px;font-size:13px">选择团队和策略来创建一次编排执行</div>
    </div>

    <div v-else class="run-list">
      <div v-for="run in filteredRuns" :key="run.id" class="card run-card" @click="selectRun(run)">
        <div class="run-head">
          <span class="run-id">{{ run.id.slice(0, 12) }}...</span>
          <span class="run-status" :class="`status-${run.status}`">{{ statusLabel(run.status) }}</span>
        </div>
        <div class="run-meta">
          <span class="run-strategy">{{ strategyLabel(run.strategy) }}</span>
          <span class="run-trace">🔗 {{ run.traceId.slice(0, 20) }}</span>
          <span class="run-time">{{ formatTime(run.createdAt) }}</span>
        </div>
        <div class="run-sessions" v-if="run.sessionIds.length > 0">
          <span class="sessions-label">{{ run.sessionIds.length }} 个会话</span>
        </div>
        <div class="run-events-count" v-if="run.events.length > 0">
          {{ run.events.length }} 个事件
        </div>
      </div>
    </div>

    <!-- 运行详情 Modal -->
    <div v-if="selectedRun" class="modal-overlay" @click.self="selectedRun = null">
      <div class="card modal modal-large">
        <h2>运行详情</h2>
        <div class="detail-grid">
          <div class="detail-item"><label>ID</label><span class="mono">{{ selectedRun.id }}</span></div>
          <div class="detail-item"><label>Trace</label><span class="mono">{{ selectedRun.traceId }}</span></div>
          <div class="detail-item"><label>状态</label><span class="run-status" :class="`status-${selectedRun.status}`">{{ statusLabel(selectedRun.status) }}</span></div>
          <div class="detail-item"><label>策略</label><span>{{ strategyLabel(selectedRun.strategy) }}</span></div>
          <div class="detail-item"><label>创建时间</label><span>{{ formatTime(selectedRun.createdAt) }}</span></div>
          <div class="detail-item"><label>更新时间</label><span>{{ formatTime(selectedRun.updatedAt) }}</span></div>
        </div>

        <div class="detail-section" v-if="selectedRun.context">
          <label>上下文</label>
          <pre class="context-box">{{ selectedRun.context }}</pre>
        </div>

        <div class="detail-section">
          <label>会话 ({{ selectedRun.sessionIds.length }})</label>
          <div class="session-chips">
            <span v-for="sid in selectedRun.sessionIds" :key="sid" class="chip">{{ sid.slice(0, 12) }}</span>
            <span v-if="selectedRun.sessionIds.length === 0" class="text-muted">未绑定会话</span>
          </div>
        </div>

        <div class="detail-section">
          <label>事件流 ({{ selectedRun.events.length }})</label>
          <div class="event-timeline" v-if="selectedRun.events.length > 0">
            <div v-for="ev in selectedRun.events" :key="ev.seq" class="event-item">
              <span class="event-seq">#{{ ev.seq }}</span>
              <span class="event-type" :class="`ev-${ev.type}`">{{ ev.type }}</span>
              <span class="event-source">{{ ev.source }}</span>
              <span class="event-time">{{ formatTime(ev.ts) }}</span>
            </div>
          </div>
          <div v-else class="text-muted">暂无事件</div>
        </div>

        <!-- 操作按钮 -->
        <div class="detail-actions" v-if="selectedRun.status === 'queued'">
          <button class="btn btn-primary" @click="updateStatus('running')">▶ 开始</button>
          <button class="btn" @click="updateStatus('cancelled')">⏹ 取消</button>
        </div>
        <div class="detail-actions" v-else-if="selectedRun.status === 'running'">
          <button class="btn btn-success" @click="updateStatus('done')">✓ 完成</button>
          <button class="btn btn-danger" @click="updateStatus('failed')">✗ 失败</button>
        </div>

        <div class="modal-actions">
          <button class="btn" @click="selectedRun = null">关闭</button>
          <button class="btn btn-danger" @click="deleteRun">删除</button>
        </div>
      </div>
    </div>

    <!-- 新建运行 Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="card modal">
        <h2>新建运行</h2>
        <div class="form-row">
          <label>团队 (可选)</label>
          <select v-model="createForm.teamId">
            <option value="">不绑定</option>
            <option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>策略</label>
          <select v-model="createForm.strategy">
            <option value="serial">串行 (Serial)</option>
            <option value="parallel">并行 (Parallel)</option>
            <option value="fanout">广播 (Fanout)</option>
          </select>
        </div>
        <div class="form-row">
          <label>上下文</label>
          <textarea v-model="createForm.context" placeholder="运行目标或初始提示..." rows="3"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" @click="createRun">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';
import SkeletonScreen from '../components/SkeletonScreen.vue';

const toast = useToast();
const loading = ref(false);
const runs = ref<any[]>([]);
const teams = ref<any[]>([]);
const filterStatus = ref('');
const selectedRun = ref<any>(null);
const showCreate = ref(false);

const createForm = reactive({
  teamId: '',
  strategy: 'serial',
  context: '',
});

const statusFilters = [
  { value: '', label: '全部' },
  { value: 'queued', label: '排队' },
  { value: 'running', label: '运行中' },
  { value: 'done', label: '完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '取消' },
];

const filteredRuns = computed(() => {
  if (!filterStatus.value) return runs.value;
  return runs.value.filter(r => r.status === filterStatus.value);
});

async function fetchRuns() {
  loading.value = true;
  try {
    runs.value = await api.get('/runs');
  } finally {
    loading.value = false;
  }
}

async function fetchTeams() {
  teams.value = await api.get('/teams');
}

function selectRun(run: any) {
  selectedRun.value = run;
}

async function createRun() {
  try {
    await api.post('/runs', createForm);
    showCreate.value = false;
    createForm.teamId = '';
    createForm.strategy = 'serial';
    createForm.context = '';
    toast.success('运行已创建');
    await fetchRuns();
  } catch (e: any) {
    toast.error('创建失败: ' + (e.message ?? '未知错误'));
  }
}

async function updateStatus(status: string) {
  if (!selectedRun.value) return;
  try {
    await api.patch(`/runs/${selectedRun.value.id}`, { status });
    selectedRun.value = { ...selectedRun.value, status };
    toast.success(`状态已更新为 ${statusLabel(status)}`);
    await fetchRuns();
  } catch (e: any) {
    toast.error('更新失败');
  }
}

async function deleteRun() {
  if (!selectedRun.value) return;
  try {
    await api.delete(`/runs/${selectedRun.value.id}`);
    selectedRun.value = null;
    toast.success('已删除');
    await fetchRuns();
  } catch (e: any) {
    toast.error('删除失败');
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    queued: '排队中', running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消',
  };
  return map[s] ?? s;
}

function strategyLabel(s: string) {
  const map: Record<string, string> = { serial: '串行', parallel: '并行', fanout: '广播' };
  return map[s] ?? s;
}

function formatTime(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(() => { fetchRuns(); fetchTeams(); });
</script>

<style scoped>
.runs-page { max-width: 900px; }
.filter-bar { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-chip { padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg); font-size: 12px; cursor: pointer; transition: all 0.2s; }
.filter-chip:hover { border-color: var(--accent); }
.filter-chip.active { background: var(--accent); color: white; border-color: var(--accent); }

.run-list { display: flex; flex-direction: column; gap: 10px; }
.run-card { padding: 14px 18px; cursor: pointer; transition: all 0.2s; }
.run-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(99, 102, 241, 0.1); }
.run-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.run-id { font-family: monospace; font-size: 13px; font-weight: 500; }
.run-status { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.status-queued { background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); }
.status-running { background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); }
.status-done { background: rgba(34, 197, 94, 0.1); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
.status-failed { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
.status-cancelled { background: rgba(156, 163, 175, 0.1); color: #9ca3af; border: 1px solid rgba(156, 163, 175, 0.3); }

.run-meta { display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); align-items: center; }
.run-strategy { font-weight: 500; color: var(--text); }
.run-trace { font-family: monospace; }
.run-sessions { margin-top: 6px; }
.sessions-label { font-size: 11px; color: var(--text-muted); }

.modal-large { width: 600px; max-height: 80vh; overflow-y: auto; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.detail-item label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.detail-item .mono { font-family: monospace; font-size: 12px; }
.detail-section { margin-bottom: 16px; }
.detail-section label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600; }
.context-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-size: 13px; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
.session-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { background: var(--bg); border: 1px solid var(--border); padding: 2px 10px; border-radius: 4px; font-size: 11px; font-family: monospace; }

.event-timeline { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
.event-item { display: flex; gap: 10px; align-items: center; padding: 6px 10px; background: var(--bg); border-radius: 4px; font-size: 12px; }
.event-seq { font-family: monospace; color: var(--text-muted); min-width: 28px; }
.event-type { padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
.ev-info { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.ev-success { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
.ev-error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.ev-warn { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.ev-dispatch { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; }
.event-source { color: var(--text-muted); }
.event-time { margin-left: auto; color: var(--text-muted); font-size: 11px; }

.detail-actions { display: flex; gap: 8px; margin-bottom: 14px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input, .form-row select, .form-row textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.form-row textarea { resize: vertical; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
