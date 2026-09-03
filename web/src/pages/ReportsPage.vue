<template>
  <div class="reports-page">
    <h1>高级报告中心</h1>

    <!-- 工具栏 -->
    <div class="toolbar">
      <select v-model="genType">
        <option value="token_usage">Token 用量</option>
        <option value="cost_analysis">成本分析</option>
        <option value="performance">性能报告</option>
        <option value="trend">趋势报告</option>
        <option value="custom">自定义</option>
      </select>
      <select v-model="genFormat">
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="markdown">Markdown</option>
      </select>
      <input type="date" v-model="genFrom" />
      <input type="date" v-model="genTo" />
      <button class="btn-primary" @click="generateReport">生成报告</button>
      <button @click="load">↻</button>
    </div>

    <!-- 报告预览 -->
    <div v-if="reportData" class="card">
      <h3>报告预览: {{ genType }}</h3>
      <div v-if="reportData.summary" class="report-summary">
        <div v-for="(v, k) in reportData.summary" :key="k" class="report-stat">
          <span class="report-stat-label">{{ k }}</span>
          <span class="report-stat-value">{{ typeof v === 'number' ? v.toLocaleString() : v }}</span>
        </div>
      </div>

      <div v-if="reportData.byModel?.length" class="report-section">
        <h4>按模型</h4>
        <table class="data-table">
          <thead><tr><th>模型</th><th>Token</th><th>成本</th><th>调用</th></tr></thead>
          <tbody>
            <tr v-for="r in reportData.byModel" :key="r.model">
              <td>{{ r.model }}</td>
              <td>{{ r.tokens?.toLocaleString() }}</td>
              <td>${{ r.cost?.toFixed(4) }}</td>
              <td>{{ r.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="reportData.bySession?.length" class="report-section">
        <h4>按会话 (Top 20)</h4>
        <table class="data-table">
          <thead><tr><th>会话</th><th>成本</th><th>Token</th><th>调用</th></tr></thead>
          <tbody>
            <tr v-for="r in reportData.bySession" :key="r.session_id">
              <td class="mono">{{ r.session_id?.slice(0, 16) }}...</td>
              <td>${{ r.cost?.toFixed(4) }}</td>
              <td>{{ r.tokens?.toLocaleString() }}</td>
              <td>{{ r.calls }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="reportData.runs?.length" class="report-section">
        <h4>运行统计</h4>
        <table class="data-table">
          <thead><tr><th>状态</th><th>数量</th><th>平均耗时</th></tr></thead>
          <tbody>
            <tr v-for="r in reportData.runs" :key="r.status">
              <td><span :class="['badge', r.status === 'done' ? 'ok' : r.status === 'failed' ? 'crit' : 'warn']">{{ r.status }}</span></td>
              <td>{{ r.count }}</td>
              <td>{{ r.avgDuration ? Math.round(r.avgDuration) + 'ms' : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="reportData.metrics?.length" class="report-section">
        <h4>性能指标</h4>
        <table class="data-table">
          <thead><tr><th>指标</th><th>平均</th><th>最小</th><th>最大</th><th>样本</th></tr></thead>
          <tbody>
            <tr v-for="r in reportData.metrics" :key="r.metric_type">
              <td>{{ r.metric_type }}</td>
              <td>{{ r.avg?.toFixed(2) }}</td>
              <td>{{ r.min?.toFixed(2) }}</td>
              <td>{{ r.max?.toFixed(2) }}</td>
              <td>{{ r.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="reportData.daily?.length" class="report-section">
        <h4>每日趋势</h4>
        <div class="daily-chart">
          <div v-for="d in reportData.daily" :key="d.day" class="daily-bar-group">
            <div class="daily-bar" :style="{ height: getBarHeight(d.tokens || (d.tokensIn + d.tokensOut), reportData.daily) + 'px' }"></div>
            <div class="daily-label">{{ new Date(d.day).toLocaleDateString('zh-CN', { day: '2-digit' }) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模板列表 -->
    <div class="card">
      <h3>报告模板</h3>
      <div v-if="!templates.length" class="empty-sm">暂无模板</div>
      <table v-else class="data-table">
        <thead><tr><th>名称</th><th>类型</th><th>描述</th><th>创建时间</th></tr></thead>
        <tbody>
          <tr v-for="t in templates" :key="t.id">
            <td>{{ t.name }}</td>
            <td><span class="badge">{{ t.type }}</span></td>
            <td>{{ t.description }}</td>
            <td>{{ formatTs(t.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';

const toast = useToast();
const genType = ref('token_usage');
const genFormat = ref('json');
const genFrom = ref('');
const genTo = ref('');
const reportData = ref<any>(null);
const templates = ref<any[]>([]);

async function load() {
  try {
    templates.value = await api.get('/reports/templates');
  } catch { /* ignore */ }
}

async function generateReport() {
  try {
    const dateRange = genFrom.value && genTo.value
      ? { from: new Date(genFrom.value).getTime(), to: new Date(genTo.value).getTime() + 86400000 }
      : undefined;
    const result = await api.post('/reports/generate', {
      type: genType.value,
      format: genFormat.value,
      dateRange,
    });
    if (genFormat.value === 'json') {
      reportData.value = typeof result === 'string' ? JSON.parse(result) : result;
    } else {
      reportData.value = { summary: { format: genFormat.value }, raw: result };
    }
    toast.success('报告已生成');
    load();
  } catch { toast.error('生成失败'); }
}

function getBarHeight(val: number, data: any[]) {
  const max = Math.max(...data.map((d: any) => d.tokens || (d.tokensIn + d.tokensOut) || 0));
  return max > 0 ? (val / max) * 100 + 10 : 10;
}

function formatTs(ts: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar select, .toolbar input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
.report-summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.report-stat { padding: 10px 16px; background: var(--surface); border-radius: 6px; min-width: 120px; }
.report-stat-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.report-stat-value { font-size: 18px; font-weight: 600; }
.report-section { margin-top: 20px; }
.report-section h4 { font-size: 13px; margin-bottom: 8px; color: var(--text-muted); }
.daily-chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding: 10px 0; }
.daily-bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; }
.daily-bar { width: 100%; max-width: 40px; background: var(--accent); border-radius: 2px 2px 0 0; min-height: 4px; transition: height 0.3s; }
.daily-label { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
</style>
