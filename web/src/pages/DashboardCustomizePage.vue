<template>
  <div class="dashboard-customize-page">
    <h1>仪表盘定制</h1>
    <p class="subtitle">拖拽式 Widget 编排，自定义你的仪表盘布局</p>

    <!-- 工具栏 -->
    <div class="toolbar">
      <button @click="addNewWidget">+ 添加 Widget</button>
      <button @click="saveLayout">💾 保存布局</button>
      <button @click="resetLayout">↺ 重置默认</button>
      <button @click="load">刷新</button>
    </div>

    <!-- Widget 列表 -->
    <div class="card">
      <h3>当前 Widget ({{ widgets.length }})</h3>
      <div v-if="!widgets.length" class="empty-sm">暂无 Widget，点击上方按钮添加</div>
      <div v-else class="widget-grid">
        <div
          v-for="(w, idx) in widgets" :key="w.id"
          class="widget-card"
          draggable="true"
          @dragstart="onDragStart(idx)"
          @dragover.prevent
          @drop="onDrop(idx)"
        >
          <div class="widget-drag-handle">⋮⋮</div>
          <div class="widget-info">
            <div class="widget-icon">{{ widgetIcon(w.type) }}</div>
            <div class="widget-details">
              <div class="widget-title">{{ w.title }}</div>
              <div class="widget-type-badge">{{ w.type }}</div>
            </div>
          </div>
          <div class="widget-actions">
            <button @click="editWidget(w)" title="编辑">✎</button>
            <button @click="removeWidget(idx)" title="删除">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 可用 Widget 类型 -->
    <div class="card">
      <h3>可用 Widget 类型</h3>
      <div class="widget-types">
        <div v-for="t in widgetTypes" :key="t.type" class="widget-type-card" draggable="true" @dragstart="onTypeDragStart(t, $event)">
          <span class="wt-icon">{{ t.icon }}</span>
          <div class="wt-info">
            <div class="wt-name">{{ t.name }}</div>
            <div class="wt-desc">{{ t.description }}</div>
          </div>
          <span class="wt-size">{{ t.defaultW }}x{{ t.defaultH }}</span>
        </div>
      </div>
    </div>

    <!-- 编辑 Widget Modal -->
    <div v-if="editingWidget" class="modal-overlay" @click.self="editingWidget = null">
      <div class="card modal">
        <h3>编辑 Widget</h3>
        <div class="form-group">
          <label>标题</label>
          <input v-model="editingWidget.title" />
        </div>
        <div class="form-group">
          <label>类型</label>
          <select v-model="editingWidget.type">
            <option v-for="t in widgetTypes" :key="t.type" :value="t.type">{{ t.name }}</option>
          </select>
        </div>
        <div class="toolbar">
          <button @click="editingWidget = null">取消</button>
          <button class="btn-primary" @click="saveWidget">保存</button>
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
const widgets = ref<any[]>([]);
const widgetTypes = ref<any[]>([]);
const editingWidget = ref<any>(null);
let dragFromIdx = -1;

async function load() {
  try {
    widgets.value = await api.get('/dashboard-customize/layout');
    widgetTypes.value = await api.get('/dashboard-customize/widget-types');
  } catch { /* ignore */ }
}

function widgetIcon(type: string) {
  const icons: Record<string, string> = { stat: '📊', chart: '📈', list: '📋', activity: '⚡', health: '💚', alerts: '🔔' };
  return icons[type] || '⬡';
}

function addNewWidget() {
  const statType = widgetTypes.value.find((t: any) => t.type === 'stat');
  widgets.value.push({
    id: 'w-' + Date.now().toString(36),
    type: 'stat',
    title: '新 Widget',
    position: widgets.value.length,
    config: {},
  });
}

function editWidget(w: any) {
  editingWidget.value = { ...w };
}

function saveWidget() {
  if (!editingWidget.value) return;
  const idx = widgets.value.findIndex((w: any) => w.id === editingWidget.value.id);
  if (idx >= 0) { widgets.value[idx] = { ...editingWidget.value }; }
  editingWidget.value = null;
}

function removeWidget(idx: number) {
  widgets.value.splice(idx, 1);
}

function onDragStart(idx: number) {
  dragFromIdx = idx;
}

function onDrop(idx: number) {
  if (dragFromIdx < 0 || dragFromIdx === idx) return;
  const item = widgets.value.splice(dragFromIdx, 1)[0];
  widgets.value.splice(idx, 0, item);
  dragFromIdx = -1;
  // 更新 position
  widgets.value.forEach((w: any, i: number) => { w.position = i; });
}

function onTypeDragStart(t: any, _e: DragEvent) {
  // 创建新 widget
  widgets.value.push({
    id: 'w-' + Date.now().toString(36),
    type: t.type,
    title: t.name,
    position: widgets.value.length,
    config: {},
  });
}

async function saveLayout() {
  try {
    await api.post('/dashboard-customize/layout', {
      widgets: widgets.value.map((w: any) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        x: w.config?.x || 0,
        y: w.config?.y || 0,
        w: w.config?.w || 4,
        h: w.config?.h || 3,
        config: w.config || {},
      })),
    });
    toast.success('布局已保存');
  } catch { toast.error('保存失败'); }
}

async function resetLayout() {
  if (!confirm('确认重置为默认布局?')) return;
  try {
    await api.post('/dashboard-customize/reset');
    toast.success('已重置');
    load();
  } catch { /* ignore */ }
}

onMounted(load);
</script>

<style scoped>
.subtitle { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
.widget-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.widget-card { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; cursor: grab; transition: box-shadow 0.15s; }
.widget-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); cursor: grabbing; }
.widget-drag-handle { color: var(--text-muted); font-size: 14px; cursor: grab; user-select: none; }
.widget-info { flex: 1; display: flex; align-items: center; gap: 10px; }
.widget-icon { font-size: 24px; }
.widget-details { flex: 1; }
.widget-title { font-size: 13px; font-weight: 500; }
.widget-type-badge { font-size: 10px; color: var(--text-muted); background: var(--surface-hover); padding: 1px 6px; border-radius: 3px; display: inline-block; margin-top: 2px; }
.widget-actions { display: flex; gap: 4px; }
.widget-actions button { background: none; border: 1px solid var(--border); border-radius: 4px; width: 28px; height: 28px; cursor: pointer; }
.widget-actions button:hover { background: var(--surface-hover); }
.widget-types { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.widget-type-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; cursor: grab; transition: all 0.15s; }
.widget-type-card:hover { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-alpha); }
.wt-icon { font-size: 20px; }
.wt-info { flex: 1; }
.wt-name { font-size: 13px; font-weight: 500; }
.wt-desc { font-size: 11px; color: var(--text-muted); }
.wt-size { font-size: 11px; color: var(--text-muted); }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.form-group input, .form-group select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
</style>
