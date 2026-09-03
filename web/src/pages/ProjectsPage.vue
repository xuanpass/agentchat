<template>
  <div class="projects-page">
    <div class="page-header">
      <h1 class="page-title">项目</h1>
      <button class="btn btn-primary" @click="showForm = true">+ 新建项目</button>
    </div>

    <div v-if="projects.length === 0" class="empty">
      <div class="empty-icon">▣</div>
      <div>暂无项目</div>
      <div style="margin-top:8px;font-size:13px">把远程智能体的工作目录绑定到项目, 便于会话复用</div>
      <button class="btn btn-primary" style="margin-top:16px" @click="showForm = true">创建第一个项目</button>
    </div>

    <div v-else class="project-grid">
      <div v-for="p in projects" :key="p.id" class="card project-card" @click="viewProject(p)">
        <div class="project-head">
          <span class="project-name">{{ p.name }}</span>
          <span class="project-sessions">{{ p.sessions?.length ?? 0 }} 会话</span>
        </div>
        <div class="project-path" v-if="p.rootPath">{{ p.rootPath }}</div>
        <div class="project-meta">
          <span class="project-conn">◈ {{ connectionName(p.connectionId) }}</span>
          <span class="project-time">{{ formatTime(p.createdAt) }}</span>
        </div>
        <div class="project-tags" v-if="p.defaultModel || p.defaultAgent">
          <span v-if="p.defaultModel" class="tag">模型: {{ p.defaultModel }}</span>
          <span v-if="p.defaultAgent" class="tag">Agent: {{ p.defaultAgent }}</span>
        </div>
      </div>
    </div>

    <!-- 项目详情 Modal -->
    <div v-if="selectedProject" class="modal-overlay" @click.self="selectedProject = null">
      <div class="card modal modal-large">
        <div class="modal-header">
          <h2>{{ selectedProject.name }}</h2>
          <span class="project-version">v{{ selectedProject.version ?? 1 }}</span>
        </div>

        <div class="detail-grid">
          <div class="detail-item"><label>目录</label><span class="mono">{{ selectedProject.rootPath }}</span></div>
          <div class="detail-item"><label>实例</label><span>{{ connectionName(selectedProject.connectionId) }}</span></div>
          <div class="detail-item"><label>默认模型</label><span>{{ selectedProject.defaultModel ?? '-' }}</span></div>
          <div class="detail-item"><label>默认 Agent</label><span>{{ selectedProject.defaultAgent ?? '-' }}</span></div>
          <div class="detail-item"><label>创建时间</label><span>{{ formatTime(selectedProject.createdAt) }}</span></div>
          <div class="detail-item"><label>更新时间</label><span>{{ formatTime(selectedProject.updatedAt) }}</span></div>
        </div>

        <div class="detail-section" v-if="selectedProject.contextHint">
          <label>上下文提示</label>
          <pre class="context-box">{{ selectedProject.contextHint }}</pre>
        </div>

        <!-- 会话绑定 -->
        <div class="detail-section">
          <label>绑定会话 ({{ selectedProject.sessions?.length ?? 0 }})</label>
          <div class="session-list" v-if="selectedProject.sessions?.length > 0">
            <div v-for="s in selectedProject.sessions" :key="s.id" class="session-row">
              <span class="session-title">{{ s.title }}</span>
              <span class="session-status" :class="`status-${s.status}`">{{ s.status }}</span>
              <button class="btn btn-sm btn-danger" @click="unbindSession(s.id)">解绑</button>
            </div>
          </div>
          <div v-else class="text-muted">暂无绑定会话</div>

          <div class="add-session-row" v-if="!showAddSession">
            <button class="btn btn-sm" @click="showAddSession = true; fetchAvailableSessions()">+ 绑定会话</button>
          </div>
          <div v-else class="add-session-form">
            <select v-model="newSessionId">
              <option value="">选择会话</option>
              <option v-for="s in availableSessions" :key="s.id" :value="s.id">{{ s.title }}</option>
            </select>
            <button class="btn btn-sm btn-primary" @click="bindSession">绑定</button>
            <button class="btn btn-sm" @click="showAddSession = false">取消</button>
          </div>
        </div>

        <!-- 统计 -->
        <div class="detail-section">
          <label>项目统计</label>
          <div class="project-stats">
            <div class="pstat">
              <span class="pstat-num">{{ selectedProject.sessions?.length ?? 0 }}</span>
              <span class="pstat-label">总会话</span>
            </div>
            <div class="pstat">
              <span class="pstat-num">{{ activeSessionCount }}</span>
              <span class="pstat-label">活跃会话</span>
            </div>
            <div class="pstat">
              <span class="pstat-num">{{ projectRunCount }}</span>
              <span class="pstat-label">运行次数</span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" @click="selectedProject = null">关闭</button>
          <button class="btn btn-danger" @click="deleteProject">删除项目</button>
        </div>
      </div>
    </div>

    <!-- 新建项目 Modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="card modal">
        <h2>新建项目</h2>
        <div class="form-row">
          <label>名称</label>
          <input v-model="form.name" placeholder="如: agent-ops-console" />
        </div>
        <div class="form-row">
          <label>归属实例</label>
          <select v-model="form.connectionId">
            <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>远程机器上的目录路径</label>
          <input v-model="form.rootPath" placeholder="/home/user/workspace/my-project" />
        </div>
        <div class="form-row">
          <label>描述 (可选)</label>
          <input v-model="form.description" placeholder="项目描述" />
        </div>
        <div class="form-row">
          <label>默认模型 (可选)</label>
          <input v-model="form.defaultModel" placeholder="如: claude-sonnet-4-20250514" />
        </div>
        <div class="form-row">
          <label>上下文提示 (可选)</label>
          <textarea v-model="form.contextHint" placeholder="每次会话自动附加的上下文..." rows="3"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showForm = false">取消</button>
          <button class="btn btn-primary" @click="create">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();
