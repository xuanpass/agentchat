<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">能力库</h1>
      <div class="page-actions">
        <button class="btn" @click="refresh" :disabled="loading">刷新</button>
        <button class="btn btn-primary" @click="showImport = true">+ 从实例导入</button>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
        <span class="tab-badge" v-if="t.count !== undefined">{{ t.count }}</span>
      </button>
    </div>

    <!-- 本地仓库 -->
    <div v-if="activeTab === 'local'">
      <SkeletonScreen v-if="loading" type="cards" :count="6" />
      <div v-else-if="capabilities.length === 0" class="empty">
        <div class="empty-icon">◇</div>
        <div>本地能力库为空</div>
        <div style="margin-top:8px;font-size:13px">点击「从实例导入」拉取远程能力</div>
      </div>
      <div v-else class="cap-grid">
        <div v-for="c in capabilities" :key="c.id" class="card cap-card">
          <div class="cap-header">
            <span class="cap-type" :class="`type-${c.type}`">{{ c.type }}</span>
            <span class="cap-name">{{ c.name }}</span>
          </div>
          <div class="cap-meta">
            <span>来源: {{ c.sourceKind }}</span>
            <span v-if="c.version">v{{ c.version }}</span>
            <span>{{ formatSize(c.sizeBytes) }}</span>
          </div>
          <div class="cap-installed">
            <span v-for="id in c.installedOn" :key="id" class="install-chip">
              {{ id.slice(0, 8) }}
            </span>
            <span v-if="!c.installedOn?.length" class="install-none">未部署</span>
          </div>
          <div class="cap-actions">
            <button class="btn btn-sm" @click="viewDiff(c)" :disabled="!c.installedOn?.length">diff</button>
            <button class="btn btn-sm btn-primary" @click="syncCap(c)">同步到实例</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 远程浏览 -->
    <div v-if="activeTab === 'remote'">
      <div class="remote-toolbar">
        <select v-model="remoteConnectionId" @change="loadRemote" class="remote-select">
          <option value="">选择实例...</option>
          <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.kind }})</option>
        </select>
        <button class="btn" @click="loadRemote" :disabled="!remoteConnectionId || loading">浏览</button>
      </div>
      <div v-if="!remoteConnectionId" class="empty">
        <div class="empty-icon">◇</div>
        <div>选择一个实例浏览其能力</div>
      </div>
      <div v-else-if="loading" class="empty"><div class="empty-icon">⟳</div><div>加载中...</div></div>
      <div v-else-if="remoteCaps.length === 0" class="empty">
        <div class="empty-icon">◇</div><div>该实例无可用能力</div>
      </div>
      <div v-else class="cap-grid">
        <div v-for="r in remoteCaps" :key="r.name" class="card cap-card">
          <div class="cap-header">
            <span class="cap-type" :class="`type-${r.type}`">{{ r.type }}</span>
            <span class="cap-name">{{ r.name }}</span>
          </div>
          <div class="cap-meta">
            <span v-if="r.version">v{{ r.version }}</span>
            <span>{{ formatSize(r.sizeBytes) }}</span>
          </div>
          <div class="cap-actions">
            <button class="btn btn-sm btn-primary" @click="importCap(r)"
              :disabled="remoteConnKind === 'a2a'"
              :title="remoteConnKind === 'a2a' ? 'A2A 端点的 skills 是能力声明而非文件, 不支持导入' : ''">导入到本地</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 同步任务 -->
    <div v-if="activeTab === 'sync'">
      <div v-if="loading" class="empty"><div class="empty-icon">⟳</div><div>加载中...</div></div>
      <div v-else-if="syncTasks.length === 0" class="empty">
        <div class="empty-icon">◇</div><div>暂无同步任务</div>
      </div>
      <div v-else class="card table-card">
        <table class="table">
          <thead><tr><th>ID</th><th>目标实例</th><th>能力数</th><th>状态</th><th>更新时间</th><th></th></tr></thead>
          <tbody>
            <tr v-for="t in syncTasks" :key="t.id">
              <td>{{ t.id.slice(0, 8) }}</td>
              <td>{{ getConnName(t.targetConnectionId) }}</td>
              <td>{{ JSON.parse(t.capabilityNames || '[]').length }}</td>
              <td>
                <span class="task-status" :class="`task-${t.status}`">{{ t.status }}</span>
              </td>
              <td>{{ formatTime(t.updatedAt) }}</td>
              <td>
                <button
                  v-if="t.status === 'pending' || t.status === 'running'"
                  class="btn btn-sm"
                  @click="cancelTask(t.id)"
                >取消</button>
                <button v-else class="btn btn-sm" @click="viewTaskDetail(t)">详情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Diff 弹窗 -->
    <div v-if="diffTarget" class="modal-overlay" @click.self="diffTarget = null">
      <div class="card modal modal-lg">
        <h2>能力对比: {{ diffTarget.name }}</h2>
        <div v-if="diffLoading" class="empty"><div class="empty-icon">⟳</div><div>对比中...</div></div>
        <div v-else-if="diffResult" class="diff-result">
          <div class="diff-section" v-if="diffResult.added.length">
            <div class="diff-label diff-added">新增</div>
            <span v-for="n in diffResult.added" :key="n" class="diff-item diff-item-added">{{ n }}</span>
          </div>
          <div class="diff-section" v-if="diffResult.changed.length">
            <div class="diff-label diff-changed">变更</div>
            <span v-for="n in diffResult.changed" :key="n" class="diff-item diff-item-changed">{{ n }}</span>
          </div>
          <div class="diff-section" v-if="diffResult.unchanged.length">
            <div class="diff-label diff-unchanged">未变</div>
            <span v-for="n in diffResult.unchanged" :key="n" class="diff-item diff-item-unchanged">{{ n }}</span>
          </div>
          <div class="diff-section" v-if="diffResult.removed.length">
            <div class="diff-label diff-removed">移除</div>
            <span v-for="n in diffResult.removed" :key="n" class="diff-item diff-item-removed">{{ n }}</span>
          </div>
          <div v-if="!diffResult.added.length && !diffResult.changed.length && !diffResult.removed.length && !diffResult.unchanged.length" class="diff-empty">
            无对比数据
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="diffTarget = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 同步弹窗 -->
    <div v-if="syncTarget" class="modal-overlay" @click.self="syncTarget = null">
      <div class="card modal">
        <h2>同步「{{ syncTarget.name }}」到实例</h2>
        <div class="form-row">
          <label>目标实例</label>
          <select v-model="syncConnectionId">
            <option value="">选择实例...</option>
            <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.kind }})</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="syncTarget = null">取消</button>
          <button class="btn btn-primary" @click="confirmSync" :disabled="!syncConnectionId">确认同步</button>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="showImport" class="modal-overlay" @click.self="showImport = false">
      <div class="card modal">
        <h2>从实例导入能力</h2>
        <div class="form-row">
          <label>源实例</label>
          <select v-model="importConnectionId">
            <option value="">选择实例...</option>
            <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.kind }})</option>
          </select>
        </div>
        <div class="form-row">
          <label>能力名称</label>
          <input v-model="importName" placeholder="输入能力名称" />
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showImport = false">取消</button>
          <button class="btn btn-primary" @click="confirmImport" :disabled="!importConnectionId || !importName">导入</button>
        </div>
      </div>
    </div>

    <!-- 任务详情弹窗 -->
    <div v-if="taskDetail" class="modal-overlay" @click.self="taskDetail = null">
      <div class="card modal modal-lg">
        <h2>同步任务详情</h2>
        <div class="task-info">
          <div><strong>ID:</strong> {{ taskDetail.id }}</div>
          <div><strong>状态:</strong> {{ taskDetail.status }}</div>
          <div><strong>目标:</strong> {{ getConnName(taskDetail.targetConnectionId) }}</div>
          <div><strong>能力:</strong> {{ JSON.parse(taskDetail.capabilityNames || '[]').join(', ') }}</div>
        </div>
        <div v-if="taskDetail.diffResult" class="task-result">
          <h3>执行结果</h3>
          <div v-for="r in parseTaskResult(taskDetail.diffResult)" :key="r.name" class="task-item">
            <span class="task-item-name">{{ r.name }}</span>
            <span class="task-item-status" :class="r.ok ? 'ok' : 'fail'">{{ r.ok ? '✓' : '✗' }}</span>
            <span v-if="r.error" class="task-item-error">{{ r.error }}</span>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="taskDetail = null">关闭</button>
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

