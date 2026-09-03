<template>
  <div class="teams-page">
    <div class="page-header">
      <h1 class="page-title">团队</h1>
      <button class="btn btn-primary" @click="showForm = true">+ 创建团队</button>
    </div>

    <div v-if="teams.length === 0" class="empty">
      <div class="empty-icon">⬢</div>
      <div>暂无团队</div>
      <div style="margin-top:8px;font-size:13px">把多个智能体组成团队, 协作完成任务</div>
      <button class="btn btn-primary" style="margin-top:16px" @click="showForm = true">创建第一个团队</button>
    </div>

    <div v-else class="team-grid">
      <div v-for="t in teams" :key="t.id" class="card team-card" @click="viewTeam(t)">
        <div class="team-head">
          <span class="team-name">{{ t.name }}</span>
          <span class="team-version">v{{ t.version }}</span>
        </div>
        <div class="team-desc" v-if="t.description">{{ t.description }}</div>
        <div class="team-stats">
          <span>{{ t.members.length }} 成员</span>
          <span>·</span>
          <span>{{ onlineCount(t) }} 在线</span>
        </div>
        <div class="team-members" v-if="t.members.length > 0">
          <span v-for="m in t.members.slice(0, 5)" :key="m.connectionId" class="member-chip" :class="`role-${m.role}`">
            {{ roleLabel(m.role) }} · {{ m.connectionId.slice(0, 8) }}
          </span>
          <span v-if="t.members.length > 5" class="member-more">+{{ t.members.length - 5 }}</span>
        </div>
      </div>
    </div>

    <!-- 团队详情 Modal -->
    <div v-if="selectedTeam" class="modal-overlay" @click.self="selectedTeam = null">
      <div class="card modal modal-large">
        <div class="modal-header">
          <h2>{{ selectedTeam.name }}</h2>
          <span class="team-version">v{{ selectedTeam.version }}</span>
        </div>
        <p class="team-desc-full" v-if="selectedTeam.description">{{ selectedTeam.description }}</p>

        <!-- 成员管理 -->
        <div class="detail-section">
          <label>成员 ({{ selectedTeam.members.length }})</label>
          <div class="member-list" v-if="selectedTeam.members.length > 0">
            <div v-for="(m, idx) in selectedTeam.members" :key="idx" class="member-row">
              <span class="member-role" :class="`role-${m.role}`">{{ roleLabel(m.role) }}</span>
              <span class="member-conn">{{ m.connectionId.slice(0, 16) }}</span>
              <span class="member-interop">{{ m.interop?.join(', ') }}</span>
              <button class="btn btn-sm btn-danger" @click="removeMember(idx)">移除</button>
            </div>
          </div>
          <div v-else class="text-muted">暂无成员</div>

          <!-- 添加成员 -->
          <div class="add-member-row" v-if="!showAddMember">
            <button class="btn btn-sm" @click="showAddMember = true">+ 添加成员</button>
          </div>
          <div v-else class="add-member-form">
            <select v-model="newMember.connectionId">
              <option value="">选择实例</option>
              <option v-for="c in availableConnections" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <select v-model="newMember.role">
              <option value="lead">Lead</option>
              <option value="worker">Worker</option>
              <option value="reviewer">Reviewer</option>
              <option value="observer">Observer</option>
            </select>
            <button class="btn btn-sm btn-primary" @click="addMember">添加</button>
            <button class="btn btn-sm" @click="showAddMember = false">取消</button>
          </div>
        </div>

        <!-- 发送消息 -->
        <div class="detail-section">
          <div class="section-header">
            <label>发送消息到团队</label>
            <button class="btn btn-sm" @click="showChat = true">💬 进入群聊</button>
          </div>
          <div class="send-msg-row">
            <select v-model="msgForm.to">
              <option value="">选择目标成员</option>
              <option v-for="m in selectedTeam.members" :key="m.connectionId" :value="m.connectionId">
                {{ roleLabel(m.role) }} · {{ m.connectionId.slice(0, 12) }}
              </option>
            </select>
            <select v-model="msgForm.relay">
              <option value="bff-bus">BFF 总线</option>
              <option value="native-tool">原生工具</option>
              <option value="channel-webhook">Webhook</option>
            </select>
          </div>
          <textarea v-model="msgForm.payload" placeholder="消息内容..." rows="2"></textarea>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" @click="sendMessage">发送</button>
        </div>

        <!-- 团队运行记录 -->
        <div class="detail-section" v-if="teamRuns.length > 0">
          <label>最近运行</label>
          <div class="run-mini-list">
            <div v-for="r in teamRuns" :key="r.id" class="run-mini" @click="goToRun(r.id)">
              <span class="run-status-dot" :class="`status-${r.status}`"></span>
              <span class="run-id-mini">{{ r.id.slice(0, 10) }}</span>
              <span class="run-strategy-mini">{{ r.strategy }}</span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" @click="showChat = true">💬 群聊</button>
          <button class="btn" @click="selectedTeam = null">关闭</button>
          <button class="btn btn-danger" @click="deleteTeam">删除团队</button>
        </div>
      </div>
    </div>

    <!-- 群聊界面 -->
    <div v-if="showChat && selectedTeam">
      <TeamChat :team="selectedTeam" @close="showChat = false" />
    </div>

    <!-- 创建团队 Modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="card modal">
        <h2>创建团队</h2>
        <div class="form-row">
          <label>名称</label>
          <input v-model="form.name" placeholder="如: 研发三人组" />
        </div>
        <div class="form-row">
          <label>描述</label>
          <input v-model="form.description" placeholder="团队目标" />
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
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';
import TeamChat from '../components/TeamChat.vue';