const projects = ref<any[]>([]);
const connections = ref<any[]>([]);
const sessions = ref<any[]>([]);
const showForm = ref(false);
const selectedProject = ref<any>(null);
const showAddSession = ref(false);
const newSessionId = ref('');
const availableSessions = ref<any[]>([]);
const projectRuns = ref<any[]>([]);

const form = reactive({
  name: '', connectionId: '', rootPath: '', description: '', defaultModel: '', defaultAgent: '', contextHint: '',
});

async function fetch() {
  projects.value = await api.get('/projects');
  connections.value = await api.get('/connections');
  sessions.value = await api.get('/sessions');
}

async function create() {
  await api.post('/projects', form);
  showForm.value = false;
  Object.assign(form, { name: '', connectionId: '', rootPath: '', description: '', defaultModel: '', defaultAgent: '', contextHint: '' });
  toast.success('项目已创建');
  await fetch();
}

async function deleteProject() {
  if (!selectedProject.value) return;
  await api.delete(`/projects/${selectedProject.value.id}`);
  selectedProject.value = null;
  toast.success('项目已删除');
  await fetch();
}

function viewProject(p: any) {
  selectedProject.value = p;
  showAddSession.value = false;
  fetchProjectRuns(p.id);
}

async function fetchProjectRuns(projectId: string) {
  try {
    const allRuns = await api.get('/runs?limit=100');
    projectRuns.value = allRuns.filter((r: any) =>
      r.sessionIds?.some((sid: string) =>
        selectedProject.value?.sessions?.some((s: any) => s.id === sid)
      )
    );
  } catch { projectRuns.value = []; }
}

async function fetchAvailableSessions() {
  if (!selectedProject.value) return;
  const boundIds = new Set(selectedProject.value.sessions?.map((s: any) => s.id) ?? []);
  availableSessions.value = sessions.value.filter((s: any) =>
    s.connectionId === selectedProject.value.connectionId && !boundIds.has(s.id)
  );
}

async function bindSession() {
  if (!selectedProject.value || !newSessionId.value) return;
  const sessions = [...(selectedProject.value.sessions ?? []), { id: newSessionId.value, title: sessionTitle(newSessionId.value), status: 'idle' }];
  // 更新 project 的 sessions 字段
  const sessionIds = sessions.map((s: any) => s.id);
  await api.patch(`/projects/${selectedProject.value.id}`, { sessions: sessionIds });
  selectedProject.value = { ...selectedProject.value, sessions };
  showAddSession.value = false;
  newSessionId.value = '';
  toast.success('会话已绑定');
  await fetch();
}

async function unbindSession(sessionId: string) {
  if (!selectedProject.value) return;
  const sessions = (selectedProject.value.sessions ?? []).filter((s: any) => s.id !== sessionId);
  const sessionIds = sessions.map((s: any) => s.id);
  await api.patch(`/projects/${selectedProject.value.id}`, { sessions: sessionIds });
  selectedProject.value = { ...selectedProject.value, sessions };
  toast.success('会话已解绑');
  await fetch();
}

function sessionTitle(id: string) {
  return sessions.value.find((s: any) => s.id === id)?.title ?? id.slice(0, 12);
}

const activeSessionCount = computed(() =>
  selectedProject.value?.sessions?.filter((s: any) => s.status === 'running' || s.status === 'streaming').length ?? 0
);

const projectRunCount = computed(() => projectRuns.value.length);

function connectionName(id: string) {
  return connections.value.find((c: any) => c.id === id)?.name ?? id.slice(0, 8);
}

function formatTime(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(fetch);
</script>

<style scoped>
.projects-page { max-width: 900px; }
.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.project-card { padding: 16px; cursor: pointer; transition: all 0.2s; }
.project-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(99, 102, 241, 0.1); }
.project-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.project-name { font-weight: 600; font-size: 15px; }
.project-sessions { font-size: 12px; color: var(--text-muted); background: var(--bg); padding: 2px 8px; border-radius: 10px; }
.project-path { font-family: monospace; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
.project-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
.project-tags { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.tag { background: var(--bg); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; font-size: 11px; color: var(--text-muted); }

.modal-large { width: 580px; max-height: 80vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.modal-header h2 { margin-bottom: 0; }
.project-version { font-size: 11px; color: var(--text-muted); background: var(--bg); padding: 2px 6px; border-radius: 4px; }

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.detail-item label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.detail-item .mono { font-family: monospace; font-size: 12px; }

.detail-section { margin-bottom: 18px; }
.detail-section label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 600; }
.context-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-size: 13px; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }

.session-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.session-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--bg); border-radius: 6px; font-size: 13px; }
.session-title { flex: 1; }
.session-status { padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }

.status-idle { background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); }
.status-running { background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); }
.status-streaming { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3); }
.status-done { background: rgba(34, 197, 94, 0.1); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
.status-error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }

.add-session-row { margin-top: 8px; }
.add-session-form { display: flex; gap: 6px; margin-top: 8px; }
.add-session-form select { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }

.project-stats { display: flex; gap: 16px; }
.pstat { display: flex; flex-direction: column; align-items: center; padding: 8px 16px; background: var(--bg); border-radius: 6px; }
.pstat-num { font-size: 20px; font-weight: 700; }
.pstat-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 460px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input, .form-row select, .form-row textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.form-row textarea { resize: vertical; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