// ── 状态 ──
const activeTab = ref('local');
const loading = ref(false);
const capabilities = ref<any[]>([]);
const connections = ref<any[]>([]);
const remoteCaps = ref<any[]>([]);
const remoteConnectionId = ref('');
const syncTasks = ref<any[]>([]);

// 远端连接 kind (用于屏蔽 A2A 不支持的导入动作)
const remoteConnKind = computed(
  () => connections.value.find((c) => c.id === remoteConnectionId.value)?.kind ?? ''
);

// 弹窗
const showImport = ref(false);
const importConnectionId = ref('');
const importName = ref('');
const diffTarget = ref<any>(null);
const diffResult = ref<any>(null);
const diffLoading = ref(false);
const syncTarget = ref<any>(null);
const syncConnectionId = ref('');
const taskDetail = ref<any>(null);

// ── Tabs ──
const tabs = computed(() => [
  { key: 'local', label: '本地仓库', count: capabilities.value.length },
  { key: 'remote', label: '远程浏览' },
  { key: 'sync', label: '同步任务', count: syncTasks.value.length },
]);

// ── 数据加载 ──
async function refresh() {
  loading.value = true;
  try {
    await Promise.all([loadLocal(), loadConnections(), loadSyncTasks()]);
  } finally {
    loading.value = false;
  }
}

