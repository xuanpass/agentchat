<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">Agent Ops Console</div>
      <nav class="nav">
        <router-link v-for="item in nav" :key="item.path" :to="item.path" class="nav-item" active-class="active">
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.title }}</span>
        </router-link>
      </nav>
      <div class="footer">v0.1.0 · M16</div>
    </aside>
    <div class="content">
      <header class="topbar">
        <div class="topbar-left">
          <span class="status-pill" :class="healthStatus">
            <span class="status-dot" :class="`status-${healthStatus}`"></span>
            {{ healthLabel }}
          </span>
        </div>
        <div class="topbar-center">
          <div class="search-box" :class="{ active: searchFocused }">
            <span class="search-icon">⌕</span>
            <input
              v-model="searchQuery"
              @focus="searchFocused = true"
              @blur="setTimeout(() => searchFocused = false, 200)"
              @input="onSearchInput"
              @keydown.enter.exact="goToSearch"
              @keydown.esc="searchQuery = ''; searchFocused = false"
              placeholder="搜索会话、消息、能力..."
              class="search-input"
            />
            <span v-if="searchQuery" class="search-clear" @click="searchQuery = ''">✕</span>
          </div>
          <div v-if="searchFocused && searchQuery" class="search-dropdown" @mousedown.prevent>
            <div v-if="searchLoading" class="search-loading">搜索中...</div>
            <template v-else-if="searchResults">
              <div v-if="totalResults === 0" class="search-no-results">无匹配结果</div>
              <div v-else class="search-results">
                <div v-if="searchResults.sessions?.length" class="search-group">
                  <div class="search-group-label">会话</div>
                  <div v-for="r in searchResults.sessions" :key="r.id" class="search-result-item" @click="goToSession(r.id)">
                    <span class="search-result-icon">◆</span>
                    <span class="search-result-text">{{ r.title }}</span>
                  </div>
                </div>
                <div v-if="searchResults.messages?.length" class="search-group">
                  <div class="search-group-label">消息</div>
                  <div v-for="(r, i) in searchResults.messages" :key="i" class="search-result-item" @click="goToSession(r.sessionId)">
                    <span class="search-result-icon">💬</span>
                    <span class="search-result-text" v-html="r.snippet"></span>
                  </div>
                </div>
                <div v-if="searchResults.capabilities?.length" class="search-group">
                  <div class="search-group-label">能力</div>
                  <div v-for="r in searchResults.capabilities" :key="r.id" class="search-result-item" @click="goToCapabilities()">
                    <span class="search-result-icon">⬡</span>
                    <span class="search-result-text">{{ r.name }}</span>
                  </div>
                </div>
                <div v-if="searchResults.connections?.length" class="search-group">
                  <div class="search-group-label">实例</div>
                  <div v-for="r in searchResults.connections" :key="r.id" class="search-result-item" @click="goToConnections()">
                    <span class="search-result-icon">◈</span>
                    <span class="search-result-text">{{ r.name }}</span>
                  </div>
                </div>
                <div v-if="searchResults.teams?.length" class="search-group">
                  <div class="search-group-label">团队</div>
                  <div v-for="r in searchResults.teams" :key="r.id" class="search-result-item" @click="goToTeams()">
                    <span class="search-result-icon">⬢</span>
                    <span class="search-result-text">{{ r.name }}</span>
                  </div>
                </div>
              </div>
              <div v-if="totalResults > 0" class="search-footer" @click="goToSearch">
                查看全部 {{ totalResults }} 条结果 →
              </div>
            </template>
          </div>
        </div>
        <div class="topbar-right">
          <span class="sse-status" :class="{ online: sseConnected }" :title="sseConnected ? '实时事件已连接' : '实时事件断开'">
            <span class="sse-dot" :class="{ online: sseConnected }"></span>
            {{ sseConnected ? 'LIVE' : 'OFF' }}
          </span>
          <span class="alert-badge" v-if="unackAlerts > 0" @click="router.push('/alerts')" title="未确认告警">
            🔔 {{ unackAlerts }}
          </span>
          <span class="topbar-info">{{ connectedCount }}/{{ totalCount }} 实例在线</span>
          <span class="topbar-info" v-if="syncTasksActive">同步任务进行中: {{ syncTasksActive }}</span>
        </div>
      </header>
      <main class="main">
        <error-boundary>
          <router-view v-slot="{ Component }">
            <transition name="page" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </error-boundary>
      </main>
    </div>
    <toast-host ref="toastRef" />

    <!-- 快捷键帮助 -->
    <div v-if="showHelp" class="modal-overlay" @click.self="showHelp = false">
      <div class="card modal shortcut-modal">
        <div class="shortcut-header">
          <h2>键盘快捷键</h2>
          <button class="btn btn-sm" @click="showHelp = false">✕</button>
        </div>
        <div class="shortcut-list">
          <div v-for="(s, i) in shortcuts" :key="i" class="shortcut-row">
            <span class="shortcut-label">{{ s.label }}</span>
            <kbd class="shortcut-key">
              <span v-if="s.ctrl">Ctrl+</span>{{ s.key }}
            </kbd>
          </div>
        </div>
        <div class="shortcut-hint">按 <kbd>Esc</kbd> 或 <kbd>Ctrl+/</kbd> 关闭</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, getApiKey, setApiKey } from './api/client';
import { useEventSource } from './composables/useEventSource';
import ErrorBoundary from './components/ErrorBoundary.vue';
import ToastHost from './components/ToastHost.vue';
import { registerToast } from './composables/useToast';
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts';

const toastRef = ref<InstanceType<typeof ToastHost>>();

