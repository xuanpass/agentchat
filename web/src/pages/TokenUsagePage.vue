<template>
  <div class="token-usage-page">
    <h1>Token 用量分析</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总 Token</div>
        <div class="stat-value">{{ formatTokens(summary.tokensTotal ?? 0) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">输入 Token</div>
        <div class="stat-value">{{ formatTokens(summary.tokensIn ?? 0) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">输出 Token</div>
        <div class="stat-value">{{ formatTokens(summary.tokensOut ?? 0) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">估算费用</div>
        <div class="stat-value cost">\${{ (summary.cost ?? 0).toFixed(4) }}</div>
      </div>
    </div>

    <!-- 时间范围 -->
    <div class="toolbar">
      <select v-model="period" @change="loadSummary">
        <option value="">全部</option>
        <option value="24h">近 24 小时</option>
        <option value="7d">近 7 天</option>
        <option value="30d">近 30 天</option>
      </select>
      <button @click="loadAll">刷新</button>
      <button @click="showRecordModal = true">手动记录</button>
    </div>

    <div class="grid-2">
      <!-- 每日趋势 -->
      <div class="card">
        <h3>每日趋势</h3>
        <div v-if="daily.length === 0" class="empty-sm">暂无数据</div>
        <div v-else class="chart-bar">
          <div v-for="d in daily" :key="d.day" class="bar-item">
            <div class="bar" :style="{ height: barHeight(d.tokens) + 'px' }" :title="formatTokens(d.tokens)"></div>
            <div class="bar-label">{{ d.day.slice(5) }}</div>
          </div>
        </div>
      </div>

      <!-- 模型分布 -->
      <div class="card">
        <h3>模型分布</h3>
        <div v-if="byModel.length === 0" class="empty-sm">暂无数据</div>
        <table v-else class="data-table compact">
          <thead>
            <tr><th>模型</th><th>Token</th><th>费用</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in byModel" :key="m.model">
              <td>{{ m.model }}</td>
              <td>{{ formatTokens(m.tokens) }}</td>
              <td>\${{ m.cost.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 会话排行 -->
    <div class="card">
      <h3>会话消耗排行</h3>
      <div v-if="bySession.length === 0" class="empty-sm">暂无数据</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>会话 ID</th><th>Token</th><th>费用</th><th>记录</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in bySession" :key="s.session_id">
            <td class="mono">{{ s.session_id?.slice(0, 16) ?? '-' }}...</td>
            <td>{{ formatTokens(s.tokens) }}</td>
            <td>\${{ s.cost.toFixed(4) }}</td>
            <td>{{ s.records }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 手动记录 Modal -->
    <div v-if="showRecordModal" class="modal-overlay" @click.self="showRecordModal = false">
      <div class="modal">
        <h2>手动记录 Token 用量</h2>
        <div class="form-row">
          <label>输入 Token</label>
          <input type="number" v-model.number="recordForm.tokensIn" min="0" />
        </div>
        <div class="form-row">
          <label>输出 Token</label>
          <input type="number" v-model.number="recordForm.tokensOut" min="0" />
        </div>
        <div class="form-row">
          <label>模型</label>
          <input type="text" v-model="recordForm.model" placeholder="gpt-4" />
        </div>
        <div class="form-actions">
          <button @click="submitRecord" :disabled="!recordForm.tokensIn">记录</button>
          <button @click="showRecordModal = false" class="secondary">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../api/client';

const summary = ref<any>({ tokensTotal: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
const daily = ref<any[]>([]);
const byModel = ref<any[]>([]);
const bySession = ref<any[]>([]);
const period = ref('');
const loading = ref(false);
const showRecordModal = ref(false);
const recordForm = ref({ tokensIn: 0, tokensOut: 0, model: '' });

const maxDailyTokens = computed(() => {
  return Math.max(...daily.value.map(d => d.tokens), 1);
});

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function barHeight(tokens: number): number {
  return Math.max(4, (tokens / maxDailyTokens.value) * 80);
}

async function loadSummary() {
  const qs = period.value ? `?period=${period.value}` : '';
  const data = await api.get<any>(`/token-usage/summary${qs}`);
  summary.value = data.tokens || { tokensTotal: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
  daily.value = data.daily || [];
  byModel.value = data.byModel || [];
}

async function loadBySession() {
  bySession.value = await api.get('/token-usage/by-session');
}

async function loadAll() {
  loading.value = true;
  await Promise.all([loadSummary(), loadBySession()]);
  loading.value = false;
}

async function submitRecord() {
  await api.post('/token-usage', recordForm.value);
  showRecordModal.value = false;
  recordForm.value = { tokensIn: 0, tokensOut: 0, model: '' };
  await loadAll();
}

onMounted(loadAll);
</script>

<style scoped>
.token-usage-page { max-width: 960px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-card { flex: 1; min-width: 120px; padding: 14px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
.stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; }
.stat-value.cost { color: var(--accent); }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.toolbar select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.card { background: var(--surface); border-radius: 8px; border: 1px solid var(--border); padding: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; }

.chart-bar { display: flex; align-items: flex-end; gap: 4px; height: 100px; }
.bar-item { flex: 1; display: flex; flex-direction: column; align-items: center; }
.bar { width: 100%; min-height: 4px; background: var(--accent); border-radius: 2px 2px 0 0; transition: height 0.3s; }
.bar-label { font-size: 9px; color: var(--text-muted); margin-top: 2px; }

.empty-sm { color: var(--text-muted); font-size: 13px; padding: 12px; text-align: center; }
.mono { font-family: monospace; font-size: 11px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 380px; padding: 24px; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); }
.modal h2 { margin: 0 0 16px; font-size: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.form-row input { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); box-sizing: border-box; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
.data-table th { color: var(--text-muted); font-weight: 600; font-size: 11px; }
.data-table.compact td { padding: 6px 8px; }
</style>