const toast = useToast();
const router = useRouter();
const teams = ref<any[]>([]);
const connections = ref<any[]>([]);
const showForm = ref(false);
const selectedTeam = ref<any>(null);
const showAddMember = ref(false);
const showChat = ref(false);
const teamRuns = ref<any[]>([]);

const form = reactive({ name: '', description: '' });
const newMember = reactive({ connectionId: '', role: 'worker' });
const msgForm = reactive({ to: '', relay: 'bff-bus', payload: '' });

async function fetch() {
  teams.value = await api.get('/teams');
  connections.value = await api.get('/connections');
}

async function create() {
  await api.post('/teams', { name: form.name, description: form.description, members: [] });
  showForm.value = false;
  form.name = '';
  form.description = '';
  toast.success('团队已创建');
  await fetch();
}

async function deleteTeam() {
  if (!selectedTeam.value) return;
  await api.delete(`/teams/${selectedTeam.value.id}`);
  selectedTeam.value = null;
  toast.success('团队已删除');
  await fetch();
}

function viewTeam(t: any) {
  selectedTeam.value = t;
  showAddMember.value = false;
  fetchTeamRuns(t.id);
}

async function fetchTeamRuns(teamId: string) {
  try {
    teamRuns.value = await api.get(`/runs?teamId=${teamId}&limit=5`);
  } catch { teamRuns.value = []; }
}

function goToRun(runId: string) {
  router.push('/runs');
}

async function addMember() {
  if (!selectedTeam.value || !newMember.connectionId) return;
  const members = [...selectedTeam.value.members, {
    connectionId: newMember.connectionId,
    role: newMember.role,
    interop: ['bff-bus'],
    status: 'offline',
  }];
  await api.patch(`/teams/${selectedTeam.value.id}`, { members });
  selectedTeam.value = { ...selectedTeam.value, members };
  showAddMember.value = false;
  newMember.connectionId = '';
  newMember.role = 'worker';
  toast.success('成员已添加');
  await fetch();
}

