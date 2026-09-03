<template>
  <div class="data-management-page">
    <h1>数据管理</h1>

    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="btn-primary" @click="showBackupModal = true">📦 创建备份</button>
      <button @click="load">↻</button>
    </div>

    <!-- 数据统计 -->
    <div class="card">
      <h3>数据统计</h3>
      <div v-if="!stats.tables" class="empty-sm">加载中...</div>
      <div v-else class="data-stats">
        <div v-for="(count, name) in stats.tables" :key="name" class="data-stat-item">
          <span class="data-stat-name">{{ name }}</span>
          <span class="data-stat-count">{{ count.toLocaleString() }} 行</span>
        </div>
      </div>
    </div>

    <!-- 备份列表 -->
    <div class="card">
      <h3>备份记录 ({{ backups.length }})</h3>
      <div v-if="!backups.length" class="empty-sm">暂无备份</div>
      <table v-else class="data-table">
        <thead><tr><th>名称</th><th>大小</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="b in backups" :key="b.id">
            <td>{{ b.name }}</td>
            <td>{{ formatBytes(b.sizeBytes) }}</td>
            <td>{{ formatTs(b.createdAt) }}</td>
            <td>
              <button @click="restoreBackup(b)" title="恢复">↺</button>
              <button @click="exportBackup(b)" title="导出">⬇</button>
              <button @click="deleteBackup(b)" title="删除">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 创建备份 Modal -->
    <div v-if="showBackupModal" class="modal-overlay" @click.self="showBackupModal = false">
      <div class="card modal">
        <h3>创建备份</h3>
        <div class="form-group">
          <label>备份名称</label>
          <input v-model="newBackup.name" placeholder="数据备份" />
        </div>
        <div class="form-group">
          <label>描述</label>
          <input v-model="newBackup.description" placeholder="可选描述" />
        </div>
        <div class="form-group checkbox-group">
          <label><input type="checkbox" v-model="newBackup.includeConnections" /> 包含连接</label>
          <label><input type="checkbox" v-model="newBackup.includeSessions" /> 包含会话/团队/项目/运行</label>
          <label><input type="checkbox" v-model="newBackup.includeAuditLog" /> 包含审计日志</label>
          <label><input type="checkbox" v-model="newBackup.includeTokenUsage" /> 包含 Token 用量/告警/工作流</label>
        </div>
        <div class="toolbar">
          <button @click="showBackupModal = false">取消</button>
          <button class="btn-primary" @click="createBackup">创建备份</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();
const stats = ref<any>({});
const backups = ref<any[]>([]);
const showBackupModal = ref(false);
const newBackup = ref({
  name: '数据备份',
  description: '',
  includeConnections: true,
  includeSessions: true,
  includeAuditLog: false,
  includeTokenUsage: true,
});

async function load() {
  try {
    stats.value = await api.get('/data-management/stats');
    backups.value = stats.value.backups || [];
  } catch { /* ignore */ }
}

async function createBackup() {
  if (!newBackup.value.name.trim()) return;
  try {
    const result = await api.post('/data-management/backups', newBackup.value);
    toast.success(`备份创建成功 (${formatBytes(result.sizeBytes)})`);
    showBackupModal.value = false;
    load();
  } catch { toast.error('备份失败'); }
}

async function restoreBackup(b: any) {
  if (!confirm(`确认恢复备份 "${b.name}"? 当前数据将被覆盖!`)) return;
  try {
    const result = await api.post(`/data-management/backups/${b.id}/restore`);
    toast.success(`恢复成功: ${JSON.stringify(result.stats)}`);
    load();
  } catch { toast.error('恢复失败'); }
}

async function deleteBackup(b: any) {
  if (!confirm('确认删除此备份?')) return;
  try {
    await api.delete(`/data-management/backups/${b.id}`);
    toast.success('已删除');
    load();
  } catch { toast.error('删除失败'); }
}

async function exportBackup(b: any) {
  try {
    const data = await api.get(`/data-management/backups/${b.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${b.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  } catch { toast.error('导出失败'); }
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function formatTs(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

onMounted(load);
</script>

<style scoped>
.data-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.data-stat-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--surface); border-radius: 6px; }
.data-stat-name { font-family: monospace; font-size: 12px; }
.data-stat-count { font-size: 13px; color: var(--text-muted); font-weight: 500; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.form-group input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
.checkbox-group label { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; cursor: pointer; }
.checkbox-group input[type="checkbox"] { width: auto; }
.data-table button { background: none; border: 1px solid var(--border); border-radius: 4px; width: 28px; height: 28px; cursor: pointer; margin-right: 4px; }
.data-table button:hover { background: var(--surface-hover); }
</style>
