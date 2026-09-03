<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="card modal modal-large team-chat-modal">
      <div class="chat-header">
        <div>
          <h3>{{ team.name }} · 群聊</h3>
          <span class="chat-subtitle">{{ members.length }} 成员 · 消息广播到全团队</span>
        </div>
        <button class="btn btn-sm" @click="$emit('close')">✕</button>
      </div>

      <!-- 消息列表 -->
      <div class="chat-messages" ref="msgList">
        <div v-if="messages.length === 0" class="chat-empty">
          发送消息开始群聊, 所有团队成员都会收到
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          :class="['msg-row', m.role === 'user' ? 'msg-user' : 'msg-agent']"
        >
          <div class="msg-avatar">
            {{ m.role === 'user' ? '我' : (m.agentLabel?.[0] || 'A') }}
          </div>
          <div class="msg-body">
            <div class="msg-meta">
              <span class="msg-sender">{{ m.label }}</span>
              <span class="msg-time">{{ formatTs(m.timestamp) }}</span>
            </div>
            <div class="msg-bubble">
              <div v-if="m.role === 'user'" class="msg-text">{{ m.content }}</div>
              <div v-else>
                <div class="msg-text">{{ m.content }}</div>
                <div v-if="m.members && m.members.length" class="msg-mentions">
                  → {{ m.members.map((mem: any) => roleLabel(mem.role)).join(', ') }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="sending" class="msg-row msg-agent">
          <div class="msg-avatar">…</div>
          <div class="msg-body">
            <div class="msg-bubble">
              <div class="msg-text typing"><span></span><span></span><span></span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input">
        <div class="chat-targets">
          <label>发送到:</label>
          <label v-for="mem in members" :key="mem.connectionId" class="target-chip">
            <input type="checkbox" :value="mem.connectionId" v-model="selectedTargets" />
            {{ roleLabel(mem.role) }}
          </label>
          <button class="btn btn-sm" @click="selectAll">全选</button>
        </div>
        <div class="chat-type-row">
          <textarea
            v-model="inputText"
            @keydown.enter.exact.prevent="send"
            placeholder="输入消息... (Enter 发送)"
            rows="2"
          ></textarea>
          <button class="btn btn-primary" :disabled="sending || !inputText.trim()" @click="send">
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, onUnmounted } from 'vue';
import { api } from '../api/client';
import { useTeamChatSSE } from '../composables/useTeamChatSSE';

const props = defineProps<{ team: any }>();
const emit = defineEmits<{ close: [] }>();

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  label: string;
  content: string;
  timestamp: number;
  members?: any[];
  agentLabel?: string;
}

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const sending = ref(false);
const msgList = ref<HTMLElement>();
const selectedTargets = ref<string[]>([]);

const members = computed(() => props.team?.members ?? []);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastMessageId = 0;
const pendingMessages = new Map<string, number>(); // traceId -> messageIndex

// 监听团队消息 SSE (独立连接, 不污染全局通知)
useTeamChatSSE(props.team.id, (event: any) => {
  const data = event.data;
  if (!data) return;

  if (event.type === 'team.message') {
    const idx = pendingMessages.get(data.traceId);
    if (idx !== undefined && messages.value[idx]) {
      messages.value[idx].content = data.response || '(无响应)';
      messages.value[idx].label = `${roleLabel(data.role)} · ${data.from.slice(0, 8)}`;
    } else {
      messages.value.push({
        id: `a-${++lastMessageId}`,
        role: 'agent',
        label: `${roleLabel(data.role)} · ${data.from.slice(0, 8)}`,
        content: data.response || '(无响应)',
        timestamp: data.timestamp || Date.now(),
      });
    }
    pendingMessages.delete(data.traceId);
    sending.value = false;
    scrollDown();
  }

  if (event.type === 'team.message.error') {
    messages.value.push({
      id: `e-${++lastMessageId}`,
      role: 'agent',
      label: `${roleLabel(data.role)} · 错误`,
      content: `发送失败: ${data.error}`,
      timestamp: data.timestamp || Date.now(),
    });
    pendingMessages.delete(data.traceId);
    sending.value = false;
    scrollDown();
  }
});

function roleLabel(role: string) {
  return { lead: 'Lead', worker: 'Worker', reviewer: 'Reviewer', observer: 'Observer' }[role] ?? role;
}