async function removeMember(idx: number) {
  if (!selectedTeam.value) return;
  const members = selectedTeam.value.members.filter((_: any, i: number) => i !== idx);
  await api.patch(`/teams/${selectedTeam.value.id}`, { members });
  selectedTeam.value = { ...selectedTeam.value, members };
  toast.success('成员已移除');
  await fetch();
}

async function sendMessage() {
  if (!selectedTeam.value || !msgForm.to || !msgForm.payload) return;
  try {
    const res = await api.post(`/teams/${selectedTeam.value.id}/message`, {
      to: msgForm.to,
      relay: msgForm.relay,
      payload: { text: msgForm.payload },
    });
    toast.success(`消息已发送 (trace: ${(res as any)?.traceId ?? 'n/a'})`);
    msgForm.payload = '';
    msgForm.to = '';
  } catch (e: any) {
    toast.error('发送失败: ' + (e.message ?? '未知错误'));
  }
}

const availableConnections = computed(() =>
  connections.value.filter((c) =>
    !selectedTeam.value?.members?.some((m: any) => m.connectionId === c.id)
  )
);

function roleLabel(r: string) {
  const map: Record<string, string> = { lead: 'Lead', worker: 'Worker', reviewer: 'Reviewer', observer: 'Observer' };
  return map[r] ?? r;
}

function onlineCount(t: any) {
  return t.members?.filter((m: any) => m.status === 'online').length ?? 0;
}

onMounted(fetch);
</script>

<style scoped>
.teams-page { max-width: 900px; }
.team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.team-card { padding: 16px; cursor: pointer; transition: all 0.2s; }
.team-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(99, 102, 241, 0.1); }
.team-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.team-name { font-weight: 600; font-size: 15px; }
.team-version { font-size: 11px; color: var(--text-muted); background: var(--bg); padding: 2px 6px; border-radius: 4px; }
.team-desc { color: var(--text-muted); font-size: 13px; margin-bottom: 8px; }
.team-stats { font-size: 12px; color: var(--text-muted); display: flex; gap: 6px; margin-bottom: 10px; }
.team-members { display: flex; gap: 6px; flex-wrap: wrap; }
.member-chip { background: var(--bg); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.role-lead { border-color: rgba(99, 102, 241, 0.4); background: rgba(99, 102, 241, 0.05); }
.role-worker { border-color: rgba(34, 197, 94, 0.3); background: rgba(34, 197, 94, 0.05); }
.role-reviewer { border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.05); }
.role-observer { border-color: rgba(156, 163, 175, 0.3); background: rgba(156, 163, 175, 0.05); }
.member-more { font-size: 11px; color: var(--text-muted); align-self: center; }

.modal-large { width: 580px; max-height: 80vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.modal-header h2 { margin-bottom: 0; }
.team-desc-full { color: var(--text-muted); font-size: 13px; margin-bottom: 18px; }

.detail-section { margin-bottom: 18px; }
.detail-section label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 600; }
.member-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.member-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--bg); border-radius: 6px; font-size: 12px; }
.member-role { padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
.member-conn { font-family: monospace; flex: 1; }
.member-interop { font-size: 11px; color: var(--text-muted); }

.add-member-row { margin-top: 8px; }
.add-member-form { display: flex; gap: 6px; margin-top: 8px; }
.add-member-form select { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }

.send-msg-row { display: flex; gap: 6px; margin-bottom: 8px; }
.send-msg-row select { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
.send-msg-row textarea { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; resize: vertical; }

.run-mini-list { display: flex; flex-direction: column; gap: 4px; }
.run-mini { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.run-mini:hover { background: var(--bg); }
.run-status-dot { width: 6px; height: 6px; border-radius: 50%; }
.run-id-mini { font-family: monospace; }
.run-strategy-mini { color: var(--text-muted); font-size: 11px; }

.status-queued { background: #9ca3af; }
.status-running { background: #3b82f6; }
.status-done { background: #22c55e; }
.status-failed { background: #ef4444; }
.status-cancelled { background: #6b7280; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.section-header label { margin: 0; }
</style>
