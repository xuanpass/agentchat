<template>
  <div class="settings-page">
    <div class="page-header">
      <h1 class="page-title">设置</h1>
    </div>

    <!-- 外观 -->
    <div class="card settings-section">
      <h2 class="section-title">外观</h2>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">主题</div>
          <div class="setting-desc">切换暗色 / 亮色主题</div>
        </div>
        <div class="theme-toggle">
          <button
            class="theme-btn"
            :class="{ active: settings.theme === 'dark' }"
            @click="setTheme('dark')"
          >
            🌙 暗色
          </button>
          <button
            class="theme-btn"
            :class="{ active: settings.theme === 'light' }"
            @click="setTheme('light')"
          >
            ☀️ 亮色
          </button>
        </div>
      </div>
    </div>

    <!-- 连接 -->
    <div class="card settings-section">
      <h2 class="section-title">连接</h2>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">健康检查间隔</div>
          <div class="setting-desc">后端周期性探活间隔（秒）</div>
        </div>
        <select :value="settings.healthCheckInterval" @change="updateSetting('healthCheckInterval', Number(($event.target as HTMLSelectElement).value))">
          <option :value="15">15 秒</option>
          <option :value="30">30 秒</option>
          <option :value="60">60 秒</option>
          <option :value="120">2 分钟</option>
        </select>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">自动刷新连接状态</div>
          <div class="setting-desc">前端每 10s 自动拉取连接列表</div>
        </div>
        <label class="toggle">
          <input type="checkbox" :checked="settings.autoRefreshConnections" @change="updateSetting('autoRefreshConnections', ($event.target as HTMLInputElement).checked)" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">自动刷新仪表盘</div>
          <div class="setting-desc">仪表盘每 15s 自动刷新统计数据</div>
        </div>
        <label class="toggle">
          <input type="checkbox" :checked="settings.autoRefreshDashboard" @change="updateSetting('autoRefreshDashboard', ($event.target as HTMLInputElement).checked)" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- 数据 -->
    <div class="card settings-section">
      <h2 class="section-title">数据</h2>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">导入 / 导出</div>
          <div class="setting-desc">备份或恢复连接配置与能力库</div>
        </div>
        <div class="setting-actions">
          <button class="btn btn-sm" @click="exportData">导出 JSON</button>
          <button class="btn btn-sm" @click="importData">导入 JSON</button>
          <input ref="importInput" type="file" accept=".json" style="display:none" @change="handleImport" />
        </div>
      </div>
    </div>

    <!-- 安全 -->
    <div class="card settings-section">
      <h2 class="section-title">安全</h2>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">API Key</div>
          <div class="setting-desc">鉴权访问令牌，定期轮换可提升安全性</div>
        </div>
        <div class="setting-actions">
          <button class="btn btn-sm" @click="rotateKey">轮换 Key</button>
          <button class="btn btn-sm btn-danger" @click="logout">登出</button>
        </div>
      </div>
    </div>

    <!-- 危险区 -->
    <div class="card settings-section danger">
      <h2 class="section-title">危险操作</h2>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">恢复默认设置</div>
          <div class="setting-desc">将所有设置恢复为默认值</div>
        </div>
        <button class="btn btn-sm btn-danger" @click="confirmReset">重置</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useToast } from '../composables/useToast';
import { api, setApiKey } from '../api/client';

const store = useSettingsStore();
const settings = store.settings;
const toast = useToast();
const importInput = ref<HTMLInputElement>();

const { setTheme, updateSetting } = store;

function exportData() {
  // 收集所有数据
  Promise.all([
    api.get<any[]>('/connections'),
    api.get<any[]>('/capabilities'),
  ]).then(([connections, capabilities]) => {
    const data = {
      version: '1.0',
      exportedAt: Date.now(),
      connections: connections.map((c: any) => ({
        name: c.name, kind: c.kind, endpoint: c.endpoint,
        auth: { type: c.auth.type }, profile: c.profile,
      })),
      capabilities: capabilities.map((c: any) => ({
        name: c.name, type: c.type, sourceKind: c.sourceKind,
      })),
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aoc-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  }).catch((e: any) => {
    toast.error(`导出失败: ${e.message}`);
  });
}

function importData() {
  importInput.value?.click();
}

function handleImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);
      let imported = 0;
      if (data.connections && Array.isArray(data.connections)) {
        for (const c of data.connections) {
          try {
            await api.post('/connections', c);
            imported++;
          } catch { /* skip duplicates */ }
        }
      }
      toast.success(`导入完成: ${imported} 个连接`);
    } catch (err: any) {
      toast.error(`导入失败: ${err.message}`);
    }
  };
  reader.readAsText(file);
  // 重置 input
  (event.target as HTMLInputElement).value = '';
}

function confirmReset() {
  if (confirm('确定要恢复默认设置吗？')) {
    store.reset();
    toast.success('已恢复默认设置');
  }
}

async function rotateKey() {
  if (!confirm('确定要轮换 API Key 吗？旧 Key 将立即失效。')) return;
  try {
    const res = await api.post<{ key: string }>('/auth/rotate');
    if (res.key) {
      setApiKey(res.key);
      toast.success('API Key 已轮换');
    }
  } catch (e: any) {
    toast.error(`轮换失败: ${e.message}`);
  }
}

function logout() {
  setApiKey(null);
  window.location.reload();
}
</script>

<style scoped>
.settings-page { max-width: 680px; }

.settings-section { padding: 20px 24px; margin-bottom: 16px; }
.settings-section.danger { border-color: var(--red-dim); }

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
}
.setting-row + .setting-row { border-top: 1px solid var(--border); }

.setting-label { font-size: 13px; font-weight: 500; }
.setting-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.setting-actions { display: flex; gap: 8px; }

/* 主题切换 */
.theme-toggle { display: flex; gap: 4px; }
.theme-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.theme-btn:hover { border-color: var(--accent); }
.theme-btn.active { background: var(--accent-light); color: var(--accent); border-color: var(--accent); }

/* Toggle 开关 */
.toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-hover);
  border-radius: 12px;
  cursor: pointer;
  transition: 0.2s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 18px; height: 18px;
  left: 3px; bottom: 3px;
  background: var(--text-muted);
  border-radius: 50%;
  transition: 0.2s;
}
.toggle input:checked + .toggle-slider { background: var(--accent-light); }
.toggle input:checked + .toggle-slider::before { transform: translateX(20px); background: var(--accent); }

select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}
select:focus { border-color: var(--accent); }

.btn-danger {
  background: var(--red-dim);
  color: var(--red);
  border-color: transparent;
}
.btn-danger:hover { background: var(--red); color: #fff; }
</style>
