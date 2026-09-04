<template>
  <div class="agent-chat-page">
    <h1>Agent 聊天中心</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总会话</div>
        <div class="stat-value">{{ stats.totalSessions ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃会话</div>
        <div class="stat-value">{{ stats.activeSessions ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总消息</div>
        <div class="stat-value">{{ stats.totalMessages ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总 Token</div>
        <div class="stat-value">{{ formatTokens(stats.totalTokensIn + stats.totalTokensOut) }}</div>
      </div>
    </div>

    <div class="chat-layout">
      <!-- 左侧会话列表 -->
      <div class="chat-sidebar">
        <div class="chat-sidebar-header">
          <h3>会话列表</h3>
          <button @click="showCreateModal = true" title="新建会话">+</button>
        </div>
        <div class="session-list">
          <div v-if="!sessions.length" class="empty-sm">暂无会话</div>
          <div
            v-for="s in sessions" :key="s.id"
            class="session-item" :class="{ active: currentSession?.id === s.id }"
            @click="selectSession(s)"
          >
            <div class="session-title">{{ s.title }}</div>
            <div class="session-meta">{{ s.messageCount ?? 0 }} 消息 · {{ formatTs(s.updatedAt) }}</div>
          </div>
        </div>
      </div>

      <!-- 右侧聊天区 -->
      <div class="chat-main">
        <div v-if="!currentSession" class="chat-empty">
          <div class="empty-icon">💬</div>
          <p>选择一个会话或创建新会话开始聊天</p>
        </div>
        <template v-else>
          <div class="chat-header">
            <h3>{{ currentSession.title }}</h3>
            <div class="chat-actions">
              <button @click="showRenameModal = true" title="重命名">✎</button>
              <button @click="archiveSession" title="归档">📁</button>
              <button @click="deleteSession" title="删除">✕</button>
            </div>
          </div>

          <div class="chat-messages" ref="messagesEl">
            <div v-if="!messages.length" class="empty-sm">暂无消息，发送第一条消息开始对话</div>
            <div
              v-for="msg in messages" :key="msg.id"
              class="message" :class="`msg-${msg.role}`"
            >
              <div class="msg-avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
              <div class="msg-body">
                <div class="msg-content">{{ msg.content }}</div>
                <div class="msg-meta">
                  <span v-if="msg.tokensIn" class="msg-token">↑{{ msg.tokensIn }}</span>
                  <span v-if="msg.tokensOut" class="msg-token">↓{{ msg.tokensOut }}</span>
                  <span class="msg-time">{{ formatTs(msg.createdAt) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="chat-input">
            <textarea
              v-model="inputText"
              @keydown.enter.exact.prevent="sendMessage"
              placeholder="输入消息... (Enter 发送)"
              rows="1"
            ></textarea>
            <button @click="sendMessage" :disabled="!inputText.trim() || sending">
              {{ sending ? '...' : '发送' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 创建会话 Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="card modal">
        <h3>创建新会话</h3>
        <div class="form-group">
          <label>会话标题</label>
          <input v-model="newSession.title" placeholder="新对话" />
        </div>
        <div class="form-group">
          <label>系统提示词 (可选)</label>
          <textarea v-model="newSession.systemPrompt" placeholder="设定 Agent 角色..." rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>模型 (可选)</label>
          <input v-model="newSession.model" placeholder="自动" />
        </div>
        <div class="toolbar">
          <button @click="showCreateModal = false">取消</button>
          <button class="btn-primary" @click="createSession">创建</button>
        </div>
      </div>
    </div>

    <!-- 重命名 Modal -->
    <div v-if="showRenameModal" class="modal-overlay" @click.self="showRenameModal = false">
      <div class="card modal">
        <h3>重命名会话</h3>
        <div class="form-group">
          <label>新标题</label>
          <input v-model="renameText" />
        </div>
        <div class="toolbar">
          <button @click="showRenameModal = false">取消</button>
          <button class="btn-primary" @click="renameSession">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();
const sessions = ref<any[]>([]);
const currentSession = ref<any>(null);
const messages = ref<any[]>([]);
const stats = ref<any>({});
const inputText = ref('');
const sending = ref(false);
const showCreateModal = ref(false);
const showRenameModal = ref(false);
const renameText = ref('');
const messagesEl = ref<HTMLElement>();
const newSession = ref({ title: '新对话', systemPrompt: '', model: '' });

async function loadSessions() {
  try {
    sessions.value = await api.get('/agent-chat/sessions');
  } catch { /* ignore */ }
}

async function loadStats() {
  try {
    stats.value = await api.get('/agent-chat/stats');
  } catch { /* ignore */ }
}

async function selectSession(s: any) {
  currentSession.value = s;
  try {
    messages.value = await api.get(`/agent-chat/sessions/${s.id}/messages`);
    await nextTick();
    scrollToBottom();
  } catch { /* ignore */ }
}

async function createSession() {
  try {
    const created = await api.post('/agent-chat/sessions', {
      title: newSession.value.title || '新对话',
      systemPrompt: newSession.value.systemPrompt || undefined,
      model: newSession.value.model || undefined,
    });
    sessions.value.unshift(created);
    showCreateModal.value = false;
    newSession.value = { title: '新对话', systemPrompt: '', model: '' };
    toast.success('会话已创建');
    selectSession(created);
  } catch { toast.error('创建失败'); }
}

async function sendMessage() {
  if (!inputText.value.trim() || !currentSession.value || sending.value) return;
  sending.value = true;
  try {
    const result = await api.post(`/agent-chat/sessions/${currentSession.value.id}/messages`, {
      content: inputText.value.trim(),
    }) as { userMessage: any; assistantMessage: any };
    messages.value.push(result.userMessage);
    messages.value.push(result.assistantMessage);
    inputText.value = '';
    await nextTick();
    scrollToBottom();
    loadStats();
  } catch { toast.error('发送失败'); }
  sending.value = false;
}

function scrollToBottom() {
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

async function renameSession() {
  if (!renameText.value.trim()) return;
  try {
    await api.patch(`/agent-chat/sessions/${currentSession.value.id}`, { title: renameText.value.trim() });
    currentSession.value.title = renameText.value.trim();
    showRenameModal.value = false;
    toast.success('已重命名');
    loadSessions();
  } catch { toast.error('重命名失败'); }
}

async function archiveSession() {
  try {
    await api.patch(`/agent-chat/sessions/${currentSession.value.id}`, { status: 'archived' });
    currentSession.value = null;
    messages.value = [];
    toast.success('会话已归档');
    loadSessions();
  } catch { toast.error('归档失败'); }
}

async function deleteSession() {
  if (!confirm('确认删除此会话?')) return;
  try {
    await api.delete(`/agent-chat/sessions/${currentSession.value.id}`);
    currentSession.value = null;
    messages.value = [];
    toast.success('会话已删除');
    loadSessions();
  } catch { toast.error('删除失败'); }
}

function formatTs(ts: number) {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatTokens(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

onMounted(() => { loadSessions(); loadStats(); });
</script>

<style scoped>
.chat-layout { display: flex; gap: 16px; height: calc(100vh - 200px); min-height: 400px; }
.chat-sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.chat-sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.chat-sidebar-header h3 { margin: 0; font-size: 14px; }
.chat-sidebar-header button { background: var(--accent); color: #fff; border: none; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 16px; }
.session-list { flex: 1; overflow-y: auto; }
.session-item { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border); }
.session-item:hover { background: var(--surface-hover); }
.session-item.active { background: var(--accent-alpha); border-left: 3px solid var(--accent); }
.session-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.chat-main { flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.chat-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.chat-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.chat-header h3 { margin: 0; font-size: 14px; }
.chat-actions button { background: none; border: 1px solid var(--border); border-radius: 4px; width: 28px; height: 28px; cursor: pointer; margin-left: 4px; }
.chat-actions button:hover { background: var(--surface-hover); }
.chat-messages { flex: 1; overflow-y: auto; padding: 16px; }
.message { display: flex; gap: 10px; margin-bottom: 16px; }
.msg-avatar { width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--surface); font-size: 16px; }
.msg-body { flex: 1; }
.msg-content { font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.msg-meta { margin-top: 4px; display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); }
.msg-token { opacity: 0.7; }
.msg-avatar { background: var(--accent-alpha); }
.msg-user .msg-avatar { background: var(--surface); }
.chat-input { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.chat-input textarea { flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; resize: none; font-size: 14px; background: var(--surface); color: var(--text); }
.chat-input button { padding: 8px 20px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.chat-input button:disabled { opacity: 0.5; cursor: default; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.form-group input, .form-group textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
</style>