async function loadLocal() {
  capabilities.value = await api.get('/capabilities');
}

async function loadConnections() {
  connections.value = await api.get('/connections');
}

async function loadRemote() {
  if (!remoteConnectionId.value) return;
  loading.value = true;
  try {
    remoteCaps.value = await api.get(`/capabilities/remote?connectionId=${remoteConnectionId.value}`);
  } catch (e: any) {
    remoteCaps.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadSyncTasks() {
  syncTasks.value = await api.get('/synctasks');
}

// ── 操作 ──
async function importCap(r: any) {
  if (!remoteConnectionId.value) return;
  if (remoteConnKind.value === 'a2a') {
    toast.warning('A2A 端点的 skills 是能力声明而非文件, 不支持导入到本地');
    return;
  }
  try {
    await api.post('/capabilities/import', { connectionId: remoteConnectionId.value, name: r.name });
    await loadLocal();
  } catch (e: any) {
    toast.error(`导入失败: ${e.message}`);
  }
}

async function confirmImport() {
  try {
    await api.post('/capabilities/import', { connectionId: importConnectionId.value, name: importName.value });
    showImport.value = false;
    importName.value = '';
    await loadLocal();
  } catch (e: any) {
    toast.error(`导入失败: ${e.message}`);
  }
}

function syncCap(c: any) {
  syncTarget.value = c;
  syncConnectionId.value = '';
}

async function confirmSync() {
  const name = syncTarget.value.name;
  try {
    await api.post('/synctasks', { targetConnectionId: syncConnectionId.value, capabilityNames: [name] });
    syncTarget.value = null;
    await loadSyncTasks();
  } catch (e: any) {
    toast.error(`同步失败: ${e.message}`);
  }
}

function viewDiff(c: any) {
  diffTarget.value = c;
  diffResult.value = null;
  diffLoading.value = true;
  // 取第一个已部署的实例做对比
  const connId = c.installedOn?.[0];
  if (connId) {
    api.post('/capabilities/diff', { connectionId: connId, name: c.name })
      .then((r) => { diffResult.value = r; })
      .catch(() => { diffResult.value = null; })
      .finally(() => { diffLoading.value = false; });
  }
}

async function cancelTask(id: string) {
  try {
    await api.patch(`/synctasks/${id}/cancel`);
    await loadSyncTasks();
  } catch (e: any) {
    toast.error(`取消失败: ${e.message}`);
  }
}

function viewTaskDetail(t: any) {
  taskDetail.value = t;
}

function parseTaskResult(json: string) {
  try { return JSON.parse(json); } catch { return []; }
}

// ── 工具 ──
function getConnName(id: string) {
  return connections.value.find((c) => c.id === id)?.name || id.slice(0, 8);
}

function formatSize(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString();
}

onMounted(refresh);
</script>

<style scoped>
/* ── Tabs ── */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 8px 16px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
}

.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.tab-badge {
  display: inline-block;
  background: var(--accent-light);
  color: var(--accent);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

/* ── 远程工具栏 ── */
.remote-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.remote-select {
  flex: 1;
  max-width: 360px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}

/* ── 能力卡片网格 ── */
.cap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.cap-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cap-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-type {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.03em;
}

.type-skill { background: var(--accent-light); color: var(--accent); }
.type-plugin { background: rgba(168,85,247,0.2); color: var(--purple); }
.type-mcp { background: var(--green-dim); color: var(--green); }

.cap-name {
  font-weight: 600;
  font-size: 14px;
  word-break: break-all;
}

.cap-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.cap-installed {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.install-chip {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
}

.install-none {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.cap-actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
}

/* ── 表格 ── */
.table-card { overflow: hidden; }
.table { width: 100%; border-collapse: collapse; }
.table th { text-align: left; padding: 10px 14px; font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); background: var(--bg); }
.table td { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
.table tr:last-child td { border-bottom: none; }

.task-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
}

.task-pending { background: var(--yellow-dim); color: var(--yellow); }
.task-running { background: var(--accent-light); color: var(--accent); }
.task-done { background: var(--green-dim); color: var(--green); }
.task-failed { background: var(--red-dim); color: var(--red); }
.task-cancelled { background: var(--surface-hover); color: var(--text-muted); }

/* ── Diff 弹窗 ── */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; }
.modal-lg { width: 560px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

.diff-result { display: flex; flex-direction: column; gap: 12px; }
.diff-section { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.diff-label { font-size: 11px; font-weight: 700; text-transform: uppercase; width: 50px; flex-shrink: 0; }
.diff-added { color: var(--green); }
.diff-changed { color: var(--yellow); }
.diff-unchanged { color: var(--text-dim); }
.diff-removed { color: var(--red); }

.diff-item {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}
.diff-item-added { background: var(--green-dim); color: var(--green); }
.diff-item-changed { background: var(--yellow-dim); color: var(--yellow); }
.diff-item-unchanged { background: var(--surface-hover); color: var(--text-muted); }
.diff-item-removed { background: var(--red-dim); color: var(--red); }

.diff-empty { text-align: center; color: var(--text-muted); padding: 20px; }

/* ── 任务详情 ── */
.task-info { display: flex; flex-direction: column; gap: 6px; font-size: 13px; margin-bottom: 16px; }
.task-result h3 { font-size: 14px; margin-bottom: 10px; }
.task-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.task-item-name { font-weight: 500; }
.task-item-status { font-weight: 700; }
.task-item-status.ok { color: var(--green); }
.task-item-status.fail { color: var(--red); }
.task-item-error { font-size: 12px; color: var(--text-muted); }
</style>
