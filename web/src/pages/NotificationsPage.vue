<template>
  <div class="notifications-page">
    <h1>通知中心</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总通知</div>
        <div class="stat-value">{{ stats.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未读</div>
        <div class="stat-value" :class="{ 'text-warn': stats.unread > 0 }">{{ stats.unread ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">紧急</div>
        <div class="stat-value" :class="{ 'text-danger': stats.urgent > 0 }">{{ stats.urgent ?? 0 }}</div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <button @click="markAllRead" :disabled="!stats.unread">全部标为已读</button>
      <button @click="showCreateModal = true">+ 发布通知</button>
      <button @click="cleanupOld">清理旧通知</button>
      <div class="filter-group">
        <select v-model="filterType">
          <option value="">全部类型</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
          <option value="alert">告警</option>
          <option value="system">系统</option>
        </select>
        <select v-model="filterRead">
          <option value="">全部状态</option>
          <option value="0">未读</option>
          <option value="1">已读</option>
        </select>
      </div>
      <button @click="load" class="btn-refresh">↻</button>
    </div>

    <!-- 通知列表 -->
    <div class="card">
      <div v-if="!filteredNotifications.length" class="empty-sm">暂无通知</div>
      <div v-else class="notif-list">
        <div
          v-for="n in filteredNotifications" :key="n.id"
          class="notif-item" :class="{ unread: !n.read, [`prio-${n.priority}`]: true }"
        >
          <div class="notif-icon">{{ typeIcon(n.type) }}</div>
          <div class="notif-content" @click="viewNotification(n)">
            <div class="notif-title">{{ n.title }}</div>
            <div class="notif-body">{{ n.body }}</div>
            <div class="notif-meta">
              <span class="notif-type-badge" :class="`type-${n.type}`">{{ n.type }}</span>
              <span v-if="n.priority === 'urgent'" class="prio-badge urgent">紧急</span>
              <span v-else-if="n.priority === 'high'" class="prio-badge high">高</span>
              <span class="notif-time">{{ formatTs(n.createdAt) }}</span>
            </div>
          </div>
          <div class="notif-actions">
            <button v-if="!n.read" @click="markRead(n, true)" title="标为已读">✓</button>
            <button v-else @click="markRead(n, false)" title="标为未读">↩</button>
            <button @click="deleteNotif(n)" title="删除">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建通知 Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="card modal">
        <h3>发布通知</h3>
        <div class="form-group">
          <label>类型</label>
          <select v-model="newNotif.type">
            <option value="info">信息</option>
            <option value="warning">警告</option>
            <option value="error">错误</option>
            <option value="alert">告警</option>
            <option value="system">系统</option>
          </select>
        </div>
        <div class="form-group">
          <label>优先级</label>
          <select v-model="newNotif.priority">
            <option value="low">低</option>
            <option value="normal">正常</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </div>
        <div class="form-group">
          <label>标题</label>
          <input v-model="newNotif.title" placeholder="通知标题" />
        </div>
        <div class="form-group">
          <label>内容</label>
          <textarea v-model="newNotif.body" placeholder="通知内容" rows="3"></textarea>
        </div>
        <div class="toolbar">
          <button @click="showCreateModal = false">取消</button>
          <button class="btn-primary" @click="createNotification">发布</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();
const notifications = ref<any[]>([]);
const stats = ref<any>({});
const filterType = ref('');
const filterRead = ref('');
const showCreateModal = ref(false);
const newNotif = ref({ type: 'info', priority: 'normal', title: '', body: '' });

const filteredNotifications = computed(() => {
  let list = notifications.value;
  if (filterType.value) list = list.filter((n: any) => n.type === filterType.value);
  if (filterRead.value !== '') list = list.filter((n: any) => n.read === (filterRead.value === '1'));
  return list;
});

async function load() {
  try {
    notifications.value = await api.get('/notifications');
    stats.value = await api.get('/notifications/stats');
  } catch { /* ignore */ }
}

async function createNotification() {
  if (!newNotif.value.title.trim()) return;
  try {
    await api.post('/notifications', newNotif.value);
    showCreateModal.value = false;
    newNotif.value = { type: 'info', priority: 'normal', title: '', body: '' };
    toast.success('通知已发布');
    load();
  } catch { toast.error('发布失败'); }
}

async function markRead(n: any, read: boolean) {
  try {
    await api.patch(`/notifications/${n.id}/${read ? 'read' : 'unread'}`);
    n.read = read;
    load();
  } catch { /* ignore */ }
}

async function markAllRead() {
  try {
    await api.post('/notifications/mark-all-read', {});
    toast.success('已全部标为已读');
    load();
  } catch { /* ignore */ }
}

async function deleteNotif(n: any) {
  try {
    await api.delete(`/notifications/${n.id}`);
    toast.success('已删除');
    load();
  } catch { /* ignore */ }
}

async function cleanupOld() {
  try {
    const result = await api.post<{ deleted: number }>('/notifications/cleanup', { olderThanDays: 30, readOnly: true });
    toast.success(`清理了 ${result.deleted ?? 0} 条旧通知`);
    load();
  } catch { /* ignore */ }
}

function viewNotification(n: any) {
  if (!n.read) markRead(n, true);
}

function typeIcon(type: string) {
  const icons: Record<string, string> = { info: 'ℹ️', warning: '⚠️', error: '❌', alert: '🔔', system: '⚙️' };
  return icons[type] || '📋';
}

function formatTs(ts: number) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(load);
</script>

<style scoped>
.filter-group { display: flex; gap: 8px; margin-left: auto; }
.filter-group select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
.btn-refresh { padding: 4px 10px; }
.text-warn { color: var(--warning); }
.text-danger { color: var(--danger); }
.notif-list { display: flex; flex-direction: column; }
.notif-item { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s; }
.notif-item:hover { background: var(--surface-hover); }
.notif-item.unread { background: var(--accent-alpha); border-left: 3px solid var(--accent); }
.notif-item.prio-urgent { border-left-color: var(--danger); }
.notif-item.prio-high { border-left-color: var(--warning); }
.notif-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
.notif-body { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.notif-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.notif-type-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; text-transform: uppercase; }
.type-info { background: var(--accent-alpha); color: var(--accent); }
.type-warning { background: var(--warning-bg); color: var(--warning); }
.type-error, .type-alert { background: var(--danger-bg); color: var(--danger); }
.type-system { background: var(--surface); color: var(--text-muted); }
.prio-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.prio-badge.urgent { background: var(--danger); color: #fff; }
.prio-badge.high { background: var(--warning); color: #fff; }
.notif-time { color: var(--text-muted); }
.notif-actions { display: flex; gap: 4px; flex-shrink: 0; }
.notif-actions button { background: none; border: 1px solid var(--border); border-radius: 4px; width: 28px; height: 28px; cursor: pointer; }
.notif-actions button:hover { background: var(--surface-hover); }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
</style>
