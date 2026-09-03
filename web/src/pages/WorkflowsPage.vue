<template>
  <div class="workflows-page">
    <h1>编排工作流</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总工作流</div>
        <div class="stat-value">{{ stats.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃</div>
        <div class="stat-value">{{ stats.active ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总运行次数</div>
        <div class="stat-value">{{ stats.totalRuns ?? 0 }}</div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <button @click="showCreateModal = true">+ 新建工作流</button>
      <button @click="showRunsModal = true">运行记录</button>
      <button @click="loadAll">刷新</button>
    </div>

    <!-- 工作流列表 -->
    <div v-if="loading" class="skeleton">加载中...</div>
    <div v-else-if="workflows.length === 0" class="empty">
      <p>暂无工作流</p>
      <button @click="showCreateModal = true">创建第一个</button>
    </div>
    <div v-else class="workflows-grid">
      <div v-for="wf in workflows" :key="wf.id" class="wf-card">
        <div class="wf-header">
          <span class="wf-name">{{ wf.name }}</span>
          <span :class="['badge', 'status-' + wf.status]">{{ statusLabel(wf.status) }}</span>
        </div>
        <div class="wf-desc">{{ wf.description || '无描述' }}</div>
        <div class="wf-meta">
          <span>{{ wf.nodeCount }} 节点</span>
          <span>{{ wf.edges?.length ?? 0 }} 边</span>
          <span>{{ formatTs(wf.created_at) }}</span>
        </div>
        <div class="wf-actions">
          <button v-if="wf.status === 'draft'" @click="setStatus(wf, 'active')">激活</button>
          <button v-if="wf.status === 'active'" @click="setStatus(wf, 'paused')">暂停</button>
          <button v-if="wf.status === 'active'" @click="runWorkflow(wf)" class="primary">运行</button>
          <button @click="editWorkflow(wf)" class="secondary">编辑</button>
          <button @click="deleteWorkflow(wf.id)" class="danger">删除</button>
        </div>
      </div>
    </div>

    <!-- 创建/编辑 Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal wide">
        <h2>{{ editingWf ? '编辑工作流' : '新建工作流' }}</h2>
        <div class="form-row">
          <label>名称</label>
          <input type="text" v-model="wfForm.name" placeholder="例如: 数据处理流水线" />
        </div>
        <div class="form-row">
          <label>描述</label>
          <input type="text" v-model="wfForm.description" placeholder="可选" />
        </div>

        <!-- 节点编辑 -->
        <h3 style="margin-top: 16px; font-size: 14px;">节点</h3>
        <div v-for="(node, i) in wfForm.nodes" :key="i" class="node-row">
          <select v-model="node.type" style="width: 100px;">
            <option value="input">输入</option>
            <option value="agent">Agent</option>
            <option value="condition">条件</option>
            <option value="parallel">并行</option>
            <option value="merge">合并</option>
            <option value="output">输出</option>
          </select>
          <input type="text" v-model="node.label" placeholder="节点名称" style="flex:1;" />
          <button @click="wfForm.nodes.splice(i, 1)" class="danger small">×</button>
        </div>
        <button @click="addNode" class="secondary small">+ 添加节点</button>

        <!-- 边编辑 -->
        <h3 style="margin-top: 16px; font-size: 14px;">连接 ({{ wfForm.edges.length }})</h3>
        <div v-for="(edge, i) in wfForm.edges" :key="i" class="node-row">
          <select v-model="edge.source" style="flex:1;">
            <option v-for="n in wfForm.nodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
          <span>→</span>
          <select v-model="edge.target" style="flex:1;">
            <option v-for="n in wfForm.nodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
          <button @click="wfForm.edges.splice(i, 1)" class="danger small">×</button>
        </div>
        <div v-if="wfForm.nodes.length >= 2" class="add-edge-row">
          <select v-model="newEdgeSource" style="flex:1;">
            <option value="">源节点</option>
            <option v-for="n in wfForm.nodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
          <select v-model="newEdgeTarget" style="flex:1;">
            <option value="">目标节点</option>
            <option v-for="n in wfForm.nodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
          <button @click="addEdge" class="secondary small">+ 添加连接</button>
        </div>

        <div class="form-actions">
          <button @click="submitWorkflow" :disabled="!wfForm.name || wfForm.nodes.length === 0">{{ editingWf ? '保存' : '创建' }}</button>
          <button @click="closeWfModal" class="secondary">取消</button>
        </div>
      </div>
    </div>

    <!-- 运行记录 Modal -->
    <div v-if="showRunsModal" class="modal-overlay" @click.self="showRunsModal = false">
      <div class="modal wide">
        <h2>运行记录</h2>
        <div v-if="runs.length === 0" class="empty-sm">暂无运行记录</div>
        <table v-else class="data-table">
          <thead>
            <tr><th>ID</th><th>状态</th><th>触发者</th><th>时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td class="mono">{{ r.id.slice(0, 12) }}...</td>
              <td><span :class="['badge', 'status-' + r.status]">{{ r.status }}</span></td>
              <td>{{ r.triggered_by }}</td>
              <td>{{ formatTs(r.created_at) }}</td>
              <td>
                <button v-if="r.status === 'running'" @click="cancelRun(r)" class="danger small">取消</button>
                <button @click="viewRun(r)" class="secondary small">详情</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="form-actions">
          <button @click="showRunsModal = false" class="secondary">关闭</button>
        </div>
      </div>
    </div>

    <!-- 运行详情 Modal -->
    <div v-if="showRunDetailModal" class="modal-overlay" @click.self="showRunDetailModal = false">
      <div class="modal wide">
        <h2>运行详情</h2>
        <div v-if="runDetail">
          <div class="detail-row"><strong>ID:</strong> {{ runDetail.id }}</div>
          <div class="detail-row"><strong>状态:</strong> {{ runDetail.status }}</div>
          <div class="detail-row"><strong>触发:</strong> {{ runDetail.triggered_by }}</div>
          <h3 style="margin-top: 12px;">节点状态</h3>
          <div class="node-status-grid">
            <div v-for="(status, nodeId) in runDetail.nodesStatus || {}" :key="nodeId" class="node-status-item">
              <span class="ns-node">{{ nodeId.slice(0, 8) }}</span>
              <span :class="['badge', 'ns-' + status]">{{ status }}</span>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button @click="showRunDetailModal = false" class="secondary">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';

const workflows = ref<any[]>([]);
const stats = ref<any>({ total: 0, active: 0, totalRuns: 0 });
const runs = ref<any[]>([]);
const runDetail = ref<any>(null);
const loading = ref(false);
const showCreateModal = ref(false);
const showRunsModal = ref(false);
const showRunDetailModal = ref(false);
const editingWf = ref<any>(null);
const newEdgeSource = ref('');
const newEdgeTarget = ref('');
const wfForm = ref({
  name: '', description: '', nodes: [] as any[], edges: [] as any[],
});

function uid() { return 'n_' + Math.random().toString(36).slice(2, 10); }
function eid() { return 'e_' + Math.random().toString(36).slice(2, 10); }

function addNode() {
  wfForm.value.nodes.push({ id: uid(), type: 'agent', label: '新节点', config: {} });
}

function addEdge() {
  if (newEdgeSource.value && newEdgeTarget.value) {
    wfForm.value.edges.push({ id: eid(), source: newEdgeSource.value, target: newEdgeTarget.value });
    newEdgeSource.value = '';
    newEdgeTarget.value = '';
  }
}

function editWorkflow(wf: any) {
  editingWf.value = wf;
  wfForm.value = {
    name: wf.name, description: wf.description || '',
    nodes: JSON.parse(JSON.stringify(wf.nodes)),
    edges: JSON.parse(JSON.stringify(wf.edges)),
  };
  showCreateModal.value = true;
}

function closeWfModal() {
  showCreateModal.value = false;
  editingWf.value = null;
  wfForm.value = { name: '', description: '', nodes: [], edges: [] };
}

async function submitWorkflow() {
  if (editingWf.value) {
    await api.patch(`/api/workflows/${editingWf.value.id}`, wfForm.value);
  } else {
    await api.post('/api/workflows', wfForm.value);
  }
  closeWfModal();
  await loadAll();
}

async function setStatus(wf: any, status: string) {
  await api.patch(`/api/workflows/${wf.id}`, { status });
  await loadAll();
}

async function runWorkflow(wf: any) {
  await api.post(`/api/workflows/${wf.id}/run`, {});
  await loadRuns();
}

async function deleteWorkflow(id: string) {
  await api.delete(`/api/workflows/${id}`);
  await loadAll();
}

async function loadRuns() {
  runs.value = await api.get<any[]>('/api/workflow-runs?limit=50');
}

async function loadAll() {
  loading.value = true;
  const [wfs, st] = await Promise.all([
    api.get<any[]>('/api/workflows'),
    api.get<any>('/api/workflows/stats'),
  ]);
  workflows.value = wfs;
  stats.value = st;
  loading.value = false;
}

async function cancelRun(run: any) {
  await api.post(`/api/workflow-runs/${run.id}/cancel`, {});
  await loadRuns();
}

async function viewRun(run: any) {
  runDetail.value = await api.get<any>(`/api/workflow-runs/${run.id}`);
  showRunDetailModal.value = true;
}

function statusLabel(s: string): string {
  return { draft: '草稿', active: '活跃', paused: '暂停', archived: '归档' }[s] || s;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(() => { loadAll(); loadRuns(); });
</script>

<style scoped>
.workflows-page { max-width: 960px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; padding: 14px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
.stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
.workflows-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.wf-card { padding: 16px; background: var(--surface); border-radius: 10px; border: 1px solid var(--border); }
.wf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.wf-name { font-weight: 600; font-size: 14px; }
.wf-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; min-height: 18px; }
.wf-meta { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
.wf-actions { display: flex; gap: 6px; flex-wrap: wrap; }

.badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.badge.status-draft { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }
.badge.status-active { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.status-paused { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.badge.status-archived { background: rgba(107, 114, 128, 0.2); color: #6b7280; }
.badge.status-running { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.badge.status-completed { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.status-failed { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 400px; padding: 24px; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); max-height: 80vh; overflow-y: auto; }
.modal.wide { width: 560px; }
.modal h2 { margin: 0 0 16px; font-size: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); box-sizing: border-box; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }

.node-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.add-edge-row { display: flex; gap: 6px; margin-top: 6px; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
.data-table th { color: var(--text-muted); font-weight: 600; font-size: 11px; }
.mono { font-family: monospace; font-size: 11px; }
.empty-sm { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }
.empty { text-align: center; padding: 40px; color: var(--text-muted); }
.empty p { margin-bottom: 12px; }

.detail-row { margin-bottom: 6px; font-size: 13px; }
.node-status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.node-status-item { display: flex; justify-content: space-between; padding: 6px 8px; background: var(--bg); border-radius: 6px; font-size: 12px; }
</style>
