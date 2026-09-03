<template>
  <div class="sessions-layout">
    <!-- 左侧会话列表 -->
    <aside class="session-list">
      <div class="session-list-header">
        <input v-model="search" class="search-input" placeholder="搜索会话..." />
        <button class="btn btn-sm btn-primary" @click="showForm = true">+ 新建</button>
      </div>
      <div class="session-items">
        <div
          v-for="s in filteredSessions"
          :key="s.id"
          class="session-item"
          :class="{ active: activeId === s.id }"
          @click="selectSession(s.id)"
        >
          <div class="session-item-content">
            <div class="session-item-title">{{ s.title }}</div>
            <div class="session-item-meta">
              <span class="status-dot" :class="`status-${s.status}`"></span>
              {{ s.connectionName || s.connectionId.slice(0, 8) }}
            </div>
          </div>
          <div class="session-item-actions" @click.stop>
            <button class="session-action-btn" @click="startRename(s)" title="重命名">✎</button>
            <button class="session-action-btn danger" @click="confirmDelete(s)" title="删除">✕</button>
          </div>
        </div>
        <div v-if="filteredSessions.length === 0" class="session-empty">
          {{ search ? '无匹配会话' : '暂无会话' }}
        </div>
      </div>
    </aside>

    <!-- 右侧聊天区 -->
    <main class="chat-area">
      <template v-if="activeId">
        <!-- 聊天头部 -->
        <header class="chat-header">
          <div>
            <div class="chat-title">{{ activeSession?.title }}</div>
            <div class="chat-subtitle">
              {{ activeSession?.connectionName || activeSession?.connectionId?.slice(0, 8) }}
              · <span class="status-dot" :class="`status-${activeSession?.status}`"></span>{{ activeSession?.status }}
            </div>
          </div>
          <div class="chat-header-right">
            <button class="btn btn-sm" @click="reloadHistory" :disabled="!activeId" title="重新加载消息历史">↻</button>
            <span class="chat-status" :class="streaming ? 'streaming' : ''">
              {{ streaming ? '● 接收中...' : '○ 空闲' }}
            </span>
          </div>
        </header>

        <!-- 消息列表 -->
        <div class="messages" ref="msgEl">
          <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg-${m.role}`">
            <div class="msg-head">
              <span class="msg-role">{{ m.role === 'user' ? '你' : (m.role === 'system' ? '系统' : 'Agent') }}</span>
              <span v-if="m.ts" class="msg-ts">{{ formatTs(m.ts) }}</span>
              <span v-if="m.role === 'user' && m.status" class="msg-status" :class="m.status">
                {{ m.status === 'sending' ? '发送中' : m.status === 'error' ? '失败' : '已发' }}
              </span>
            </div>
            <div class="msg-body">
              <template v-if="m.role === 'assistant' && !m.content && m.streaming">
                <span class="typing"><i></i><i></i><i></i></span>
              </template>
              <pre v-else-if="m.role === 'system'" class="msg-system">{{ m.content }}</pre>
              <div v-else-if="m.role === 'assistant' && !m.streaming" class="md" v-html="renderMd(m.content)"></div>
              <span v-else class="msg-text">{{ m.content }}</span>
            </div>
            <div v-if="m.role === 'assistant' && !m.streaming && m.content" class="msg-actions">
              <button class="msg-copy-btn" @click="copyMsg(m.content)" title="复制">⎘</button>
            </div>
          </div>
          <!-- 思考中指示器 (Agent 正在处理但尚未返回任何 token) -->
          <div v-if="streaming && !hasAssistantToken" class="msg msg-assistant">
            <div class="msg-body">
              <span class="thinking">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-text">正在思考...</span>
              </span>
            </div>
          </div>
          <div v-if="messages.length === 0" class="chat-empty">
            <div class="empty-icon">◈</div>
            <div>开始对话吧</div>
            <div style="margin-top:6px;font-size:13px">发送消息与智能体交互</div>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="chat-input">
          <textarea
            v-model="input"
            placeholder="输入消息, Enter 发送, Shift+Enter 换行"
            @keydown.enter.exact.prevent="send"
            @input="autoResize"
            :disabled="streaming"
            rows="2"
            ref="inputEl"
          ></textarea>
          <button class="btn btn-primary" @click="send" :disabled="streaming || !input.trim()">
            {{ streaming ? '...' : '发送' }}
          </button>
        </footer>
      </template>

      <!-- 未选会话 -->
      <div v-else class="chat-placeholder">
        <div class="empty-icon">◈</div>
        <div>选择一个会话开始对话</div>
      </div>
    </main>
  </div>

  <!-- 删除确认弹窗 -->
  <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
    <div class="card modal">
      <h2>删除会话</h2>
      <div class="delete-confirm">
        <p>确定要删除会话 <strong>{{ deleteTarget.title }}</strong> 吗?</p>
        <p class="delete-warn">此操作不可恢复, 会话及其所有消息将被永久删除。</p>
      </div>
      <div class="modal-actions">
        <button class="btn" @click="deleteTarget = null">取消</button>
        <button class="btn btn-danger" @click="deleteSession">删除</button>
      </div>
    </div>
  </div>

  <!-- 重命名弹窗 -->
  <div v-if="renameTarget" class="modal-overlay" @click.self="renameTarget = null">
    <div class="card modal">
      <h2>重命名会话</h2>
      <div class="form-row">
        <label>新标题</label>
        <input v-model="renameTitle" @keydown.enter.exact.prevent="confirmRename" placeholder="输入新标题" />
      </div>
      <div class="modal-actions">
        <button class="btn" @click="renameTarget = null">取消</button>
        <button class="btn btn-primary" @click="confirmRename" :disabled="!renameTitle.trim()">保存</button>
      </div>
    </div>
  </div>

  <!-- 新建会话弹窗 -->
  <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
    <div class="card modal">
      <h2>新建会话</h2>
      <div class="form-row">
        <label>智能体</label>
        <select v-model="form.connectionId">
          <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }} ({{ c.kind }})</option>
        </select>
      </div>
      <div class="form-row">
        <label>标题</label>
        <input v-model="form.title" placeholder="如: 实现 feature-X" @keydown.enter.exact.prevent="create" />
      </div>
      <div class="modal-actions">
        <button class="btn" @click="showForm = false">取消</button>
        <button class="btn btn-primary" @click="create" :disabled="!form.connectionId">创建</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
// marked 懒加载 — 减少首 chunk ~20 kB
let _marked: typeof import('marked') | null = null;
async function getMarked() {
  if (!_marked) {
    _marked = await import('marked');
    _marked.marked.setOptions({ gfm: true, breaks: true });
  }
  return _marked.marked;
}
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();

// ── 数据 ──
const sessions = ref<any[]>([]);
const connections = ref<any[]>([]);
const activeId = ref('');
const messages = ref<any[]>([]);
const input = ref('');
const search = ref('');
const streaming = ref(false);
const showForm = ref(false);
const msgEl = ref<HTMLElement>();
const inputEl = ref<HTMLElement>();
const form = reactive({ connectionId: '', title: '' });

// ── 删除 ──
const deleteTarget = ref<any>(null);
function confirmDelete(s: any) { deleteTarget.value = s; }
async function deleteSession() {
  if (!deleteTarget.value) return;
  const id = deleteTarget.value.id;
  deleteTarget.value = null;
  try {
    await api.delete(`/sessions/${id}`);
    if (activeId.value === id) { activeId.value = ''; messages.value = []; }
    await fetch();
  } catch (e: any) {
    toast.error(`删除失败: ${e.message}`);
  }
}

// ── 重命名 ──
const renameTarget = ref<any>(null);
const renameTitle = ref('');
function startRename(s: any) { renameTarget.value = s; renameTitle.value = s.title; }
async function confirmRename() {
  if (!renameTarget.value || !renameTitle.value.trim()) return;
  try {
    await api.patch(`/sessions/${renameTarget.value.id}`, { title: renameTitle.value.trim() });
    renameTarget.value = null;
    renameTitle.value = '';
    await fetch();
  } catch (e: any) {
    toast.error(`重命名失败: ${e.message}`);
  }
}

let evtSource: EventSource | null = null;
let currentStreamId = '';

// ── 计算属性 ──
const filteredSessions = computed(() => {
  if (!search.value) return sessions.value;
  const q = search.value.toLowerCase();
  return sessions.value.filter((s) => s.title.toLowerCase().includes(q));
});

const activeSession = computed(() => sessions.value.find((s) => s.id === activeId.value));

// Agent 是否已返回任何 token (用于显示"思考中"动画)
const hasAssistantToken = computed(() => {
  return messages.value.some((m) => m.role === 'assistant' && m.streaming && m.content);
});

// ── 数据加载 ──
async function fetch() {
  const raw = await api.get<any[]>('/sessions');
  connections.value = await api.get<any[]>('/connections');
  // API 返回 snake_case (connection_id), 映射为 camelCase 供模板安全使用
  sessions.value = raw.map((s) => ({
    ...s,
    connectionId: s.connection_id ?? s.connectionId,
  }));
  // 给会话加上连接名称
  for (const s of sessions.value) {
    const c = connections.value.find((c) => c.id === s.connectionId);
    s.connectionName = c?.name || '';
  }
}

async function create() {
  await api.post('/sessions', { connectionId: form.connectionId, title: form.title });
  showForm.value = false;
  form.title = '';
  form.connectionId = '';
  await fetch();
}

// ── 会话切换 ──
async function selectSession(id: string) {
  if (activeId.value === id) return;
  closeStream();
  activeId.value = id;
  await reloadHistory();
}

async function reloadHistory() {
  if (!activeId.value) return;
  messages.value = [];
  // 加载历史消息
  try {
    const res = await api.get<{ messages: any[] }>(`/sessions/${activeId.value}/messages`);
    messages.value = res.messages.map((m) => ({ role: m.role, content: m.content, streaming: false, ts: m.timestamp }));
    scrollToBottom();
  } catch (e: any) {
    messages.value.push({ role: 'system', content: `历史消息加载失败: ${e.message}`, streaming: false, ts: Date.now() });
  }
}

// ── SSE 流 ──
function closeStream() {
  if (evtSource) {
    evtSource.close();
    evtSource = null;
  }
  streaming.value = false;
}

function connectStream(streamId: string) {
  closeStream();
  currentStreamId = streamId;

  const url = `/api/sessions/${activeId.value}/stream?streamId=${streamId}`;
  evtSource = new EventSource(url, { withCredentials: true });

  evtSource.addEventListener('meta', () => { /* 连接已建立 */ });

  evtSource.addEventListener('text.delta', (e: any) => {
    const data = JSON.parse(e.data);
    const last = messages.value[messages.value.length - 1];
    if (last && last.role === 'assistant' && last.streaming) {
      last.content += data.content || '';
    } else {
      messages.value.push({ role: 'assistant', content: data.content || '', streaming: true, ts: Date.now() });
    }
    scrollToBottom();
  });

  evtSource.addEventListener('tool.start', (e: any) => {
    const data = JSON.parse(e.data);
    messages.value.push({ role: 'system', content: `🔧 调用工具: ${data.tool}`, streaming: false, ts: Date.now() });
    scrollToBottom();
  });

  evtSource.addEventListener('tool.result', (e: any) => {
    const data = JSON.parse(e.data);
    const last = messages.value[messages.value.length - 1];
    if (last?.role === 'system') {
      last.content += data.ok ? ' ✓' : ' ✗';
    }
  });

  evtSource.addEventListener('done', () => {
    const last = messages.value[messages.value.length - 1];
    if (last?.streaming) last.streaming = false;
    closeStream();
  });

  evtSource.addEventListener('error', () => {
    const last = messages.value[messages.value.length - 1];
    if (last?.streaming) {
      last.content += '\n[连接中断]';
      last.streaming = false;
    }
    closeStream();
  });

  evtSource.onerror = () => { closeStream(); };
}

// ── 发送消息 ──
async function send() {
  const text = input.value.trim();
  if (!text || streaming.value || !activeId.value) return;

  const userMsg = { role: 'user', content: text, streaming: false, ts: Date.now(), status: 'sending' };
  messages.value.push(userMsg);
  input.value = '';
  streaming.value = true;
  // 重置 textarea 高度
  nextTick(() => {
    const el = inputEl.value as HTMLTextAreaElement | undefined;
    if (el) el.style.height = 'auto';
  });
  scrollToBottom();

  try {
    const resp = await api.post<{ ok: boolean; streamId: string; response?: string }>(
      `/sessions/${activeId.value}/messages`,
      { text, stream: true }
    );
    // 标记用户消息为已发
    userMsg.status = 'sent';
    if (resp.response) {
      // 同步响应: 直接显示 Agent 回复
      messages.value.push({ role: 'assistant', content: resp.response, streaming: false, ts: Date.now() });
      streaming.value = false;
      scrollToBottom();
    } else if (resp.streamId) {
      connectStream(resp.streamId);
    } else {
      streaming.value = false;
    }
  } catch (err: any) {
    userMsg.status = 'error';
    messages.value.push({ role: 'system', content: `发送失败: ${err.message}`, streaming: false });
    streaming.value = false;
  }
}

// ── 复制消息 ──
function copyMsg(content: string) {
  navigator.clipboard.writeText(content).then(() => {
    // 可以加一个 toast, 这里简单处理
  }).catch(() => {
    // fallback: 创建临时 textarea
    const ta = document.createElement('textarea');
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ── Textarea 自动高度 ──
function autoResize() {
  nextTick(() => {
    const el = inputEl.value as HTMLTextAreaElement | undefined;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  });
}

// ── 时间格式化 ──
function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return hm;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

// ── Markdown 渲染 (懒加载 marked) ──
const markedLoaded = ref(false);
onMounted(async () => { await getMarked(); markedLoaded.value = true; });
function renderMd(content: string): string {
  if (!content) return '';
  // markedLoaded 被 Vue 追踪 → marked 加载完后自动重渲染
  if (!markedLoaded.value) return escapeHtml(content);
  try { return _marked!.marked.parse(content) as string; } catch { return escapeHtml(content);
  }
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c: string) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

// ── 滚动 ──
function scrollToBottom() {
  nextTick(() => {
    if (msgEl.value) msgEl.value.scrollTop = msgEl.value.scrollHeight;
  });
}

// ── 生命周期 ──
onMounted(fetch);
onUnmounted(closeStream);
</script>

<style scoped>
/* ── 布局 ── */
.sessions-layout {
  display: flex;
  height: calc(100vh - 44px - 48px); /* 减去 topbar 和 main padding */
  margin: -24px -28px; /* 溢出 main 的 padding */
}

/* ── 左侧会话列表 ── */
.session-list {
  width: 260px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
}

.session-list-header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.search-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}

.search-input:focus { border-color: var(--accent); }

.session-items {
  flex: 1;
  overflow-y: auto;
}

.session-item {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}

.session-item { display: flex; align-items: center; gap: 4px; }
.session-item:hover { background: var(--accent-light); }
.session-item.active { background: var(--accent-light); border-left: 3px solid var(--accent); }

.session-item-content { flex: 1; min-width: 0; padding: 12px 14px; }

.session-item-title {
  font-weight: 500;
  font-size: 13px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}

.session-item-actions {
  display: flex;
  gap: 2px;
  padding-right: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.session-item:hover .session-item-actions,
.session-item.active .session-item-actions { opacity: 1; }

.session-action-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.session-action-btn:hover { background: var(--surface-hover); color: var(--text); }
.session-action-btn.danger:hover { background: var(--red-dim); color: var(--red); }

.session-empty {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-muted);
  font-size: 13px;
}

/* ── 右侧聊天区 ── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.chat-title { font-weight: 600; font-size: 14px; }
.chat-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.chat-status { font-size: 12px; color: var(--text-muted); }
.chat-status.streaming { color: var(--green); }
.chat-header-right { display: flex; align-items: center; gap: 10px; }

/* ── 消息列表 ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.msg {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msg-user .msg-head { justify-content: flex-end; }

.msg-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
}
.msg-status.sending { background: var(--accent-light); color: var(--accent); }
.msg-status.sent { background: var(--green-dim); color: var(--green); }
.msg-status.error { background: var(--red-dim); color: var(--red); }

.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.msg:hover .msg-actions { opacity: 1; }
.msg-copy-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.15s;
}
.msg-copy-btn:hover { background: var(--surface-hover); color: var(--text); }

.msg-ts { font-size: 11px; color: var(--text-muted); opacity: 0.7; }

.msg-role {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.msg-body {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-user .msg-body { background: var(--accent); color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
.msg-assistant .msg-body { background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.msg-system .msg-body { background: transparent; color: var(--text-muted); font-size: 12px; padding: 4px 0; max-width: 100%; }
.msg-system .msg-head { display: none; }

.msg-text { display: inline; }
.msg-system { margin: 0; white-space: pre-wrap; font: inherit; }

/* ── Markdown 渲染样式 ── */
.md { line-height: 1.7; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 0.4em 0; }
.md h1, .md h2, .md h3, .md h4 { margin: 0.8em 0 0.3em; line-height: 1.3; }
.md h1 { font-size: 1.3em; } .md h2 { font-size: 1.2em; } .md h3 { font-size: 1.1em; }
.md ul, .md ol { margin: 0.4em 0; padding-left: 1.5em; }
.md li { margin: 0.2em 0; }
.md code {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.9em;
  font-family: Consolas, 'Courier New', monospace;
}
.md pre {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.6em 0;
}
.md pre code { background: transparent; border: none; padding: 0; font-size: 12px; }
.md blockquote {
  margin: 0.5em 0;
  padding-left: 12px;
  border-left: 3px solid var(--border);
  color: var(--text-muted);
}
.md a { color: var(--accent); }
.md table { border-collapse: collapse; margin: 0.6em 0; }
.md th, .md td { border: 1px solid var(--border); padding: 5px 10px; font-size: 12px; }
.md th { background: var(--accent-light); }
.md hr { border: none; border-top: 1px solid var(--border); margin: 0.8em 0; }

/* 打字动画 · 三点跳动 */
.typing { display: inline-flex; gap: 4px; padding: 4px 2px; }
.typing i {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: dot-bounce 1.2s infinite ease-in-out;
}
.typing i:nth-child(2) { animation-delay: 0.15s; }
.typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* 思考中动画 */
.thinking { display: inline-flex; align-items: center; gap: 6px; padding: 6px 2px; }
.thinking-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: thinking-pulse 1.4s infinite ease-in-out;
}
.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }
.thinking-text { font-size: 12px; color: var(--text-muted); margin-left: 2px; }
@keyframes thinking-pulse {
  0%, 60%, 100% { transform: scale(0.6); opacity: 0.3; }
  30% { transform: scale(1); opacity: 1; }
}

/* ── 输入区 ── */
.chat-input {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  align-items: flex-end;
}

.chat-input textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  line-height: 1.5;
}

.chat-input textarea:focus { border-color: var(--accent); }
.chat-input textarea:disabled { background: var(--bg); opacity: 0.6; }

/* ── 占位 ── */
.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 8px;
}

.chat-empty {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}

/* ── 弹窗 ── */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

/* ── 删除确认 ── */
.delete-confirm p { margin-bottom: 8px; font-size: 13px; }
.delete-warn { color: var(--red); font-size: 12px; }

.btn-danger {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
}
.btn-danger:hover {
  background: #dc2626;
  border-color: #dc2626;
  color: #fff;
}
</style>