function selectAll() {
  selectedTargets.value = members.value.map((m: any) => m.connectionId);
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

async function send() {
  const text = inputText.value.trim();
  if (!text || sending.value) return;

  const targets = selectedTargets.value.length > 0
    ? selectedTargets.value
    : members.value.map((m: any) => m.connectionId);

  // 用户消息
  messages.value.push({
    id: `u-${++lastMessageId}`,
    role: 'user',
    label: '我',
    content: text,
    timestamp: Date.now(),
  });
  inputText.value = '';
  sending.value = true;
  scrollDown();

  sending.value = true;
  const traceIds: string[] = [];
  scrollDown();

  try {
    for (const connId of targets) {
      const member = members.value.find((m: any) => m.connectionId === connId);
      const res = await api.post(`/teams/${props.team.id}/message`, {
        to: connId,
        payload: text,
        relay: member?.interop?.[0] ?? 'bff-bus',
      });

      const traceId = res.traceId;
      traceIds.push(traceId);

      // 添加占位消息 (等待 SSE 更新)
      const idx = messages.value.length;
      messages.value.push({
        id: `a-${++lastMessageId}`,
        role: 'agent',
        label: member ? roleLabel(member.role) : 'Agent',
        content: '思考中...',
        timestamp: Date.now() + 1,
        agentLabel: member ? roleLabel(member.role) : 'A',
      });
      pendingMessages.set(traceId, idx);
    }
  } catch (e: any) {
    messages.value.push({
      id: `e-${++lastMessageId}`,
      role: 'agent',
      label: '系统',
      content: `发送失败: ${e.message}`,
      timestamp: Date.now(),
    });
    sending.value = false;
  }

  scrollDown();

  // 超时兜底: 10s 后还没收到 SSE 回复
  setTimeout(() => {
    for (const tid of traceIds) {
      const idx = pendingMessages.get(tid);
      if (idx !== undefined && messages.value[idx]?.content === '思考中...') {
        messages.value[idx].content = '(超时未收到响应)';
        pendingMessages.delete(tid);
      }
    }
    if (pendingMessages.size === 0) sending.value = false;
    scrollDown();
  }, 15000);
}

async function loadHistory() {
  // 从 team runs 加载历史消息
  try {
    const runs = await api.get<any[]>(`/runs?teamId=${props.team.id}&limit=5`);
    if (runs.length > 0) {
      for (const run of runs.reverse()) {
        if (run.context) {
          try {
            const ctx = JSON.parse(run.context);
            if (ctx.message) {
              messages.value.push({
                id: `h-${run.id}`,
                role: 'user',
                label: '历史',
                content: ctx.message,
                timestamp: run.createdAt,
              });
            }
          } catch {}
        }
      }
    }
  } catch {}
}

function scrollDown() {
  nextTick(() => {
    if (msgList.value) msgList.value.scrollTop = msgList.value.scrollHeight;
  });
}

onMounted(() => {
  loadHistory();
  // 清理定时器由 close 事件处理
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.team-chat-modal {
  display: flex; flex-direction: column; max-height: 80vh;
}
.chat-header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px;
}
.chat-subtitle { font-size: 12px; color: var(--text-dim); }

.chat-messages {
  flex: 1; overflow-y: auto; padding: 8px 0;
  min-height: 200px; max-height: 400px;
}
.chat-empty {
  text-align: center; color: var(--text-dim); padding: 40px 0;
}

.msg-row { display: flex; gap: 8px; margin-bottom: 12px; }
.msg-user { flex-direction: row-reverse; }
.msg-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; flex-shrink: 0;
  background: var(--primary); color: #fff;
}
.msg-user .msg-avatar { background: #6366f1; }
.msg-agent .msg-avatar { background: var(--surface); color: var(--text); border: 1px solid var(--border); }

.msg-body { max-width: 70%; }
.msg-user .msg-body { text-align: right; }
.msg-meta { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
.msg-sender { font-weight: 600; margin-right: 6px; }
.msg-time { opacity: 0.7; }

.msg-bubble {
  display: inline-block; padding: 8px 12px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border);
  text-align: left;
}
.msg-user .msg-bubble { background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3); }
.msg-text { white-space: pre-wrap; word-break: break-word; }
.msg-mentions { font-size: 11px; color: var(--text-dim); margin-top: 4px; }

.typing span {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-dim); animation: typing 1.4s infinite;
  margin: 0 1px;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

.chat-input {
  border-top: 1px solid var(--border); padding-top: 12px;
}
.chat-targets {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;
}
.chat-targets label { font-size: 12px; color: var(--text-dim); }
.target-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 12px; font-size: 11px;
  background: var(--surface); border: 1px solid var(--border);
  cursor: pointer;
}
.target-chip input { margin: 0; }

.chat-type-row { display: flex; gap: 8px; align-items: flex-end; }
.chat-type-row textarea { flex: 1; }
</style>