// 键盘快捷键
const { showHelp, shortcuts } = useKeyboardShortcuts();

const { connected: sseConnected, notifications, onNotification } = useEventSource();

onMounted(() => {
  if (toastRef.value) registerToast(toastRef.value);

  // 401 监听 → 跳转登录
  window.addEventListener('aoc:unauthorized', () => {
    setApiKey(null);
    router.push('/login');
  });

  // SSE 事件 → Toast 通知
  onNotification((n) => {
    const toast = useToast();
    const msg = `${n.title}: ${n.message}`;
    if (n.type === 'error') toast.error(msg);
    else if (n.type === 'warning') toast.warning(msg);
    else if (n.type === 'success') toast.success(msg);
    else toast.info(msg);
  });
});

const healthOk = ref(false);
const totalCount = ref(0);
const connectedCount = ref(0);
const syncTasksActive = ref(0);
const unackAlerts = ref(0);
const router = useRouter();

// ── 搜索 ──
const searchQuery = ref('');
const searchFocused = ref(false);
const searchLoading = ref(false);
const searchResults = ref<any>(null);
let searchTimer: any = null;

const totalResults = computed(() => {
  if (!searchResults.value?.results) return 0;
  const r = searchResults.value.results;
  return (r.sessions?.length || 0) + (r.messages?.length || 0) + (r.capabilities?.length || 0) + (r.connections?.length || 0) + (r.teams?.length || 0);
});

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  if (!searchQuery.value.trim()) { searchResults.value = null; return; }
  searchTimer = setTimeout(doSearch, 300);
}

async function doSearch() {
  if (!searchQuery.value.trim()) return;
  searchLoading.value = true;
  try {
    searchResults.value = await api.get<any>(`/search?q=${encodeURIComponent(searchQuery.value.trim())}`);
  } catch (e) {
    console.error('Search failed:', e);
    searchResults.value = null;
  } finally {
    searchLoading.value = false;
  }
}

function goToSearch() {
  if (!searchQuery.value.trim()) return;
  router.push(`/search?q=${encodeURIComponent(searchQuery.value.trim())}`);
  searchFocused.value = false;
}

function goToSession(id: string) {
  router.push(`/sessions?id=${id}`);
  searchQuery.value = '';
  searchFocused.value = false;
}

function goToCapabilities() { router.push('/capabilities'); searchFocused.value = false; }
function goToConnections() { router.push('/connections'); searchFocused.value = false; }
function goToTeams() { router.push('/teams'); searchFocused.value = false; }

let pollTimer: any = null;

const healthStatus = computed(() => healthOk.value ? 'connected' : 'error');
const healthLabel = computed(() => healthOk.value ? 'BFF 在线' : 'BFF 离线');

const nav = [
  { path: '/dashboard', title: '仪表盘', icon: '◉' },
  { path: '/connections', title: '智能体', icon: '◈' },
  { path: '/teams', title: '团队', icon: '⬢' },
  { path: '/runs', title: '运行记录', icon: '⟳' },
  { path: '/sessions', title: '会话', icon: '◆' },
  { path: '/capabilities', title: '能力库', icon: '⬡' },
  { path: '/projects', title: '项目', icon: '▣' },
  { path: '/skill-market', title: '技能市场', icon: '✦' },
  { path: '/audit', title: '审计日志', icon: '📋' },
  { path: '/alerts', title: '告警', icon: '🔔' },
  { path: '/token-usage', title: 'Token 用量', icon: '◧' },
  { path: '/alert-rules', title: '告警规则', icon: '⚡' },
  { path: '/workflows', title: '工作流', icon: '⧉' },
  { path: '/model-providers', title: '多模型', icon: '◑' },
  { path: '/agent-monitor', title: '监控', icon: '📈' },
  { path: '/plugin-market', title: '插件', icon: '✦' },
  { path: '/agent-chat', title: '聊天', icon: '💬' },
  { path: '/notifications', title: '通知', icon: '🔔' },
  { path: '/system-health', title: '健康', icon: '💚' },
  { path: '/reports', title: '报告', icon: '📊' },
  { path: '/data-management', title: '数据', icon: '🗄' },
  { path: '/dashboard-customize', title: '定制', icon: '🎨' },
  { path: '/settings', title: '设置', icon: '⚙' },
];

async function pollHealth() {
  try {
    const h = await api.get<{ ok: boolean; ts: number }>('/health');
    healthOk.value = h.ok;
  } catch { healthOk.value = false; }
}

async function pollConnections() {
  try {
    const list = await api.get<any[]>('/connections');
    totalCount.value = list.length;
    connectedCount.value = list.filter((c) => c.status === 'connected').length;
  } catch { /* ignore */ }
}

async function pollSyncTasks() {
  try {
    const tasks = await api.get<any[]>('/synctasks?status=running');
    syncTasksActive.value = tasks.length;
  } catch { /* ignore */ }
}

async function pollAlerts() {
  try {
    const stats = await api.get<any>('/alerts/stats');
    unackAlerts.value = stats.unacknowledged ?? 0;
  } catch { /* ignore */ }
}

async function pollAll() {
  await Promise.all([pollHealth(), pollConnections(), pollSyncTasks(), pollAlerts()]);
}

onMounted(() => {
  pollAll();
  pollTimer = setInterval(pollAll, 10_000);
});

onUnmounted(() => { clearInterval(pollTimer); });

</script>

<style scoped>
.alert-badge {
  cursor: pointer; font-size: 12px; padding: 2px 8px;
  background: var(--danger); color: #fff; border-radius: 10px;
  font-weight: 600; animation: pulse 2s infinite;
}
.alert-badge:hover { opacity: 0.8; }
</style>
